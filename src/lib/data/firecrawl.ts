import { safeFetch, validatePublicUrl } from '@/lib/security/safe-fetch';
import { checkRateLimit, getCached, isBackedOff, setBackoff, setCache } from './rate-limiter';

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';
const FIRECRAWL_V2 = 'https://api.firecrawl.dev/v2';
const API_KEY = () => process.env.FIRECRAWL_API_KEY;

export interface FirecrawlSearchResult {
  title: string;
  url: string;
  description: string;
  /** Present only when called with `scrapeContent: true`. Capped markdown. */
  markdown?: string;
}

export interface FirecrawlSearchResponse {
  results: FirecrawlSearchResult[];
}

export interface FirecrawlCrawlPage {
  url: string;
  title?: string;
  markdown: string;
}

export interface FirecrawlCrawlResult {
  status: 'completed' | 'partial' | 'timeout' | 'failed' | 'no_key';
  pages: FirecrawlCrawlPage[];
  pagesCrawled: number;
  note?: string;
}

export interface FirecrawlExtractResult {
  status: 'completed' | 'timeout' | 'failed' | 'no_key';
  data: unknown;
  note?: string;
}

/** Shape of a FireCrawl scraped document's metadata (subset we read). */
interface FirecrawlMetadata {
  sourceURL?: string;
  url?: string;
  // FireCrawl occasionally returns `title` as an array of strings.
  title?: string | string[];
}

interface FirecrawlDoc {
  markdown?: string;
  metadata?: FirecrawlMetadata;
}

/** Normalize a possibly-array title into a single string (or undefined). */
function normalizeTitle(title: string | string[] | undefined): string | undefined {
  if (Array.isArray(title)) return title[0];
  return title;
}

/**
 * Scrape a single URL via FireCrawl `/scrape` (v1) and return markdown content.
 * Best-effort — never throws, returns null on any failure.
 *
 * Caching: stores the FULL markdown (~12k) under `article-enrich:${url}:v1` and
 * slices on read, so one cache entry serves any `maxChars` caller. Used by the
 * correlation engine (news-panel clicks) and the agent `read_url` tool.
 *
 * Back-compat: `correlation.ts` calls `firecrawlScrape(url)` (no 2nd arg);
 * others may pass a plain `number`. Both are supported alongside an options bag.
 */
export async function firecrawlScrape(
  url: string,
  maxCharsOrOpts:
    | number
    | { maxChars?: number; timeoutMs?: number; onlyMainContent?: boolean } = 8000,
): Promise<string | null> {
  try {
    await validatePublicUrl(url);
  } catch {
    return null;
  }
  const opts = typeof maxCharsOrOpts === 'number' ? { maxChars: maxCharsOrOpts } : maxCharsOrOpts;
  const maxChars = opts.maxChars ?? 8000;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const onlyMainContent = opts.onlyMainContent ?? true;

  const cacheKey = `article-enrich:${url}:v1`;
  const cached = await getCached<string>(cacheKey);
  if (cached) return cached.slice(0, maxChars);

  const apiKey = API_KEY();
  if (!apiKey) return null;

  if (isBackedOff('firecrawl_scrape')) return null;
  if (!checkRateLimit('firecrawl_scrape')) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const res = await safeFetch(`${FIRECRAWL_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.status === 429) {
      setBackoff('firecrawl_scrape', 5 * 60_000);
      return null;
    }

    if (!res.ok) {
      console.warn(`[FireCrawl] Scrape returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { data?: FirecrawlDoc; markdown?: string };
    const markdown = (data.data?.markdown ?? data.markdown ?? '') as string;
    if (!markdown) return null;

    // Cache the full(ish) markdown so any future maxChars caller is served.
    await setCache(cacheKey, markdown.slice(0, 12_000));
    return markdown.slice(0, maxChars);
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      console.warn('[FireCrawl] Scrape failed:', error instanceof Error ? error.message : error);
    }
    return null;
  }
}

/**
 * Search the web via FireCrawl `/search` (v1) and return title/url/description.
 *
 * With `opts.scrapeContent`, routes to v2 `/search` with `scrapeOptions` so each
 * result also carries capped `markdown`. Without opts, behavior is identical to
 * the original v1 path (back-compat for youtube-search and the base web_search).
 */
