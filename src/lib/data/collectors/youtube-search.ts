import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * YouTube search & trending collector.
 * Wraps YouTube Data API v3 for video search and trending content.
 * Follows the collector pattern: cache → rate limit → API → fallback (never throw).
 *
 * Quota tracking: YouTube API daily quota is 10,000 units.
 * - search = 100 units per call
 * - videos = 1 unit per call
 * Warns at 8,000 (80%), refuses at 9,500 (95%).
 */

import { createHash } from 'node:crypto';
import { firecrawlSearch } from '@/lib/data/firecrawl';
import { isRedisConnected, redis } from '@/lib/redis/client';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/* ─── Types ─── */

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  thumbnailUrl: string;
  description: string;
  duration: string;
  viewCount: string;
  likeCount: string;
}

export interface SearchFilters {
  publishedAfter?: string;
  videoDuration?: 'short' | 'medium' | 'long';
  channelId?: string;
  order?: 'relevance' | 'date' | 'viewCount';
  maxResults?: number;
}

/* ─── Quota Tracking ─── */

function getQuotaKey(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `yt-quota:${today}`;
}

async function getQuotaUsed(): Promise<number> {
  if (!isRedisConnected()) return 0;
  try {
    const val = await redis.get(getQuotaKey());
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

async function incrementQuota(units: number): Promise<void> {
  if (!isRedisConnected()) return;
  try {
    const key = getQuotaKey();
    await redis.incrby(key, units);
    // Expire at end of day (set TTL to 24h if not already set)
    await redis.expire(key, 86400);
  } catch {
    // Best-effort quota tracking
  }
}

async function checkQuota(_units: number): Promise<boolean> {
  const used = await getQuotaUsed();
  if (used >= 9500) {
    console.warn(`[YouTube Search] Quota refused: ${used}/10000 units used (95% threshold)`);
    return false;
  }
  if (used >= 8000) {
    console.warn(`[YouTube Search] Quota warning: ${used}/10000 units used (80% threshold)`);
  }
  return true;
}

/* ─── Duration Parser ─── */

/**
 * Convert ISO 8601 duration to human-readable format.
 * PT1H2M3S → "1:02:03", PT5M30S → "5:30", PT45S → "0:45"
 */
export function parseDuration(iso8601: string): string {
  const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';

  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/* ─── NLP Filter Parsing ─── */

const FILTER_PATTERNS: {
  pattern: RegExp;
  apply: (filters: SearchFilters) => void;
}[] = [
  {
    pattern: /\b(today|today'?s)\b/i,
    apply: (f) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      f.publishedAfter = d.toISOString();
    },
  },
  {
    pattern: /\b(this week|this week'?s)\b/i,
    apply: (f) => {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      f.publishedAfter = d.toISOString();
    },
  },
  {
    pattern: /\brecent\b/i,
    apply: (f) => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      f.publishedAfter = d.toISOString();
    },
  },
  {
    pattern: /\b(long|documentary)\b/i,
    apply: (f) => {
      f.videoDuration = 'long';
    },
  },
  {
    pattern: /\b(short|clip)\b/i,
    apply: (f) => {
      f.videoDuration = 'short';
    },
  },
  {
    pattern: /\b(latest|newest)\b/i,
    apply: (f) => {
      f.order = 'date';
    },
  },
  {
    pattern: /\b(popular|most viewed)\b/i,
    apply: (f) => {
      f.order = 'viewCount';
    },
  },
];

/**
 * Parse natural language search query to extract filter hints.
 * Returns cleaned query with filter words stripped and extracted filters.
 */
export function parseSearchFilters(query: string): { cleanQuery: string; filters: SearchFilters } {
  const filters: SearchFilters = {};
  let cleanQuery = query;

  for (const { pattern, apply } of FILTER_PATTERNS) {
    if (pattern.test(cleanQuery)) {
      apply(filters);
      cleanQuery = cleanQuery.replace(pattern, '').trim();
    }
  }

  // Collapse double spaces
  cleanQuery = cleanQuery.replace(/\s+/g, ' ').trim();

  return { cleanQuery, filters };
}

/* ─── Web Search Fallback ─── */

/**
 * Extract YouTube video ID from a URL.
 * Handles youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID
 */
function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const shortsMatch = u.pathname.match(/\/shorts\/([^/?]+)/);
      if (shortsMatch?.[1]) return shortsMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fallback: search YouTube via Firecrawl web search when API quota is exhausted.
 * Returns partial results (no duration/viewCount) but enough to play videos.
 */
async function searchYouTubeViaWeb(
  query: string,
  maxResults: number,
): Promise<YouTubeSearchResult[]> {
  try {
    const webResults = await firecrawlSearch(`site:youtube.com ${query}`, maxResults + 3);
    if (webResults.results.length === 0) return [];

    const results: YouTubeSearchResult[] = [];
    for (const r of webResults.results) {
      const videoId = extractVideoId(r.url);
      if (!videoId) continue;

      results.push({
        videoId,
        title: r.title.replace(/ - YouTube$/, '').trim(),
        channelTitle: '',
        channelId: '',
        publishedAt: '',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        description: r.description,
        duration: '',
        viewCount: '0',
        likeCount: '0',
      });

      if (results.length >= maxResults) break;
    }

    console.info(`[YouTube Search] Web fallback returned ${results.length} results for "${query}"`);
    return results;
  } catch (err) {
    console.warn('[YouTube Search] Web fallback failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* ─── YouTube Search ─── */

interface YouTubeSearchAPIItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    description?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
}

interface YouTubeVideoAPIItem {
  id?: string;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
}

/**
 * Search YouTube for videos matching a query with optional filters.
 * Enriches results with video details (duration, view counts).
 * Never throws — returns empty array on failure.
 */
export async function searchYouTube(
  query: string,
  filters?: SearchFilters,
): Promise<YouTubeSearchResult[]> {
  const maxResults = filters?.maxResults ?? 5;

  // Build cache key
  const hash = createHash('md5')
    .update(query + JSON.stringify(filters ?? {}))
    .digest('hex');
  const cacheKey = `youtube-search:${hash}`;

  const cached = await getCached<YouTubeSearchResult[]>(cacheKey);
  if (cached) return cached;

  // Prefer dedicated search key, fall back to shared key
  const apiKey = process.env.YOUTUBE_SEARCH_API_KEY || process.env.YOUTUBE_API_KEY;

  // No API key → try web fallback
  if (!apiKey) {
    console.warn(
      '[YouTube Search] No YOUTUBE_SEARCH_API_KEY or YOUTUBE_API_KEY set, trying web fallback',
    );
    const webResults = await searchYouTubeViaWeb(query, maxResults);
    if (webResults.length > 0) await setCache(cacheKey, webResults, 300);
    return webResults;
  }

  if (!checkRateLimit('youtube_search')) {
    console.warn('[YouTube Search] Rate limited, trying web fallback');
    return searchYouTubeViaWeb(query, maxResults);
  }

  // Quota check: search = 100 units + videos = 1 unit
  if (!(await checkQuota(101))) {
    const webResults = await searchYouTubeViaWeb(query, maxResults);
    if (webResults.length > 0) await setCache(cacheKey, webResults, 300);
    return webResults;
  }

  try {
    // Step 1: Search
    const searchParams = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      videoEmbeddable: 'true',
      maxResults: String(maxResults),
      key: apiKey,
    });

    if (filters?.publishedAfter) searchParams.set('publishedAfter', filters.publishedAfter);
    if (filters?.videoDuration) searchParams.set('videoDuration', filters.videoDuration);
    if (filters?.channelId) searchParams.set('channelId', filters.channelId);
    if (filters?.order) searchParams.set('order', filters.order);

    const searchRes = await safeFetch(`${YOUTUBE_API_BASE}/search?${searchParams}`, {
      headers: { Accept: 'application/json' },
    });

    if (!searchRes.ok) {
      console.warn(`[YouTube Search] Search API ${searchRes.status}, trying web fallback`);
      const webResults = await searchYouTubeViaWeb(query, maxResults);
      if (webResults.length > 0) await setCache(cacheKey, webResults, 300);
      return webResults;
    }

    await incrementQuota(100);

    const searchData = (await searchRes.json()) as { items?: YouTubeSearchAPIItem[] };
    const items = searchData.items ?? [];
    if (items.length === 0) return [];

    // Collect video IDs for enrichment
    const videoIds = items.map((item) => item.id?.videoId).filter((id): id is string => id != null);

    if (videoIds.length === 0) return [];

    // Step 2: Enrich with video details
    const videoParams = new URLSearchParams({
      part: 'contentDetails,statistics',
      id: videoIds.join(','),
      key: apiKey,
    });

    const videoRes = await safeFetch(`${YOUTUBE_API_BASE}/videos?${videoParams}`, {
      headers: { Accept: 'application/json' },
    });

    await incrementQuota(1);

    const videoDetails: Record<string, YouTubeVideoAPIItem> = {};
    if (videoRes.ok) {
      const videoData = (await videoRes.json()) as { items?: YouTubeVideoAPIItem[] };
      for (const v of videoData.items ?? []) {
        if (v.id) videoDetails[v.id] = v;
      }
    }

    // Step 3: Merge results
    const results: YouTubeSearchResult[] = items
      .filter((item) => item.id?.videoId)
      .map((item) => {
        const videoId = item.id!.videoId!;
        const detail = videoDetails[videoId];
        const snippet = item.snippet;

        return {
          videoId,
          title: snippet?.title ?? '',
          channelTitle: snippet?.channelTitle ?? '',
          channelId: snippet?.channelId ?? '',
          publishedAt: snippet?.publishedAt ?? '',
          thumbnailUrl:
            snippet?.thumbnails?.high?.url ??
            snippet?.thumbnails?.medium?.url ??
            snippet?.thumbnails?.default?.url ??
            '',
          description: snippet?.description ?? '',
          duration: parseDuration(detail?.contentDetails?.duration ?? 'PT0S'),
          viewCount: detail?.statistics?.viewCount ?? '0',
          likeCount: detail?.statistics?.likeCount ?? '0',
        };
      });

    await setCache(cacheKey, results, 300);
    return results;
  } catch (err) {
    console.warn('[YouTube Search] Failed:', err instanceof Error ? err.message : err);
    // Last resort: try web fallback
    return searchYouTubeViaWeb(query, maxResults);
  }
}

/* ─── Trending Videos ─── */

/**
 * Fetch trending/popular videos on YouTube (US region).
 * Never throws — returns empty array on failure.
 */
export async function fetchTrendingVideos(): Promise<YouTubeSearchResult[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[YouTube Trending] No YOUTUBE_API_KEY set');
    return [];
  }

  const cacheKey = 'youtube-trending:popular';
  const cached = await getCached<YouTubeSearchResult[]>(cacheKey);
  if (cached) return cached;

  if (!checkRateLimit('youtube_trending')) {
    console.warn('[YouTube Trending] Rate limited');
    return [];
  }

  // Quota check: videos = 1 unit
  if (!(await checkQuota(1))) return [];

  try {
    const params = new URLSearchParams({
      chart: 'mostPopular',
      part: 'snippet,contentDetails,statistics',
      regionCode: 'US',
      maxResults: '12',
      key: apiKey,
    });

    const res = await safeFetch(`${YOUTUBE_API_BASE}/videos?${params}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`[YouTube Trending] API ${res.status}`);
      return [];
    }

    await incrementQuota(1);

    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        snippet?: YouTubeSearchAPIItem['snippet'];
        contentDetails?: { duration?: string };
        statistics?: { viewCount?: string; likeCount?: string };
      }>;
    };

    const results: YouTubeSearchResult[] = (data.items ?? [])
      .filter((item) => item.id)
      .map((item) => ({
        videoId: item.id!,
        title: item.snippet?.title ?? '',
        channelTitle: item.snippet?.channelTitle ?? '',
        channelId: item.snippet?.channelId ?? '',
        publishedAt: item.snippet?.publishedAt ?? '',
        thumbnailUrl:
          item.snippet?.thumbnails?.high?.url ??
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          '',
        description: item.snippet?.description ?? '',
        duration: parseDuration(item.contentDetails?.duration ?? 'PT0S'),
        viewCount: item.statistics?.viewCount ?? '0',
        likeCount: item.statistics?.likeCount ?? '0',
      }));

    await setCache(cacheKey, results, 1800);
    return results;
  } catch (err) {
    console.warn('[YouTube Trending] Failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
