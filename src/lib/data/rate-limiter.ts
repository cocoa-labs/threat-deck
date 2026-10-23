/**
 * Unified rate limiter with per-source tracking and Redis-backed cache.
 * Rate limiting stays in-memory (fast path).
 * Cache uses Redis when available, with in-memory fallback.
 */

import { isRedisConnected, redis } from '@/lib/redis/client';
import { stampProvenance } from './provenance';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const rateLimits = new Map<string, RateLimitEntry>();
const memCache = new Map<string, CacheEntry>();

// 429 backoff tracking — source → timestamp when backoff expires
const backoffUntil = new Map<string, number>();

/** Set a backoff period for a source after receiving a 429. */
export function setBackoff(source: string, durationMs: number): void {
  backoffUntil.set(source, Date.now() + durationMs);
}

/** Check if a source is currently in backoff from a prior 429. */
export function isBackedOff(source: string): boolean {
  const until = backoffUntil.get(source);
  if (!until) return false;
  if (Date.now() > until) {
    backoffUntil.delete(source);
    return false;
  }
  return true;
}

const CACHE_PREFIX = 'threatdeck:cache:v2:';

// Requests per minute by source
const RATE_LIMITS: Record<string, number> = {
  massive: 15,
  newsapi: 2, // 100/day = ~2/min safe
  coingecko: 10,
  fred: 20,
  alpha_vantage: 75,
  quiver: 5,
  whale_alert: 10,
  usaspending: 20,
  polymarket: 10,
  // Category-level RSS fetches fan out to multiple feeds. Dashboard cold-start
  // can legitimately request ticker + panel + TV context categories at once,
  // so keep this high enough to leave room for interactive tab clicks.
  rss: 30,
  osint: 10,
  finnhub_calendar: 30, // free tier: 60/min, keep conservative
  finnhub_earnings: 30, // separate from finnhub_calendar (used by fed-calendar)
  twitter: 15,
  fdic: 5,
  youtube: 20, // YouTube API uses daily quotas (10K units/day), not per-minute limits; 20/min allows all 10 channels to resolve in one burst
  firecrawl_scrape: 3,
  // ─── Max web tools (WF3): read_url / web_search / crawl_site / extract_structured ───
  firecrawl_read: 5, // read_url single-page scrape
  firecrawl_search: 10, // web_search (content-bearing search)
  firecrawl_crawl: 2, // crawl_site (async crawl — expensive)
  firecrawl_extract: 5, // extract_structured (async extract)
  haiku_summarize: 2, // caption summarization via Haiku
  youtube_search: 10, // ~80 searches/day budget
  youtube_trending: 5, // Low frequency, long cache
  // ─── Cybersecurity Sources (Cocoa AI Threat Deck) ───
  nvd: 5, // NVD REST 2.0 (NIST) — free, optional API key
  cisa_kev: 10, // CISA Known Exploited Vulnerabilities catalog
  abusech: 10, // shared across urlhaus / malwarebazaar / threatfox
  vendor_patches: 10, // RSS-based vendor security advisories
  mitre: 2, // MITRE ATT&CK STIX bundle (large download, cache 24h)
  hibp: 5, // Have I Been Pwned breaches endpoint
  cert_advisories: 10, // CERT RSS feeds (CISA / NCSC-UK / ENISA / JPCERT / etc.)
  ghsa: 30, // GitHub Security Advisories REST API (60/hr unauth, 5000/hr with token)
  github_repo: 30, // GitHub repo metadata + README (read_url fast path; 60/hr unauth, 5000/hr token)
  ai_relevance_score: 10, // Haiku tiebreaker for gray-zone AI-cyber items (Phase 9.2)
  haiku_pivots: 5, // IntelCard pivot suggestions Haiku augmentation (Phase 10.1)
  epss: 60, // FIRST.org EPSS API — public, ~1 req/sec rate limit (Phase 11.A.1)
};

