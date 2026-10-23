import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * TV Context Assembly Collector.
 * Assembles lightweight metadata about the user's active livestream channel
 * by combining channel config, YouTube video metadata, and RSS headlines.
 * Follows collector pattern: cache → API → fallback, never throw.
 */

import type { LivestreamChannelConfig, ResolvedChannel } from '../livestream-channels';
import { resolveChannelConfig } from '../livestream-channels';
import { getCached, setCache } from '../rate-limiter';

// ─── Types ───

export interface TvContext {
  channelId: string;
  channelLabel: string;
  category: string;
  description: string | null;
  videoMeta: { title: string; description: string; tags: string[] } | null;
  recentHeadlines: Array<{
    title: string;
    source: string;
    publishedAt: string;
    url: string;
  }>;
  isLive: boolean;
  channelHeadlines: Array<{ title: string; source: string; publishedAt: string; url: string }>;
  livePage: {
    headlines: Array<{ title: string; url?: string }>;
    liveUpdates: string[];
    scrapedAt: string;
  } | null;
  videoMetaChange: {
    titleChanged: boolean;
    previousTitle: string | null;
    significantChange: boolean;
  } | null;
  ccSummary: {
    text: string;
    windowStart: string;
    windowEnd: string;
    captionCount: number;
  } | null;
  previousChannelSummary: string | null;
  assembledAt: string;
}

// ─── Public API ───

/** Engagement-based cache TTLs in seconds */
const ENGAGEMENT_TTL: Record<string, number> = {
  focused: 60,
  active: 180,
  idle: 300,
};

/**
 * Assemble TV context for a given channel ID.
 * Returns cached result if available, otherwise resolves all data in parallel:
 * - YouTube video metadata (title, description, tags) from resolved videoId
 * - RSS headlines from the channel's mapped categories
 * - Channel-specific RSS headlines from the channel's own feed
 * - Network page scrape via Firecrawl
 * - YouTube metadata change detection
 * - Caption summary from cache
 * - Previous channel summary from cache
 *
 * Returns null for unknown channels. Never throws.
 */
export async function assembleTvContext(
  channelId: string,
  engagementOrOptions?: 'focused' | 'active' | 'idle' | { videoId?: string; engagement?: string },
): Promise<TvContext | null> {
  // Normalize parameters — support both legacy string and new options object
  let engagementLevel: 'focused' | 'active' | 'idle' | undefined;
  let overrideVideoId: string | undefined;

  if (typeof engagementOrOptions === 'string') {
    engagementLevel = engagementOrOptions;
  } else if (engagementOrOptions) {
    engagementLevel = (engagementOrOptions.engagement as typeof engagementLevel) ?? undefined;
    overrideVideoId = engagementOrOptions.videoId;
  }

  // When a specific videoId is provided, fetch metadata directly from YouTube API
  if (overrideVideoId) {
    const videoMeta = await resolveVideoMetaById(overrideVideoId);
    const result: TvContext = {
      channelId,
      channelLabel: videoMeta?.title ?? 'YouTube Video',
      category: 'youtube-search',
      description: videoMeta?.description ?? null,
      videoMeta,
      recentHeadlines: [],
      isLive: false,
      channelHeadlines: [],
      livePage: null,
      videoMetaChange: null,
      ccSummary: null,
      previousChannelSummary: null,
      assembledAt: new Date().toISOString(),
    };

    const ttl = ENGAGEMENT_TTL[engagementLevel ?? 'idle'] ?? 300;
    await setCache(`tv-context:yt-${overrideVideoId}`, result, ttl);
    return result;
  }

  const channel = resolveChannelConfig().find((c) => c.id === channelId);
  if (!channel) return null;

  // Check cache first
  const cacheKey = `tv-context:${channelId}`;
  const cached = await getCached<TvContext>(cacheKey);
  if (cached) return cached;

  // Resolve all data sources in parallel
  const [
    videoMeta,
    recentHeadlines,
    isLive,
    channelHeadlines,
    livePage,
    videoMetaChange,
    ccSummary,
    previousChannelSummary,
  ] = await Promise.all([
    resolveVideoMeta(channelId, channel),
    resolveHeadlines(channel.rssCategories ?? []),
    resolveIsLive(channelId),
    resolveChannelHeadlines(channel),
    resolveNetworkPage(channel),
    resolveYouTubeMetaChange(channelId),
    resolveCcSummary(channelId),
    resolvePreviousChannelSummary(channelId),
  ]);

  const result: TvContext = {
    channelId: channel.id,
    channelLabel: channel.label,
    category: channel.category,
    description: channel.description ?? null,
    videoMeta,
    recentHeadlines,
    isLive,
    channelHeadlines,
    livePage,
    videoMetaChange,
    ccSummary,
    previousChannelSummary,
    assembledAt: new Date().toISOString(),
  };

  const ttl = ENGAGEMENT_TTL[engagementLevel ?? 'idle'] ?? 300;
  await setCache(cacheKey, result, ttl);
  return result;
}

// ─── Internal Helpers ───

/**
 * Fetch video metadata directly by videoId (for YouTube search results).
 * Bypasses the channel resolution pipeline — used when the caller already has a specific videoId.
 */
