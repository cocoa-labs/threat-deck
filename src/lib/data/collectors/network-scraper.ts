import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * Network Scraper Collector.
 * Scrapes a channel's live blog or "latest" page via Firecrawl for headlines and updates.
 * Follows collector pattern: cache -> rate limit -> API -> fallback, never throw.
 */

import { checkRateLimit, getCached, setCache } from '../rate-limiter';

export interface ScrapedContent {
  headlines: Array<{ title: string; url?: string }>;
  liveUpdates: string[];
  scrapedAt: string;
}

/**
 * Scrape a network's live page for headlines and live updates.
 * Returns null on failure (no API key, Firecrawl unavailable, rate limited, etc.).
 */
export async function scrapeNetworkPage(
  channelId: string,
  pageUrl: string,
  skipCache = false,
): Promise<ScrapedContent | null> {
  const cacheKey = `network-scrape:${channelId}`;
  if (!skipCache) {
    const cached = await getCached<ScrapedContent>(cacheKey);
    if (cached) return cached;
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  if (!checkRateLimit('firecrawl_scrape')) return null;

  try {
    const res = await safeFetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: pageUrl,
        onlyMainContent: true,
        formats: ['markdown'],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      success?: boolean;
      data?: { markdown?: string };
    };

    if (!data.success || !data.data?.markdown) return null;

    const markdown = data.data.markdown;
    const result = parseMarkdown(markdown);

    await setCache(cacheKey, result, 180);
    return result;
  } catch (error) {
    console.warn(
      `[network-scraper] Failed to scrape ${channelId} (${pageUrl}):`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Parse markdown for headlines (# headers) and short paragraph updates (first 3 paragraphs).
 */
function parseMarkdown(markdown: string): ScrapedContent {
  const headlines: Array<{ title: string; url?: string }> = [];
  const liveUpdates: string[] = [];

  const lines = markdown.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match markdown headers: # Title or ## Title etc.
    const headerMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headerMatch?.[1]) {
      const headerText = headerMatch[1];
      // Extract link if present: [text](url)
      const linkMatch = headerText.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch?.[1] && linkMatch[2]) {
        headlines.push({ title: linkMatch[1], url: linkMatch[2] });
      } else {
        headlines.push({ title: headerText.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') });
      }
      if (headlines.length >= 10) break;
      continue;
    }

    // Collect short paragraphs as live updates (skip very short or very long lines)
    if (liveUpdates.length < 3 && trimmed.length > 30 && trimmed.length < 500) {
      // Strip markdown links for clean text
      const cleanText = trimmed.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      liveUpdates.push(cleanText);
    }
  }

  return {
    headlines,
    liveUpdates,
    scrapedAt: new Date().toISOString(),
  };
}
