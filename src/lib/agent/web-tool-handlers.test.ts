/**
 * Tests for the four Max web tools (WF3): read_url / web_search / crawl_site /
 * extract_structured.
 *
 * Mocks the FireCrawl client, the GitHub client, and the rate-limiter so no
 * real network or cache I/O happens. Covers: input validation, sourceUrl on
 * every success, the read_url GitHub-fast-path → scrape-fallback order, content
 * capping, cache short-circuit, the rate-limit gate, graceful degradation, and
 * preset resolution. Plus the CRITICAL compressor regression guard: a
 * read_url-shaped ~10k-char result must survive ToolResultCompressor.compress at
 * tokenBudget 14000 with policy FULL (no 200-char shred).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── FireCrawl client mock ──
const mockScrape = vi.fn();
const mockSearch = vi.fn();
const mockCrawl = vi.fn();
const mockExtract = vi.fn();
vi.mock('@/lib/data/firecrawl', () => ({
  firecrawlScrape: (...a: unknown[]) => mockScrape(...a),
  firecrawlSearch: (...a: unknown[]) => mockSearch(...a),
  firecrawlCrawl: (...a: unknown[]) => mockCrawl(...a),
  firecrawlExtract: (...a: unknown[]) => mockExtract(...a),
}));

// ── GitHub client mock ──
const mockParseGithubUrl = vi.fn();
const mockFetchGithubRepo = vi.fn();
vi.mock('@/lib/data/github-repo', () => ({
  parseGithubUrl: (...a: unknown[]) => mockParseGithubUrl(...a),
  fetchGithubRepo: (...a: unknown[]) => mockFetchGithubRepo(...a),
}));

// ── Rate-limiter mock — getCached → null, checkRateLimit → true by default ──
const mockGetCached = vi.fn();
const mockSetCache = vi.fn();
const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/data/rate-limiter', () => ({
  getCached: (...a: unknown[]) => mockGetCached(...a),
  setCache: (...a: unknown[]) => mockSetCache(...a),
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
}));

const { readUrl, webSearch, crawlSite, extractStructured } = await import('./tool-handlers');
const { ToolResultCompressor } = await import('./tool-compressor');
const { StoragePolicy } = await import('./types');

// A non-github URL whose parse result has kind 'other' so the GitHub fast path
// is skipped and the scrape path runs.
function nonGithubParse() {
  mockParseGithubUrl.mockReturnValue({ owner: null, repo: null, kind: 'other' });
}

beforeEach(() => {
  mockScrape.mockReset();
  mockSearch.mockReset();
  mockCrawl.mockReset();
  mockExtract.mockReset();
  mockParseGithubUrl.mockReset();
  mockFetchGithubRepo.mockReset();
  mockGetCached.mockReset().mockResolvedValue(null);
  mockSetCache.mockReset().mockResolvedValue(undefined);
  mockCheckRateLimit.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════
// Input validation → { error }
// ════════════════════════════════════════════════════════════

describe('input validation', () => {
  it('read_url rejects a non-http URL', async () => {
    const r = (await readUrl({ url: 'ftp://nope.example/file' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('read_url rejects empty/missing url', async () => {
    const r = (await readUrl({})) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
  });

  it('web_search rejects an empty query', async () => {
    const r = (await webSearch({ query: '   ' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('crawl_site rejects a non-http url', async () => {
    const r = (await crawlSite({ url: 'not-a-url' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(mockCrawl).not.toHaveBeenCalled();
  });

  it('extract_structured rejects when no url/urls given', async () => {
    const r = (await extractStructured({ preset: 'iocs' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('extract_structured rejects an unknown preset (no prompt/schema)', async () => {
    const r = (await extractStructured({
      url: 'https://x.example/advisory',
      preset: 'bogus_preset',
    })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(String(r.error)).toContain('bogus_preset');
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('extract_structured rejects when neither preset, prompt, nor schema given', async () => {
    const r = (await extractStructured({
      url: 'https://x.example/advisory',
    })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(mockExtract).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════
// read_url — GitHub fast path / scrape fallback / non-github
// ════════════════════════════════════════════════════════════

describe('read_url GitHub seam', () => {
  it('returns github_repo data when parse=repo and fetchGithubRepo succeeds (no scrape)', async () => {
    mockParseGithubUrl.mockReturnValue({ owner: 'acme', repo: 'tool', kind: 'repo' });
    mockFetchGithubRepo.mockResolvedValue({
      sourceUrl: 'https://github.com/acme/tool',
      stars: 42,
      readme: '# Tool',
    });

    const r = (await readUrl({ url: 'https://github.com/acme/tool' })) as Record<string, unknown>;

    expect(r.kind).toBe('github_repo');
    expect(r.sourceUrl).toBe('https://github.com/acme/tool');
    expect(r.repo).toBeTruthy();
    expect(mockFetchGithubRepo).toHaveBeenCalledWith('acme', 'tool', { includeFileTree: false });
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('passes include_file_tree through to fetchGithubRepo', async () => {
    mockParseGithubUrl.mockReturnValue({ owner: 'acme', repo: 'tool', kind: 'repo' });
    mockFetchGithubRepo.mockResolvedValue({ sourceUrl: 'https://github.com/acme/tool' });

    await readUrl({ url: 'https://github.com/acme/tool', include_file_tree: true });

    expect(mockFetchGithubRepo).toHaveBeenCalledWith('acme', 'tool', { includeFileTree: true });
  });

  it('falls back to scrape when fetchGithubRepo returns null', async () => {
    mockParseGithubUrl.mockReturnValue({ owner: 'acme', repo: 'gone', kind: 'repo' });
    mockFetchGithubRepo.mockResolvedValue(null);
    mockScrape.mockResolvedValue('# Scraped fallback body');

    const r = (await readUrl({ url: 'https://github.com/acme/gone' })) as Record<string, unknown>;

    expect(mockFetchGithubRepo).toHaveBeenCalled();
    expect(mockScrape).toHaveBeenCalled();
    expect(r.kind).toBe('markdown');
    expect(r.sourceUrl).toBe('https://github.com/acme/gone');
  });

  it('uses the scrape path for a non-github URL', async () => {
    nonGithubParse();
    mockScrape.mockResolvedValue('# Plain article');

    const r = (await readUrl({ url: 'https://news.example/post' })) as Record<string, unknown>;

    expect(mockFetchGithubRepo).not.toHaveBeenCalled();
    expect(mockScrape).toHaveBeenCalledWith('https://news.example/post', { maxChars: 10500 });
    expect(r.kind).toBe('markdown');
    expect(r.contentMarkdown).toBe('# Plain article');
    expect(r.sourceUrl).toBe('https://news.example/post');
  });
});

// ════════════════════════════════════════════════════════════
// sourceUrl present on every success
// ════════════════════════════════════════════════════════════

describe('sourceUrl on every success', () => {
  it('read_url (scrape) carries sourceUrl', async () => {
    nonGithubParse();
    mockScrape.mockResolvedValue('body');
    const r = (await readUrl({ url: 'https://a.example/x' })) as Record<string, unknown>;
    expect(r.sourceUrl).toBe('https://a.example/x');
  });

  it('web_search results each carry sourceUrl', async () => {
    mockSearch.mockResolvedValue({
      results: [
        { title: 'T1', url: 'https://r1.example', description: 'd1', markdown: 'body1' },
        { title: 'T2', url: 'https://r2.example', description: 'd2' },
      ],
    });
    const r = (await webSearch({ query: 'cyber news' })) as {
      results: Array<Record<string, unknown>>;
    };
    expect(r.results).toHaveLength(2);
    expect(r.results[0]!.sourceUrl).toBe('https://r1.example');
    expect(r.results[1]!.sourceUrl).toBe('https://r2.example');
  });

  it('crawl_site result + each page carry sourceUrl', async () => {
    mockCrawl.mockResolvedValue({
      status: 'completed',
      pagesCrawled: 1,
      pages: [{ url: 'https://docs.example/p1', title: 'P1', markdown: 'page body' }],
    });
    const r = (await crawlSite({ url: 'https://docs.example' })) as {
      sourceUrl: string;
      pages: Array<Record<string, unknown>>;
    };
    expect(r.sourceUrl).toBe('https://docs.example');
    expect(r.pages[0]!.sourceUrl).toBe('https://docs.example/p1');
  });

  it('extract_structured result carries sourceUrl', async () => {
    mockExtract.mockResolvedValue({ status: 'completed', data: { iocs: [] } });
    const r = (await extractStructured({
      url: 'https://adv.example/x',
      preset: 'iocs',
    })) as Record<string, unknown>;
    expect(r.sourceUrl).toBe('https://adv.example/x');
  });
});

// ════════════════════════════════════════════════════════════
// Content capping
// ════════════════════════════════════════════════════════════

describe('content capping', () => {
  it('read_url truncates >10000-char markdown and flags truncated', async () => {
    nonGithubParse();
    const big = 'x'.repeat(10500);
    mockScrape.mockResolvedValue(big);

    const r = (await readUrl({ url: 'https://big.example' })) as Record<string, unknown>;

    expect(r.truncated).toBe(true);
    expect(String(r.contentMarkdown)).toContain('…[truncated]');
    // 10000 content chars + the suffix marker.
    expect(String(r.contentMarkdown).startsWith('x'.repeat(10000))).toBe(true);
    expect(String(r.contentMarkdown).length).toBeGreaterThan(10000);
    expect(r.charCount).toBe(String(r.contentMarkdown).length);
  });

  it('read_url leaves short markdown untruncated', async () => {
    nonGithubParse();
    mockScrape.mockResolvedValue('short body');
    const r = (await readUrl({ url: 'https://s.example' })) as Record<string, unknown>;
    expect(r.truncated).toBe(false);
    expect(r.contentMarkdown).toBe('short body');
  });

  it('web_search maps result content from markdown (null when absent)', async () => {
    mockSearch.mockResolvedValue({
      results: [
        { title: 'T1', url: 'https://r1.example', description: 'd1', markdown: 'full body 1' },
        { title: 'T2', url: 'https://r2.example', description: 'd2' },
      ],
    });
    const r = (await webSearch({ query: 'q' })) as { results: Array<Record<string, unknown>> };
    expect(r.results[0]!.content).toBe('full body 1');
    expect(r.results[1]!.content).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
// Cache short-circuits the client
// ════════════════════════════════════════════════════════════

describe('cache short-circuit', () => {
  it('read_url returns the cached value without scraping', async () => {
    nonGithubParse();
    mockGetCached.mockResolvedValue({
      kind: 'markdown',
      sourceUrl: 'https://c.example',
      cached: 1,
    });

    const r = (await readUrl({ url: 'https://c.example' })) as Record<string, unknown>;

    expect(r.cached).toBe(1);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('web_search returns the cached value without searching', async () => {
    mockGetCached.mockResolvedValue({ query: 'q', count: 0, results: [], cached: true });
    const r = (await webSearch({ query: 'q' })) as Record<string, unknown>;
    expect(r.cached).toBe(true);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('crawl_site returns the cached value without crawling', async () => {
    mockGetCached.mockResolvedValue({ sourceUrl: 'https://d.example', cached: true });
    const r = (await crawlSite({ url: 'https://d.example' })) as Record<string, unknown>;
    expect(r.cached).toBe(true);
    expect(mockCrawl).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════
// Rate-limit gate → { error }, no client call
// ════════════════════════════════════════════════════════════

describe('rate-limit gate', () => {
  it('read_url returns error + sourceUrl, no scrape, when rate-limited', async () => {
    nonGithubParse();
    mockCheckRateLimit.mockReturnValue(false);

    const r = (await readUrl({ url: 'https://rl.example' })) as Record<string, unknown>;

    expect(r.error).toBeTruthy();
    expect(r.sourceUrl).toBe('https://rl.example');
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('web_search returns error, no search, when rate-limited', async () => {
    mockCheckRateLimit.mockReturnValue(false);
    const r = (await webSearch({ query: 'q' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('crawl_site returns error, no crawl, when rate-limited', async () => {
    mockCheckRateLimit.mockReturnValue(false);
    const r = (await crawlSite({ url: 'https://rl.example' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(r.sourceUrl).toBe('https://rl.example');
    expect(mockCrawl).not.toHaveBeenCalled();
  });

  it('extract_structured returns error, no extract, when rate-limited', async () => {
    mockCheckRateLimit.mockReturnValue(false);
    const r = (await extractStructured({
      url: 'https://rl.example',
      preset: 'iocs',
    })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(mockExtract).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════
// Graceful degradation
// ════════════════════════════════════════════════════════════

describe('graceful degradation', () => {
  it('read_url: scrape null → friendly error + sourceUrl', async () => {
    nonGithubParse();
    mockScrape.mockResolvedValue(null);
    const r = (await readUrl({ url: 'https://blocked.example' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(r.sourceUrl).toBe('https://blocked.example');
  });

  it('crawl_site: timeout WITH pages returns the pages, not an error', async () => {
    mockCrawl.mockResolvedValue({
      status: 'timeout',
      pagesCrawled: 2,
      pages: [
        { url: 'https://d.example/a', title: 'A', markdown: 'a' },
        { url: 'https://d.example/b', title: 'B', markdown: 'b' },
      ],
    });
    const r = (await crawlSite({ url: 'https://d.example' })) as Record<string, unknown>;
    expect(r.error).toBeUndefined();
    expect(r.status).toBe('timeout');
    expect((r.pages as unknown[]).length).toBe(2);
  });

  it('crawl_site: no_key → friendly error + sourceUrl', async () => {
    mockCrawl.mockResolvedValue({ status: 'no_key', pagesCrawled: 0, pages: [] });
    const r = (await crawlSite({ url: 'https://d.example' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(r.sourceUrl).toBe('https://d.example');
  });

  it('crawl_site: failed with no pages → error', async () => {
    mockCrawl.mockResolvedValue({ status: 'failed', pagesCrawled: 0, pages: [], note: 'boom' });
    const r = (await crawlSite({ url: 'https://d.example' })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
  });

  it('extract_structured: no_key → error + sourceUrl', async () => {
    mockExtract.mockResolvedValue({ status: 'no_key', data: null });
    const r = (await extractStructured({
      url: 'https://adv.example',
      preset: 'cve_advisory',
    })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(r.sourceUrl).toBe('https://adv.example');
  });

  it('extract_structured: failed → error + sourceUrl', async () => {
    mockExtract.mockResolvedValue({ status: 'failed', data: null, note: 'nope' });
    const r = (await extractStructured({
      url: 'https://adv.example',
      preset: 'cve_advisory',
    })) as Record<string, unknown>;
    expect(r.error).toBeTruthy();
    expect(r.sourceUrl).toBe('https://adv.example');
  });
});

// ════════════════════════════════════════════════════════════
// Preset resolution
// ════════════════════════════════════════════════════════════

describe('preset resolution', () => {
  it('cve_advisory passes a prompt AND schema to firecrawlExtract', async () => {
    mockExtract.mockResolvedValue({ status: 'completed', data: { cves: [] } });

    await extractStructured({ url: 'https://adv.example', preset: 'cve_advisory' });

    expect(mockExtract).toHaveBeenCalledTimes(1);
    const [urls, opts] = mockExtract.mock.calls[0]!;
    expect(urls).toEqual(['https://adv.example']);
    expect(typeof (opts as { prompt?: unknown }).prompt).toBe('string');
    expect((opts as { schema?: unknown }).schema).toBeTruthy();
    expect(typeof (opts as { schema?: unknown }).schema).toBe('object');
  });

  it('a freeform prompt (no preset) is passed through', async () => {
    mockExtract.mockResolvedValue({ status: 'completed', data: {} });

    await extractStructured({ url: 'https://x.example', prompt: 'pull the pricing table' });

    const [, opts] = mockExtract.mock.calls[0]!;
    expect((opts as { prompt?: unknown }).prompt).toBe('pull the pricing table');
  });

  it('result echoes the preset name on success', async () => {
    mockExtract.mockResolvedValue({ status: 'completed', data: { iocs: [] } });
    const r = (await extractStructured({
      url: 'https://x.example',
      preset: 'iocs',
    })) as Record<string, unknown>;
    expect(r.preset).toBe('iocs');
    expect(r.status).toBe('completed');
  });
});

// ════════════════════════════════════════════════════════════
// Cap enforcement — handler clamps params before the client
// ════════════════════════════════════════════════════════════

describe('cap enforcement', () => {
  it('crawl_site passes limit ≤ 10 and depth ≤ 2 to firecrawlCrawl', async () => {
    mockCrawl.mockResolvedValue({ status: 'completed', pagesCrawled: 0, pages: [] });

    await crawlSite({ url: 'https://d.example', limit: 50, maxDepth: 9 });

    const [, opts] = mockCrawl.mock.calls[0]!;
    expect((opts as { limit?: number }).limit).toBeLessThanOrEqual(10);
    expect((opts as { maxDepth?: number }).maxDepth).toBeLessThanOrEqual(2);
  });

  it('web_search clamps limit to ≤ 8', async () => {
    mockSearch.mockResolvedValue({ results: [] });

    await webSearch({ query: 'q', limit: 99 });

    const [, limit] = mockSearch.mock.calls[0]!;
    expect(limit).toBeLessThanOrEqual(8);
  });

  it('extract_structured slices urls[] to a max of 5', async () => {
    mockExtract.mockResolvedValue({ status: 'completed', data: {} });
    const urls = Array.from({ length: 9 }, (_, i) => `https://u${i}.example`);

    await extractStructured({ urls, preset: 'iocs' });

    const [passedUrls] = mockExtract.mock.calls[0]!;
    expect((passedUrls as string[]).length).toBe(5);
  });
});

// ════════════════════════════════════════════════════════════
// COMPRESSOR REGRESSION GUARD (critical)
// A read_url-shaped ~10k-char result must stay policy FULL at tokenBudget
// 14000 — the compressor must NOT fall to summarize()/extractKeyFields() and
// shred contentMarkdown to 200 chars.
// ════════════════════════════════════════════════════════════

describe('compressor regression guard (read_url budget 14000)', () => {
  it('keeps a ~10k-char read_url result FULL and intact', () => {
    const content = `${'A'.repeat(10000)}\n\n…[truncated]`;
    const result = {
      kind: 'markdown',
      url: 'https://big.example/article',
      sourceUrl: 'https://big.example/article',
      contentMarkdown: content,
      truncated: true,
      charCount: content.length,
    };

    const out = ToolResultCompressor.compress('read_url', result, 14000);

    // Policy must be FULL — not SUMMARY/MINIMAL (which would 200-char-truncate).
    expect(out.policy).toBe(StoragePolicy.FULL);
    // The content survives byte-for-byte.
    const data = out.data as Record<string, unknown>;
    expect(data.contentMarkdown).toBe(content);
    expect(String(data.contentMarkdown).length).toBeGreaterThan(9000);
    expect(data.sourceUrl).toBe('https://big.example/article');
  });

  it('CONTROL: the SAME result at a 1000 budget DOES degrade (proves the budget matters)', () => {
    const content = `${'A'.repeat(10000)}\n\n…[truncated]`;
    const result = {
      kind: 'markdown',
      sourceUrl: 'https://big.example/article',
      contentMarkdown: content,
    };

    const out = ToolResultCompressor.compress('read_url', result, 1000);

    expect(out.policy).not.toBe(StoragePolicy.FULL);
    // At a too-small budget extractKeyFields truncates strings to ~200 chars.
    const data = out.data as Record<string, unknown>;
    expect(String(data.contentMarkdown ?? '').length).toBeLessThan(content.length);
  });
});