// Cache TTL in seconds by key prefix
const CACHE_TTL: Record<string, number> = {
  markets: 60,
  news: 300,
  crypto: 60,
  sectors: 300,
  commodities: 300,
  fed: 3600,
  government: 1800,
  polymarket: 300,
  whales: 300,
  congress: 300,
  osint: 300,
  earnings: 1800,
  'fed-calendar': 3600,
  twitter: 45,
  livestream: 21600, // 6 hours
  'tv-context': 300, // 5 minutes
  'channel-rss': 120,
  'network-scrape': 180,
  'article-enrich': 43200, // FireCrawl scrape cache (read-sliced) — 12 hours
  // ─── Max web tools (WF3) ───
  webfetch: 21600, // read_url page content — 6 hours
  websearch: 1800, // web_search results — 30 min
  webcrawl: 21600, // crawl_site pages — 6 hours
  webextract: 21600, // extract_structured fields — 6 hours
  'yt-meta': 120,
  'yt-meta-prev': 600,
  'cc-summary': 90, // caption summary
  'cc-prev-summary': 300,
  'youtube-search': 300, // 5 min cache for search results
  'youtube-trending': 1800, // 30 min cache for trending
  chart: 300, // 5 min cache for OHLCV chart data
  cre: 60, // CRE rates/REITs
  fdic: 86400, // FDIC bank health (daily — data is quarterly)
  // ─── Cybersecurity Sources (Cocoa AI Threat Deck) ───
  cve: 300, // CVE feed (NVD + KEV) — 5 min
  iocs: 600, // IOCs (abuse.ch) — 10 min
  patches: 1800, // Vendor advisories — 30 min
  mitre: 86400, // MITRE ATT&CK — 24 hours
  breach: 1800, // Breach disclosures — 30 min
  cert: 1800, // CERT advisories — 30 min
  ghsa: 1800, // GitHub Security Advisories — 30 min
  github_repo: 21600, // GitHub repo data (read_url fast path) — 6 hours
  ai_relevance: 604800, // AI-relevance scores per item URL — 7 days (Phase 9.2)
  pivots: 3600, // IntelCard pivot suggestions per (kind, entityId) — 1 hour (Phase 10.1)
  epss: 86400, // EPSS score per CVE batch — 24 hours (Phase 11.A.1)
};

/** Rate limiting stays in-memory for fast-path performance. */
export function checkRateLimit(source: string): boolean {
  const limit = RATE_LIMITS[source] ?? 10;
  const now = Date.now();

  const entry = rateLimits.get(source);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(source, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}

/**
 * Retrieve cached data. Tries Redis first, falls back to in-memory.
 */
export async function getCached<T>(key: string): Promise<T | null> {
  // Try Redis
  if (isRedisConnected()) {
    try {
      const raw = await redis.get(`${CACHE_PREFIX}${key}`);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry;
        if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now())
          return null;
        const parsed = entry.data as T;
        // Write-through to memory for speed on subsequent hits
        memCache.set(key, entry);
        return parsed;
      }
    } catch {
      // Redis read failed, fall through to memory
    }
  }

  // In-memory fallback
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return entry.data as T;
}

/**
 * Store data in cache. Writes to both Redis and in-memory.
 */
export async function setCache(key: string, data: unknown, ttlOverride?: number): Promise<void> {
  const prefix = key.split(':')[0] ?? 'default';
  const ttl = ttlOverride ?? CACHE_TTL[prefix] ?? 300;

  const expiresAt = Date.now() + ttl * 1000;
  stampProvenance(data, Date.now(), expiresAt);
  // Always write to memory (synchronous, fast)
  memCache.set(key, {
    data,
    expiresAt,
  });

  // Write-through to Redis (async, best-effort)
  if (isRedisConnected()) {
    try {
      await redis.set(`${CACHE_PREFIX}${key}`, JSON.stringify({ data, expiresAt }), 'EX', ttl);
    } catch {
      // Redis write failed, memory cache still has it
    }
  }
}

/**
 * Clear cache entries matching a pattern.
 */
export async function clearCache(pattern?: string): Promise<void> {
  // Clear in-memory
  if (!pattern) {
    memCache.clear();
  } else {
    for (const key of memCache.keys()) {
      if (key.startsWith(pattern)) memCache.delete(key);
    }
  }

  // Clear Redis
  if (isRedisConnected()) {
    try {
      const redisPattern = pattern ? `${CACHE_PREFIX}${pattern}*` : `${CACHE_PREFIX}*`;
      const keys = await redis.keys(redisPattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      // Redis clear failed, memory is already cleared
    }
  }
}