async function resolveVideoMetaById(
  videoId: string,
): Promise<{ title: string; description: string; tags: string[] } | null> {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;

    const params = new URLSearchParams({
      part: 'snippet',
      id: videoId,
      key: apiKey,
    });

    const res = await safeFetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      items?: Array<{
        snippet?: {
          title?: string;
          description?: string;
          tags?: string[];
        };
      }>;
    };

    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return null;

    return {
      title: snippet.title ?? '',
      description: (snippet.description ?? '').slice(0, 500),
      tags: (snippet.tags ?? []).slice(0, 15),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch video metadata from YouTube Data API v3 for the resolved videoId.
 * Reads videoId from the livestream:resolved cache (set by the livestream collector).
 * For youtube-video type channels (e.g. custom), uses the source field directly
 * as the video ID when the resolver cache has no entry.
 * Uses /videos endpoint (1 quota unit, very cheap).
 */
async function resolveVideoMeta(
  channelId: string,
  channel?: LivestreamChannelConfig,
): Promise<{ title: string; description: string; tags: string[] } | null> {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return null;

    // Read the resolved video ID from the existing livestream cache
    const resolved = await getCached<Record<string, ResolvedChannel>>('livestream:resolved');
    let videoId = resolved?.[channelId]?.videoId;

    // For youtube-video types (e.g. custom URL), the source IS the video ID
    if (!videoId && channel?.type === 'youtube-video') {
      videoId = channel.source;
    }
    if (!videoId) return null;

    const params = new URLSearchParams({
      part: 'snippet',
      id: videoId,
      key: apiKey,
    });

    const res = await safeFetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      items?: Array<{
        snippet?: {
          title?: string;
          description?: string;
          tags?: string[];
        };
      }>;
    };

    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return null;

    return {
      title: snippet.title ?? '',
      description: (snippet.description ?? '').slice(0, 500),
      tags: (snippet.tags ?? []).slice(0, 15),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch recent headlines from the channel's mapped RSS categories.
 * Reuses the existing fetchRSSFeeds function from rss.ts.
 */
async function resolveHeadlines(
  rssCategories: string[],
): Promise<Array<{ title: string; source: string; publishedAt: string; url: string }>> {
  if (rssCategories.length === 0) return [];

  try {
    const { fetchRSSFeeds } = await import('./rss');

    const results = await Promise.allSettled(rssCategories.map((cat) => fetchRSSFeeds(cat, 10)));

    const allItems: Array<{ title: string; source: string; publishedAt: string; url: string }> = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const item of result.value) {
          allItems.push({
            title: item.title,
            source: item.source,
            publishedAt: item.publishedAt,
            url: item.url,
          });
        }
      }
    }

    // Sort by date descending, take top 5
    allItems.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    return allItems.slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Check if the channel is currently live by reading the resolved cache.
 */
async function resolveIsLive(channelId: string): Promise<boolean> {
  try {
    const channel = resolveChannelConfig().find((c) => c.id === channelId);
    // HLS channels are always live
    if (channel?.type === 'hls') return true;

    const resolved = await getCached<Record<string, ResolvedChannel>>('livestream:resolved');
    return resolved?.[channelId]?.isLive ?? false;
  } catch {
    return false;
  }
}

/**
 * Fetch channel-specific RSS headlines from the channel's own feed.
 */
async function resolveChannelHeadlines(
  channel: LivestreamChannelConfig,
): Promise<Array<{ title: string; source: string; publishedAt: string; url: string }>> {
  if (!channel.rssFeedUrl) return [];

  try {
    const { fetchChannelRSS } = await import('./channel-rss');
    const items = await fetchChannelRSS(channel.id, channel.rssFeedUrl, channel.label, 5);
    return items.map((item) => ({
      title: item.title,
      source: item.source,
      publishedAt: item.publishedAt,
      url: item.url,
    }));
  } catch {
    return [];
  }
}

/**
 * Scrape the channel's live page for headlines and live updates via Firecrawl.
 */
async function resolveNetworkPage(
  channel: LivestreamChannelConfig,
): Promise<TvContext['livePage']> {
  if (!channel.livePageUrl) return null;

  try {
    const { scrapeNetworkPage } = await import('./network-scraper');
    return await scrapeNetworkPage(channel.id, channel.livePageUrl);
  } catch {
    return null;
  }
}

/**
 * Poll YouTube metadata and detect changes from previous poll.
 */
async function resolveYouTubeMetaChange(channelId: string): Promise<TvContext['videoMetaChange']> {
  try {
    const { pollYouTubeVideoMeta, resolveVideoId } = await import('./youtube-poller');
    const videoId = await resolveVideoId(channelId);
    if (!videoId) return null;

    const result = await pollYouTubeVideoMeta(videoId, channelId);
    return result?.change ?? null;
  } catch {
    return null;
  }
}

/**
 * Read caption summary from cache (written by the caption summarization route).
 */
async function resolveCcSummary(channelId: string): Promise<TvContext['ccSummary']> {
  try {
    return await getCached<NonNullable<TvContext['ccSummary']>>(`cc-summary:${channelId}`);
  } catch {
    return null;
  }
}

/**
 * Read previous channel summary from cache.
 */
async function resolvePreviousChannelSummary(channelId: string): Promise<string | null> {
  try {
    return await getCached<string>(`cc-prev-summary:${channelId}`);
  } catch {
    return null;
  }
}
