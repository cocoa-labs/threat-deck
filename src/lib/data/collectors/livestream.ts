import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * YouTube livestream resolver collector.
 * Resolves live video IDs for youtube-channel type entries via YouTube Data API v3.
 * Follows the collector pattern: cache → rate limit → API → fallback (never throw).
 *
 * Self-healing three-layer defense:
 * 1. Dynamic fallback — fetch channel's latest public video when no live stream
 * 2. oEmbed validation — verify any video ID is embeddable before returning it
 * 3. Graceful UI degradation — return videoId: null when nothing valid exists
 */

import type { LivestreamChannelConfig, ResolvedChannel } from '../livestream-channels';
import { DEFAULT_CHANNELS } from '../livestream-channels';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/* ─── oEmbed Validation ─── */

/**
 * Validate that a YouTube video ID is publicly embeddable via the free oEmbed endpoint.
 * Returns true if embeddable, false if private/deleted/non-embeddable.
 * Fails open (returns true) on network errors to avoid false negatives.
 */
async function validateVideoId(videoId: string): Promise<boolean> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await safeFetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    // Network error or timeout — fail open to avoid blocking valid videos
    return true;
  }
}

/* ─── Dynamic Latest Video Resolution ─── */

/**
 * Fetch the most recent public video from a YouTube channel.
 * Uses YouTube Data API search endpoint with date ordering.
 * Returns the video ID or null on any failure.
 */
async function resolveLatestVideo(channelId: string, apiKey: string): Promise<string | null> {
  if (!checkRateLimit('youtube')) return null;

  try {
    const params = new URLSearchParams({
      part: 'snippet',
      channelId,
      order: 'date',
      type: 'video',
      maxResults: '1',
      key: apiKey,
    });

    const res = await safeFetch(`${YOUTUBE_API_BASE}/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return null;

    const data: YouTubeSearchResponse = await res.json();
    return data.items?.[0]?.id?.videoId ?? null;
  } catch {
    return null;
  }
}

/* ─── Main Resolver ─── */

/**
 * Resolve live video IDs for all youtube-channel entries.
 * Returns a map of channel ID → resolved data.
 */
export async function resolveYouTubeLiveStreams(
  channels?: LivestreamChannelConfig[],
): Promise<Record<string, ResolvedChannel>> {
  const cacheKey = 'livestream:resolved';
  const cached = await getCached<Record<string, ResolvedChannel>>(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelList = channels ?? DEFAULT_CHANNELS;
  const results: Record<string, ResolvedChannel> = {};

  // If no API key, return validated fallback data for all channels
  if (!apiKey) {
    console.warn('[Livestream] No YOUTUBE_API_KEY set — using fallback video IDs');
    for (const ch of channelList) {
      results[ch.id] = await buildFallbackResult(ch);
    }
    await setCache(cacheKey, results);
    return results;
  }

  // Resolve each youtube-channel type entry
  for (const ch of channelList) {
    if (ch.type !== 'youtube-channel') {
      // Non-YouTube channels don't need resolution
      results[ch.id] = {
        id: ch.id,
        videoId: ch.type === 'youtube-video' ? ch.source : null,
        isLive: ch.type === 'hls' || ch.type === 'iframe',
      };
      continue;
    }

    // Check rate limit before each API call
    if (!checkRateLimit('youtube')) {
      console.warn(`[Livestream] Rate limited — using fallback for ${ch.id}`);
      results[ch.id] = await buildFallbackResult(ch);
      continue;
    }

    try {
      const params = new URLSearchParams({
        part: 'snippet',
        channelId: ch.source,
        eventType: 'live',
        type: 'video',
        maxResults: '1',
        key: apiKey,
      });

      const res = await safeFetch(`${YOUTUBE_API_BASE}/search?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(`[Livestream] YouTube API ${res.status} for ${ch.id}: ${body.slice(0, 200)}`);
        results[ch.id] = await buildFallbackResult(ch);
        continue;
      }

      const data: YouTubeSearchResponse = await res.json();
      const item = data.items?.[0];

      if (item?.id?.videoId) {
        // Live stream found — use it directly
        results[ch.id] = {
          id: ch.id,
          videoId: item.id.videoId,
          isLive: true,
          title: item.snippet?.title,
          thumbnailUrl:
            item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url,
        };
      } else {
        // No live stream — resolve with three-layer fallback cascade
        results[ch.id] = await resolveOfflineChannel(ch, apiKey);
      }
    } catch (error) {
      console.warn(
        `[Livestream] Failed to resolve ${ch.id}:`,
        error instanceof Error ? error.message : error,
      );
      results[ch.id] = await buildFallbackResult(ch);
    }
  }

  await setCache(cacheKey, results);
  return results;
}

/* ─── Helpers ─── */

/**
 * Three-layer fallback cascade for offline channels:
 * 1. Dynamic: fetch latest video from channel → oEmbed validate
 * 2. Static: try hardcoded fallbackVideoId → oEmbed validate
 * 3. Last resort: videoId: null (triggers clean offline UI)
 */
async function resolveOfflineChannel(
  ch: LivestreamChannelConfig,
  apiKey: string,
): Promise<ResolvedChannel> {
  // Layer 1: Dynamic — fetch the channel's most recent public video
  const latestVideoId = await resolveLatestVideo(ch.source, apiKey);
  if (latestVideoId) {
    const isValid = await validateVideoId(latestVideoId);
    if (isValid) {
      return { id: ch.id, videoId: latestVideoId, isLive: false };
    }
  }

  // Layer 2: Static — try the hardcoded fallback
  if (ch.fallbackVideoId) {
    const isValid = await validateVideoId(ch.fallbackVideoId);
    if (isValid) {
      return { id: ch.id, videoId: ch.fallbackVideoId, isLive: false };
    }
    console.warn(`[Livestream] Stale fallback detected for ${ch.id}: ${ch.fallbackVideoId}`);
  }

  // Layer 3: Last resort — clean offline state
  return { id: ch.id, videoId: null, isLive: false };
}

/**
 * Build a fallback result with oEmbed validation.
 * Used in error/rate-limit paths where API calls failed.
 */
async function buildFallbackResult(ch: LivestreamChannelConfig): Promise<ResolvedChannel> {
  if (ch.fallbackVideoId) {
    const isValid = await validateVideoId(ch.fallbackVideoId);
    if (isValid) {
      return { id: ch.id, videoId: ch.fallbackVideoId, isLive: false };
    }
    console.warn(`[Livestream] Stale fallback detected for ${ch.id}: ${ch.fallbackVideoId}`);
  }
  return { id: ch.id, videoId: null, isLive: false };
}

/* ─── YouTube API Response Types ─── */

interface YouTubeSearchResponse {
  items?: {
    id?: {
      videoId?: string;
    };
    snippet?: {
      title?: string;
      thumbnails?: {
        default?: { url?: string };
        high?: { url?: string };
      };
    };
  }[];
}