export async function firecrawlSearch(
  query: string,
  limit: number = 5,
  opts?: { scrapeContent?: boolean; maxCharsPerResult?: number },
): Promise<FirecrawlSearchResponse> {
  const apiKey = API_KEY();
  if (!apiKey) {
    return { results: [] };
  }

  const scrapeContent = opts?.scrapeContent === true;
  const maxCharsPerResult = opts?.maxCharsPerResult ?? 3000;

  try {
    const endpoint = scrapeContent ? `${FIRECRAWL_V2}/search` : `${FIRECRAWL_BASE}/search`;
    const body: Record<string, unknown> = { query, limit };
    if (scrapeContent) {
      body.scrapeOptions = { formats: ['markdown'], onlyMainContent: true };
    }

    const res = await safeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`[FireCrawl] API returned ${res.status}`);
      return { results: [] };
    }

    const data = (await res.json()) as { data?: unknown; results?: unknown };
    // v2 may nest web results under data.web; v1 returns a flat data array.
    const dataField = data.data as Record<string, unknown> | unknown[] | undefined;
    const rawResults = Array.isArray(dataField)
      ? dataField
      : ((dataField as Record<string, unknown>)?.web ??
        (data.results as unknown[] | undefined) ??
        []);

    return {
      results: (rawResults as Record<string, unknown>[]).map((r: Record<string, unknown>) => {
        const result: FirecrawlSearchResult = {
          title: (r.title as string) ?? '',
          url: (r.url as string) ?? '',
          description: (r.description as string) ?? (r.markdown as string)?.slice(0, 200) ?? '',
        };
        if (scrapeContent && typeof r.markdown === 'string') {
          result.markdown = r.markdown.slice(0, maxCharsPerResult);
        }
        return result;
      }),
    };
  } catch (error) {
    console.warn('[FireCrawl] Search failed:', error instanceof Error ? error.message : error);
    return { results: [] };
  }
}

/** Map raw FireCrawl docs → deduped, capped crawl pages. */
function mapPages(
  docs: FirecrawlDoc[] | undefined,
  maxCharsPerPage: number,
  limit: number,
): FirecrawlCrawlPage[] {
  if (!Array.isArray(docs)) return [];
  const seen = new Set<string>();
  const pages: FirecrawlCrawlPage[] = [];
  for (const doc of docs) {
    const meta = doc.metadata ?? {};
    const pageUrl = meta.sourceURL ?? meta.url;
    if (!pageUrl || seen.has(pageUrl)) continue;
    seen.add(pageUrl);
    pages.push({
      url: pageUrl,
      title: normalizeTitle(meta.title),
      markdown: (doc.markdown ?? '').slice(0, maxCharsPerPage),
    });
    if (pages.length >= limit) break;
  }
  return pages;
}

/**
 * Crawl a site via FireCrawl `/crawl` (v2, async submit→poll).
 * Hard-capped and never throws — returns an honest status with whatever pages
 * were gathered (a `timeout`/`partial` still carries usable pages).
 *
 * The poll loop is budget-aware: it checks elapsed time and uses
 * `pollMs = Math.min(3000, remaining)`, so a tiny `maxWaitMs` (e.g. 50ms) exits
 * fast — no fake timers needed in tests.
 */
