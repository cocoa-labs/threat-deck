/**
 * Tests for the FireCrawl client.
 *
 * `fetch` is stubbed via `vi.stubGlobal`; the rate-limiter is mocked
 * (`vi.mock`) so the client takes its happy path without touching Redis or the
 * in-memory limiter. We assert:
 *   - scrape: default/explicit caps, cache-hit short-circuit, 429 backoff, no-key
 *   - search: scrapeOptions on/off (v2 vs v1), capped per-result markdown
 *   - crawl: submit→poll→completed mapping, never-completes→timeout (tiny budget),
 *            hard caps in request body, 402→failed, no-key, title-array normalize
 *   - extract: completed→data, timeout, urls sliced to 5, no-key
 *
 * The async poll loops are budget-aware (`pollMs = Math.min(3000, remaining)`),
 * so a `maxWaitMs: 50` exits in real time — no fake timers required.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the rate limiter: getCached → null by default, all gates open. ──
const mocks = vi.hoisted(() => ({
  getCached: vi.fn(async (_key: string) => null as unknown),
  setCache: vi.fn(async (_key: string, _data: unknown, _ttl?: number) => {}),
  checkRateLimit: vi.fn((_source: string) => true),
  isBackedOff: vi.fn((_source: string) => false),
  setBackoff: vi.fn((_source: string, _ms: number) => {}),
}));

/** Pull the JSON-parsed body out of a recorded fetch call. */
function fetchBody(call: unknown[] | undefined): Record<string, unknown> {
  const init = call?.[1] as RequestInit | undefined;
  return JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
}

/** Pull the URL out of a recorded fetch call. */
function fetchUrl(call: unknown[] | undefined): string {
  return (call?.[0] as string | undefined) ?? '';
}

vi.mock('@/lib/data/rate-limiter', () => ({
  getCached: mocks.getCached,
  setCache: mocks.setCache,
  checkRateLimit: mocks.checkRateLimit,
  isBackedOff: mocks.isBackedOff,
  setBackoff: mocks.setBackoff,
}));

import { firecrawlCrawl, firecrawlExtract, firecrawlScrape, firecrawlSearch } from './firecrawl';

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = 'test-key';
  mocks.getCached.mockResolvedValue(null);
  mocks.setCache.mockResolvedValue(undefined);
  mocks.checkRateLimit.mockReturnValue(true);
  mocks.isBackedOff.mockReturnValue(false);
  mocks.setBackoff.mockClear();
  mocks.setCache.mockClear();
  mocks.checkRateLimit.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────── scrape ───────────────────────────────

describe('firecrawlScrape', () => {
  it('returns markdown capped at the default 8000 chars', async () => {
    const long = 'a'.repeat(20_000);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { markdown: long } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlScrape('https://example.com/article');
    expect(out).not.toBeNull();
    expect(out?.length).toBe(8000);
    // Full(ish) markdown is cached (sliced to 12k), not the read-cap.
    expect(mocks.setCache).toHaveBeenCalledTimes(1);
    const call = mocks.setCache.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error('Expected setCache to be called');
    expect(call[0]).toBe('article-enrich:https://example.com/article:v1');
    expect((call[1] as string).length).toBe(12_000);
  });

  it('honors an explicit numeric maxChars', async () => {
    const long = 'b'.repeat(20_000);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ markdown: long }) })),
    );

    const out = await firecrawlScrape('https://example.com/x', 500);
    expect(out?.length).toBe(500);
  });

  it('honors an options-bag maxChars', async () => {
    const long = 'c'.repeat(20_000);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ markdown: long }) })),
    );

    const out = await firecrawlScrape('https://example.com/x', { maxChars: 1234 });
    expect(out?.length).toBe(1234);
  });

  it('short-circuits on cache hit without calling fetch', async () => {
    mocks.getCached.mockResolvedValue('x'.repeat(12_000));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlScrape('https://example.com/cached', 300);
    expect(out?.length).toBe(300);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets a backoff and returns null on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    );

    const out = await firecrawlScrape('https://example.com/limited');
    expect(out).toBeNull();
    expect(mocks.setBackoff).toHaveBeenCalledWith('firecrawl_scrape', 5 * 60_000);
  });

  it('returns null with no fetch when the API key is missing', async () => {
    process.env.FIRECRAWL_API_KEY = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlScrape('https://example.com/x');
    expect(out).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── search ───────────────────────────────

describe('firecrawlSearch', () => {
  it('back-compat: no opts → no scrapeOptions in body, no markdown field', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ title: 'T', url: 'https://e.com', description: 'D' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await firecrawlSearch('hello', 5);
    expect(res.results).toHaveLength(1);
    expect(res.results[0]?.title).toBe('T');
    expect(res.results[0]?.url).toBe('https://e.com');
    expect(res.results[0]?.markdown).toBeUndefined();

    const body = fetchBody(fetchMock.mock.calls[0]);
    expect(body.scrapeOptions).toBeUndefined();
    expect(fetchUrl(fetchMock.mock.calls[0])).toContain('/v1/search');
  });

  it('scrapeContent:true → v2 with scrapeOptions and capped markdown', async () => {
    const longMd = 'm'.repeat(10_000);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ title: 'T', url: 'https://e.com', description: 'D', markdown: longMd }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await firecrawlSearch('hello', 5, {
      scrapeContent: true,
      maxCharsPerResult: 2500,
    });
    expect(res.results[0]?.markdown?.length).toBe(2500);

    const body = fetchBody(fetchMock.mock.calls[0]);
    expect(body.scrapeOptions).toEqual({ formats: ['markdown'], onlyMainContent: true });
    expect(fetchUrl(fetchMock.mock.calls[0])).toContain('/v2/search');
  });

  it('returns [] (never throws) when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(firecrawlSearch('x')).resolves.toEqual({ results: [] });
  });
});

