import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * YouTube Metadata Poller Collector.
 * Polls YouTube video metadata and detects changes (title/description drift).
 * Follows collector pattern: cache -> rate limit -> API -> fallback, never throw.
 */

import type { ResolvedChannel } from '../livestream-channels';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

interface VideoMeta {
  title: string;
  description: string;
}

interface MetaChange {
  titleChanged: boolean;
  previousTitle: string | null;
  significantChange: boolean;
}

export interface YouTubePollResult {
  meta: VideoMeta;
  change: MetaChange;
}

/**
 * Poll YouTube video metadata and detect changes from previous poll.
 * Returns null on failure (no API key, rate limited, no video, etc.).
 */
export async function pollYouTubeVideoMeta(
  videoId: string,
  channelId: string,
): Promise<YouTubePollResult | null> {
  // Check current metadata cache first
  const currentCacheKey = `yt-meta:${videoId}`;
  const cachedCurrent = await getCached<YouTubePollResult>(currentCacheKey);
  if (cachedCurrent) return cachedCurrent;

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  if (!checkRateLimit('youtube')) return null;

  try {
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
        };
      }>;
    };

    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return null;

    const currentMeta: VideoMeta = {
      title: snippet.title ?? '',
      description: (snippet.description ?? '').slice(0, 500),
    };

    // Load previous metadata for comparison
    const prevCacheKey = `yt-meta-prev:${videoId}`;
    const previousMeta = await getCached<VideoMeta>(prevCacheKey);

    const change = computeChange(currentMeta, previousMeta);

    // Store current as previous for next poll
    await setCache(prevCacheKey, currentMeta, 600);

    const result: YouTubePollResult = { meta: currentMeta, change };

    // Cache the full result
    await setCache(currentCacheKey, result, 120);
    return result;
  } catch (error) {
    console.warn(
      `[youtube-poller] Failed to poll ${channelId} video ${videoId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Resolve the current video ID for a channel from the livestream resolved cache.
 */
export async function resolveVideoId(channelId: string): Promise<string | null> {
  try {
    const resolved = await getCached<Record<string, ResolvedChannel>>('livestream:resolved');
    return resolved?.[channelId]?.videoId ?? null;
  } catch {
    return null;
  }
}

function computeChange(current: VideoMeta, previous: VideoMeta | null): MetaChange {
  if (!previous) {
    return { titleChanged: false, previousTitle: null, significantChange: false };
  }

  const titleChanged = current.title.toLowerCase() !== previous.title.toLowerCase();
  const descDiff = computeDescriptionDiff(current.description, previous.description);
  const significantChange = titleChanged || descDiff > 0.2;

  return {
    titleChanged,
    previousTitle: titleChanged ? previous.title : null,
    significantChange,
  };
}

/**
 * Compute a rough diff ratio between two descriptions.
 * Returns a value 0-1 representing how different they are.
 */
function computeDescriptionDiff(current: string, previous: string): number {
  if (!current && !previous) return 0;
  if (!current || !previous) return 1;

  const maxLen = Math.max(current.length, previous.length);
  if (maxLen === 0) return 0;

  // Simple character-level diff ratio
  let matches = 0;
  const minLen = Math.min(current.length, previous.length);
  for (let i = 0; i < minLen; i++) {
    if (current[i] === previous[i]) matches++;
  }

  return 1 - matches / maxLen;
}
