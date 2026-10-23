import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * Channel RSS Collector.
 * Fetches a channel's own RSS feed and returns normalized NewsItem[].
 * Follows collector pattern: cache -> rate limit -> API -> fallback, never throw.
 */

import Parser from 'rss-parser';
import type { NewsItem } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const parser = new Parser({
  timeout: 10_000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; KlammerMonitor/1.0; +https://klammer.io)',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

/**
 * Fetch a channel's own RSS feed and return normalized NewsItem[].
 * Returns [] on any failure (no API key needed, just a feed URL).
 */
export async function fetchChannelRSS(
  channelId: string,
  feedUrl: string,
  channelLabel: string,
  limit: number = 10,
): Promise<NewsItem[]> {
  const cacheKey = `channel-rss:${channelId}`;
  const cached = await getCached<NewsItem[]>(cacheKey);
  if (cached) return cached.slice(0, limit);

  if (!checkRateLimit('rss')) return [];

  try {
    const feed = await parser.parseString(
      await (await safeFetch(feedUrl, {}, 2 * 1024 * 1024)).text(),
    );

    const items: NewsItem[] = (feed.items ?? []).slice(0, limit).map((item) => ({
      id: `ch-rss-${channelId}-${hashString(item.guid ?? item.link ?? item.title ?? '')}`,
      title: item.title ?? 'Untitled',
      summary: item.contentSnippet ?? item.summary ?? undefined,
      url: item.link ?? feedUrl,
      source: channelLabel,
      category: 'channel',
      publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
      imageUrl: item.enclosure?.url ?? undefined,
    }));

    await setCache(cacheKey, items, 120);
    return items;
  } catch (error) {
    console.warn(
      `[channel-rss] Failed to fetch ${channelLabel} (${feedUrl}):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}
