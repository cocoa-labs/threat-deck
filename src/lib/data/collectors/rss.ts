import Parser from 'rss-parser';
import { scoreItems } from '@/lib/ai-relevance';
import { safeFetch } from '@/lib/security/safe-fetch';
import type { NewsItem } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

type RSSFeed = { name: string; url: string };

/**
 * Categories whose items get inline AI-relevance scoring on cold fetch
 * (Phase 9.2). Keeping this list narrow holds the Haiku cost flat —
 * non-cyber/ai feeds never enter the scoring pipeline.
 */
const AI_RELEVANCE_CATEGORIES = new Set(['cyber', 'ai']);

// ─── RSS Parser Instance ───

const parser = new Parser({
  timeout: 10_000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (compatible; CocoaThreatDeck/1.0; +https://github.com/cocoa-labs/threat-deck)',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

// ─── Feed Registry by Category ───

const RSS_FEEDS = {
  politics: [
    { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
    { name: 'NPR World', url: 'https://feeds.npr.org/1004/rss.xml' },
    { name: 'Guardian World', url: 'https://www.theguardian.com/world/rss' },
    { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  ],
  tech: [
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss' },
    { name: 'NYT Tech', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml' },
  ],
  finance: [
    { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
    { name: 'Bloomberg Markets', url: 'https://feeds.bloomberg.com/markets/news.rss' },
    {
      name: 'CNBC',
      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
    },
    { name: 'Seeking Alpha', url: 'https://seekingalpha.com/market_currents.xml' },
  ],
  government: [
    { name: 'Politico', url: 'https://rss.politico.com/politics-news.xml' },
    { name: 'The Hill', url: 'https://thehill.com/feed/' },
    { name: 'NYT Politics', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml' },
    { name: 'NPR Politics', url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'Axios', url: 'https://api.axios.com/feed/' },
  ],
  defense: [
    { name: 'Bellingcat', url: 'https://www.bellingcat.com/feed/' },
    { name: 'Defense One', url: 'https://www.defenseone.com/rss/all/' },
    { name: 'War on the Rocks', url: 'https://warontherocks.com/feed/' },
    { name: 'RAND Blog', url: 'https://www.rand.org/blog.xml' },
  ],
  ai: [
    // ─── Slow corporate labs (weekly–monthly cadence; kept for depth) ───
    { name: 'AI News', url: 'https://www.artificialintelligence-news.com/feed/' },
    { name: 'MarkTechPost', url: 'https://www.marktechpost.com/feed/' },
    { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
    { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/' },
    { name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
    // ─── Fast cadence (Phase 2 source mix) ─── all URLs verified to parse to
    // real items via rss-parser as of 2026-06-06. Recency sort floats fresh
    // items up. arXiv cs.AI dropped: HTTP 200 XML but its feed body carries 0
    // <item> entries, so rss-parser yields nothing (silent no-op).
    {
      name: 'Hacker News (AI)',
      url: 'https://hnrss.org/newest?q=AI+OR+LLM+OR+GPT&count=30',
    },
    { name: 'The Decoder', url: 'https://the-decoder.com/feed/' },
    { name: 'Import AI', url: 'https://importai.substack.com/feed' },
    { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/' },
    { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
  ],
  cyber: [
    // ─── General cyber baseline ───
    { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/' },
    { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
    { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews' },
    { name: 'SANS ISC', url: 'https://isc.sans.edu/rssfeed_full.xml' },
    { name: 'CyberScoop', url: 'https://cyberscoop.com/feed/' },
    { name: 'The Record', url: 'https://therecord.media/feed' },
    { name: 'Help Net Security', url: 'https://feeds.feedburner.com/HelpNetSecurity' },
    // Dark Reading dropped: rss.xml 404s and the site bot-blocks server fetches.
    { name: 'SecurityWeek', url: 'https://www.securityweek.com/feed/' },
    { name: 'The Register Security', url: 'https://www.theregister.com/security/headlines.atom' },
    // ─── Vendor / research threat blogs (Phase 2 source mix) ─── all URLs
    // verified to return XML/RSS/Atom as of 2026-06-06.
    { name: 'Cisco Talos', url: 'https://blog.talosintelligence.com/rss/' },
    {
      name: 'Google Project Zero',
      url: 'https://googleprojectzero.blogspot.com/feeds/posts/default',
    },
    { name: 'Unit 42', url: 'https://unit42.paloaltonetworks.com/feed/' },
    { name: 'Microsoft Security', url: 'https://www.microsoft.com/en-us/security/blog/feed/' },
    // ─── AI-cyber niche (Phase 9.3) ─── all URLs verified to return XML/Atom
    // application/* content-type as of 2026-05-24. Footgun: HiddenLayer,
    // Lakera, and Anthropic do NOT currently expose RSS. Revisit quarterly.
    { name: 'AI Incident Database', url: 'https://incidentdatabase.ai/rss.xml' },
    { name: 'OWASP Gen AI / LLM Top 10', url: 'https://genai.owasp.org/feed/' },
    { name: 'Protect AI Blog', url: 'https://protectai.com/blog/atom.xml' },
    { name: 'Promptfoo Blog', url: 'https://www.promptfoo.dev/blog/rss.xml' },
    {
      name: 'MITRE ATLAS Data',
      url: 'https://github.com/mitre-atlas/atlas-data/commits/main.atom',
    },
    { name: 'Embrace The Red', url: 'https://embracethered.com/blog/index.xml' },
    { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
    { name: 'AI Snake Oil', url: 'https://www.aisnakeoil.com/feed' },
  ],
} satisfies Record<string, RSSFeed[]>;

export type RSSCategory = keyof typeof RSS_FEEDS;

export interface RSSFeedResult {
  requestedCategory: string;
  category: RSSCategory;
  items: NewsItem[];
  count: number;
  degradedReason?: 'rate_limited' | 'empty_fetch';
}

type RSSCategoryLoadResult = Pick<RSSFeedResult, 'items' | 'degradedReason'>;

const RSS_CATEGORY_ALIASES: Record<string, RSSCategory> = {
  financial: 'finance',
  geopolitics: 'politics',
  geopolitical: 'politics',
  gov: 'government',
  government_policy: 'government',
  policy: 'government',
  tech_ai: 'tech',
  technology: 'tech',
  cybersecurity: 'cyber',
  security: 'cyber',
};

const inFlightCategoryFetches = new Map<RSSCategory, Promise<RSSCategoryLoadResult>>();

// ─── Public API ───

/**
 * Normalize route/tool-facing category names to the collector's canonical keys.
 */
export function normalizeNewsCategory(category: string): RSSCategory | null {
  const normalized = category.trim().toLowerCase();
  if (isRSSCategory(normalized)) return normalized;
  return RSS_CATEGORY_ALIASES[normalized] ?? null;
}

export function isRSSCategory(category: string): category is RSSCategory {
  return Object.hasOwn(RSS_FEEDS, category);
}

/**
 * Fetch RSS feeds for a given category, returning normalized NewsItem[].
 * Results are cached under the `news:{category}` key.
 * Partial results are returned on per-feed errors.
 */
export async function fetchRSSFeeds(category: string, limit: number = 20): Promise<NewsItem[]> {
  if (!normalizeNewsCategory(category)) return [];
  const result = await fetchRSSFeedResult(category, limit);
  return result.items;
}

/**
 * Fetch RSS feeds with metadata that lets routes and panels distinguish a true
 * empty feed from transient degradation such as cold-start rate pressure.
 */
export async function fetchRSSFeedResult(
  category: string,
  limit: number = 20,
): Promise<RSSFeedResult> {
  const canonicalCategory = normalizeNewsCategory(category);
  if (!canonicalCategory) {
    throw new Error(`Unknown RSS category: ${category}`);
  }

  const result = await loadCategory(canonicalCategory);
  const items = result.items.slice(0, limit);

  return {
    requestedCategory: category,
    category: canonicalCategory,
    items,
    count: items.length,
    ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
  };
}

async function loadCategory(category: RSSCategory): Promise<RSSCategoryLoadResult> {
  const cacheKey = `news:${category}`;
  const cached = await getCached<NewsItem[]>(cacheKey);
  if (cached && cached.length > 0) return { items: cached };

  const feeds = RSS_FEEDS[category];
  const inFlight = inFlightCategoryFetches.get(category);
  if (inFlight) return inFlight;

  if (!checkRateLimit('rss')) {
    return { items: [], degradedReason: 'rate_limited' };
  }

  const fetchPromise = fetchCategoryFresh(category, feeds).finally(() => {
    inFlightCategoryFetches.delete(category);
  });
  inFlightCategoryFetches.set(category, fetchPromise);
  return fetchPromise;
}

async function fetchCategoryFresh(
  category: RSSCategory,
  feeds: RSSFeed[],
): Promise<RSSCategoryLoadResult> {
  const results = await Promise.allSettled(
    feeds.map((feed) => parseFeed(feed.name, feed.url, category)),
  );

  const items = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));

  // Sort by publication date descending (newest first)
  items.sort((a, b) => {
    const dateA = new Date(a.publishedAt).getTime();
    const dateB = new Date(b.publishedAt).getTime();
    return dateB - dateA;
  });

  // Phase 9.2 — attach AI-relevance scores to cyber/ai items before caching,
  // so downstream consumers (Cyber Wire narrowing, daily-brief generator)
  // see pre-scored items and don't pay Haiku cost per page render.
  // Fail-soft: any scorer error degrades to unscored items, never throws.
  if (AI_RELEVANCE_CATEGORIES.has(category)) {
    await attachAiRelevance(items);
  }

  if (items.length === 0) {
    return { items, degradedReason: 'empty_fetch' };
  }

  // Cache only successful non-empty fetches. A transient all-feed failure should
  // not poison a category tab with "No news" for the full cache TTL.
  const cacheKey = `news:${category}`;
  await setCache(cacheKey, items);
  return { items };
}

/**
 * Mutates `items` in place, attaching `aiRelevance` and `aiCategory` per the
 * Phase 9.2 scoring pipeline. Items that fail to score (network, DB, parse
 * errors) keep their existing shape — consumers should treat the absence of
 * `aiRelevance` as "unscored", not "definitely not AI-cyber".
 */
async function attachAiRelevance(items: NewsItem[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const scores = await scoreItems(
      items.map((item) => ({ url: item.url, title: item.title, summary: item.summary })),
    );
    // Walk in lockstep — scoreItems preserves input order
    for (let i = 0; i < items.length; i++) {
      const score = scores[i];
      if (!score) continue;
      items[i]!.aiRelevance = score.aiRelevance;
      items[i]!.aiCategory = score.aiCategory;
    }
  } catch {
    // scoreItems is internally fail-soft; if we still get here, accept
    // unscored items rather than failing the whole RSS fetch.
  }
}

/**
 * Return all available RSS category keys.
 */
export function getRSSCategories(): string[] {
  return Object.keys(RSS_FEEDS);
}

// ─── Internal Helpers ───

async function parseFeed(sourceName: string, url: string, category: string): Promise<NewsItem[]> {
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
      imageUrl: item.enclosure?.url ?? undefined,
    }));
  } catch (error) {
    console.warn(
      `[RSS] Failed to fetch ${sourceName} (${url}):`,
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
  return `rss-${slug}-${hex}`;
}
