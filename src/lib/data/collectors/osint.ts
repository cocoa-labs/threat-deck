import Parser from 'rss-parser';
import { safeFetch } from '@/lib/security/safe-fetch';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

// ─── OSINT Item Type ───

export interface OSINTItem {
  id: string;
  title: string;
  summary?: string;
  url: string;
  source: string;
  publishedAt: string;
  category: string;
}

// ─── RSS Parser Instance ───

const parser = new Parser({
  timeout: 10_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; CocoaThreatDeck/1.0; +https://github.com/cocoa-labs/threat-deck)',
    Accept: 'application/rss+xml, application/xml, application/atom+xml, text/xml',
  },
});

// ─── OSINT Feed Registry by Category ───

const OSINT_FEEDS: Record<string, { name: string; url: string }[]> = {
  think_tank: [
    { name: 'Arms Control Association', url: 'https://www.armscontrol.org/rss.xml' },
    // Stimson Center dropped — feed 403s server-side fetches regardless of UA.
    { name: 'Atlantic Council', url: 'https://www.atlanticcouncil.org/feed/' },
    { name: 'RAND', url: 'https://www.rand.org/blog.xml' },
  ],
  defense: [
    { name: 'DefenseOne', url: 'https://www.defenseone.com/rss/all/' },
    { name: 'Breaking Defense', url: 'https://breakingdefense.com/feed/' },
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/' },
    {
      name: 'Defense News',
      url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml',
    },
  ],
  cybersecurity: [
    { name: 'CISA Alerts', url: 'https://www.cisa.gov/news.xml' },
    { name: 'The Register Security', url: 'https://www.theregister.com/security/headlines.atom' },
    { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/' },
  ],
  nuclear: [
    { name: 'Nuclear Threat Initiative', url: 'https://www.nti.org/feed/' },
    // IAEA dropped — feed 403s server-side fetches regardless of UA.
  ],
  intelligence: [
    { name: 'The Intercept', url: 'https://theintercept.com/feed/?lang=en' },
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/' },
  ],
};

// ─── Public API ───

/**
 * Fetch OSINT feeds for a given category, returning normalized OSINTItem[].
 * Results are cached under the `osint:{category}` key.
 * Partial results are returned on per-feed errors.
 */
export async function fetchOSINTFeeds(category: string, limit: number = 20): Promise<OSINTItem[]> {
  const cacheKey = `osint:${category}`;
  const cached = await getCached<OSINTItem[]>(cacheKey);
  if (cached) return cached.slice(0, limit);

  const feeds = OSINT_FEEDS[category];
  if (!feeds || feeds.length === 0) {
    return [];
  }

  if (!checkRateLimit('osint')) {
    return [];
  }

  const results = await Promise.allSettled(
    feeds.map((feed) => parseFeed(feed.name, feed.url, category)),
  );

  const items: OSINTItem[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    }
  }

  // Sort by publication date descending (newest first)
  items.sort((a, b) => {
    const dateA = new Date(a.publishedAt).getTime();
    const dateB = new Date(b.publishedAt).getTime();
    return dateB - dateA;
  });

  // Cache the full set, return limited slice
  await setCache(cacheKey, items);
  return items.slice(0, limit);
}

/**
 * Return all available OSINT category keys.
 */
export function getOSINTCategories(): string[] {
  return Object.keys(OSINT_FEEDS);
}

// ─── Internal Helpers ───

async function parseFeed(sourceName: string, url: string, category: string): Promise<OSINTItem[]> {
  try {
    const feed = await parser.parseString(await (await safeFetch(url, {}, 2 * 1024 * 1024)).text());

    return (feed.items ?? []).map((item) => ({
      id: generateId(sourceName, item.guid ?? item.link ?? item.title ?? ''),
      title: item.title ?? 'Untitled',
      summary: item.contentSnippet ?? item.summary ?? undefined,
      url: item.link ?? url,
      source: sourceName,
      category,
      publishedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
    }));
  } catch (error) {
    console.warn(
      `[OSINT] Failed to fetch ${sourceName} (${url}):`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

function generateId(source: string, identifier: string): string {
  const slug = source.toLowerCase().replace(/\s+/g, '-');
  // Simple hash to keep IDs deterministic and short
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    const char = identifier.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32-bit integer
  }
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `osint-${slug}-${hex}`;
}