export async function firecrawlCrawl(
  url: string,
  opts?: {
    limit?: number;
    maxDepth?: number;
    maxCharsPerPage?: number;
    maxWaitMs?: number;
  },
): Promise<FirecrawlCrawlResult> {
  try {
    await validatePublicUrl(url);
  } catch {
    return { status: 'failed', pages: [], pagesCrawled: 0 };
  }
  const apiKey = API_KEY();
  if (!apiKey) {
    return { status: 'no_key', pages: [], pagesCrawled: 0 };
  }

  // Hard caps — ignore caller overrides that exceed them.
  const limit = Math.min(opts?.limit ?? 8, 10);
  const maxDiscoveryDepth = Math.min(opts?.maxDepth ?? 2, 2);
  const maxCharsPerPage = opts?.maxCharsPerPage ?? 4000;
  const maxWaitMs = Math.min(opts?.maxWaitMs ?? 75_000, 90_000);

  try {
    // ── Submit ──
    const submitRes = await safeFetch(`${FIRECRAWL_V2}/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        limit,
        maxDiscoveryDepth,
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (submitRes.status === 402) {
      return { status: 'failed', pages: [], pagesCrawled: 0, note: 'firecrawl credits exhausted' };
    }
    if (!submitRes.ok) {
      return {
        status: 'failed',
        pages: [],
        pagesCrawled: 0,
        note: `crawl submit returned ${submitRes.status}`,
      };
    }

    const submit = (await submitRes.json()) as { id?: string };
    const id = submit.id;
    if (!id) {
      return { status: 'failed', pages: [], pagesCrawled: 0, note: 'no crawl id returned' };
    }

    // ── Bounded poll ──
    const startedAt = Date.now();
    let lastDocs: FirecrawlDoc[] | undefined;

    while (true) {
      const remaining = maxWaitMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        const pages = mapPages(lastDocs, maxCharsPerPage, limit);
        return { status: 'timeout', pages, pagesCrawled: pages.length };
      }

      const pollRes = await safeFetch(`${FIRECRAWL_V2}/crawl/${id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (pollRes.status === 402) {
        const pages = mapPages(lastDocs, maxCharsPerPage, limit);
        return {
          status: 'failed',
          pages,
          pagesCrawled: pages.length,
          note: 'firecrawl credits exhausted',
        };
      }
      if (!pollRes.ok) {
        const pages = mapPages(lastDocs, maxCharsPerPage, limit);
        return {
          status: 'failed',
          pages,
          pagesCrawled: pages.length,
          note: `crawl poll returned ${pollRes.status}`,
        };
      }

      const poll = (await pollRes.json()) as { status?: string; data?: FirecrawlDoc[] };
      if (Array.isArray(poll.data)) lastDocs = poll.data;

      if (poll.status === 'completed') {
        const pages = mapPages(poll.data ?? lastDocs, maxCharsPerPage, limit);
        return { status: 'completed', pages, pagesCrawled: pages.length };
      }
      if (poll.status === 'failed') {
        const pages = mapPages(lastDocs, maxCharsPerPage, limit);
        return {
          status: 'partial',
          pages,
          pagesCrawled: pages.length,
          note: 'crawl reported failed',
        };
      }

      // Still scraping — wait, but never past the remaining budget.
      const pollMs = Math.min(3000, maxWaitMs - (Date.now() - startedAt));
      if (pollMs <= 0) {
        const pages = mapPages(lastDocs, maxCharsPerPage, limit);
        return { status: 'timeout', pages, pagesCrawled: pages.length };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } catch (error) {
    return {
      status: 'failed',
      pages: [],
      pagesCrawled: 0,
      note: error instanceof Error ? error.message : 'crawl failed',
    };
  }
}

/**
 * Extract structured fields from URLs via FireCrawl `/extract` (v2, async).
 * Requires a `prompt` and/or a raw JSON `schema`. Never throws.
 *
 * Poll loop mirrors `firecrawlCrawl` — budget-aware fast-exit for testability.
 */
export async function firecrawlExtract(
  urls: string[],
  opts: { prompt?: string; schema?: unknown; maxWaitMs?: number },
): Promise<FirecrawlExtractResult> {
  if (urls.length > 5) return { status: 'failed', data: null, note: 'unsafe_url' };
  try {
    await Promise.all(urls.map((url) => validatePublicUrl(url)));
  } catch {
    return { status: 'failed', data: null, note: 'unsafe_url' };
  }
  const targetUrls = urls.slice(0, 5);
  if (!opts.prompt && !opts.schema) {
    return { status: 'failed', data: null, note: 'extract requires a prompt or schema' };
  }

  const apiKey = API_KEY();
  if (!apiKey) {
    return { status: 'no_key', data: null };
  }

  const maxWaitMs = Math.min(opts.maxWaitMs ?? 60_000, 75_000);

  try {
    const body: Record<string, unknown> = { urls: targetUrls };
    if (opts.prompt) body.prompt = opts.prompt;
    if (opts.schema) body.schema = opts.schema;

    // ── Submit ──
    const submitRes = await safeFetch(`${FIRECRAWL_V2}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (submitRes.status === 402) {
      return { status: 'failed', data: null, note: 'firecrawl credits exhausted' };
    }
    if (!submitRes.ok) {
      return { status: 'failed', data: null, note: `extract submit returned ${submitRes.status}` };
    }

    const submit = (await submitRes.json()) as { id?: string };
    const id = submit.id;
    if (!id) {
      return { status: 'failed', data: null, note: 'no extract id returned' };
    }

    // ── Bounded poll ──
    const startedAt = Date.now();

    while (true) {
      const remaining = maxWaitMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        return { status: 'timeout', data: null, note: 'extract did not complete in time' };
      }

      const pollRes = await safeFetch(`${FIRECRAWL_V2}/extract/${id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });

      if (pollRes.status === 402) {
        return { status: 'failed', data: null, note: 'firecrawl credits exhausted' };
      }
      if (!pollRes.ok) {
        return { status: 'failed', data: null, note: `extract poll returned ${pollRes.status}` };
      }

      const poll = (await pollRes.json()) as { status?: string; data?: unknown };

      if (poll.status === 'completed') {
        return { status: 'completed', data: poll.data ?? null };
      }
      if (poll.status === 'failed') {
        return { status: 'failed', data: null, note: 'extract reported failed' };
      }

      const pollMs = Math.min(3000, maxWaitMs - (Date.now() - startedAt));
      if (pollMs <= 0) {
        return { status: 'timeout', data: null, note: 'extract did not complete in time' };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } catch (error) {
    return {
      status: 'failed',
      data: null,
      note: error instanceof Error ? error.message : 'extract failed',
    };
  }
}