// ─────────────────────────────── crawl ────────────────────────────────

describe('firecrawlCrawl', () => {
  it('submit → poll(scraping) → poll(completed) maps pages', async () => {
    const fetchMock = vi
      .fn()
      // submit
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'crawl-1' }) })
      // poll #1 — still scraping
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'scraping', data: [] }),
      })
      // poll #2 — completed
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          data: [
            { markdown: 'page one', metadata: { sourceURL: 'https://e.com/1', title: 'One' } },
            { markdown: 'page two', metadata: { sourceURL: 'https://e.com/2', title: 'Two' } },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlCrawl('https://e.com', { maxWaitMs: 5000 });
    expect(out.status).toBe('completed');
    expect(out.pages).toHaveLength(2);
    expect(out.pagesCrawled).toBe(2);
    expect(out.pages[0]).toEqual({ url: 'https://e.com/1', title: 'One', markdown: 'page one' });
  });

  it('never-completes → timeout with partial pages (tiny maxWaitMs), never throws', async () => {
    const fetchMock = vi
      .fn()
      // submit
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'crawl-2' }) })
      // every poll returns "scraping" with one partial page
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'scraping',
          data: [{ markdown: 'partial', metadata: { sourceURL: 'https://e.com/p' } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlCrawl('https://e.com', { maxWaitMs: 50 });
    expect(out.status).toBe('timeout');
    // The single poll we got to populated lastDocs → partial pages surface.
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]?.url).toBe('https://e.com/p');
  });

  it('enforces hard caps in the request body (limit≤10, depth≤2)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'crawl-3' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', data: [] }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await firecrawlCrawl('https://e.com', { limit: 50, maxDepth: 9, maxWaitMs: 5000 });

    const body = fetchBody(fetchMock.mock.calls[0]);
    expect(body.limit).toBe(10);
    expect(body.maxDiscoveryDepth).toBe(2);
    expect(fetchUrl(fetchMock.mock.calls[0])).toContain('/v2/crawl');
  });

  it('402 on submit → failed with credit note', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 402,
        json: async () => ({ error: 'Payment required' }),
      })),
    );

    const out = await firecrawlCrawl('https://e.com');
    expect(out.status).toBe('failed');
    expect(out.note).toBe('firecrawl credits exhausted');
    expect(out.pages).toEqual([]);
  });

  it('returns no_key when the API key is missing', async () => {
    process.env.FIRECRAWL_API_KEY = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlCrawl('https://e.com');
    expect(out.status).toBe('no_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes an array-valued metadata.title to a single string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'crawl-4' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          data: [
            {
              markdown: 'body',
              metadata: { sourceURL: 'https://e.com/a', title: ['First', 'Second'] },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlCrawl('https://e.com', { maxWaitMs: 5000 });
    expect(out.pages[0]?.title).toBe('First');
  });
});

// ────────────────────────────── extract ───────────────────────────────

describe('firecrawlExtract', () => {
  it('submit → poll(completed) returns data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'ext-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', data: { cve: 'CVE-2026-1' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlExtract(['https://e.com'], { prompt: 'find CVEs', maxWaitMs: 5000 });
    expect(out.status).toBe('completed');
    expect(out.data).toEqual({ cve: 'CVE-2026-1' });
  });

  it('never-completes → timeout (tiny maxWaitMs), never throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'ext-2' }) })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'processing' }) });
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlExtract(['https://e.com'], { prompt: 'x', maxWaitMs: 50 });
    expect(out.status).toBe('timeout');
    expect(out.data).toBeNull();
  });

  it('rejects more than five URLs before contacting the provider', async () => {
    const result = await firecrawlExtract(
      Array.from({ length: 6 }, (_, i) => `https://example.org/${i}`),
      { prompt: 'extract' },
    );
    expect(result.status).toBe('failed');
  });

  it('fails clearly when neither prompt nor schema is provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlExtract(['https://e.com'], {});
    expect(out.status).toBe('failed');
    expect(out.note).toContain('prompt or schema');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns no_key when the API key is missing', async () => {
    process.env.FIRECRAWL_API_KEY = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const out = await firecrawlExtract(['https://e.com'], { prompt: 'x' });
    expect(out.status).toBe('no_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
