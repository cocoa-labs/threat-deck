/**
 * Tests for the click-to-analyze correlation engine — specifically the lazy
 * on-click full-text enrichment that feeds Max the scraped article body.
 *
 * The OSINT panel (`NewsFeedPanel.tsx` → `sourcePanel:'newsFeed'`) and the news
 * panel (`sourcePanel:'news'`) share ONE branch in `correlateClickContext`
 * (correlation.ts:188-189). When the clicked item carries a URL
 * (`trendData.url ?? trendData.sourceUrl`), that branch calls `firecrawlScrape`
 * and injects the full text as `relatedArticle`, rendered by
 * `formatCorrelationContext` as `ARTICLE CONTENT:`.
 *
 * These tests lock that behavior so a future routing refactor can't silently
 * drop OSINT enrichment:
 *   - `newsFeed` + URL  → scrapes + emits `ARTICLE CONTENT:` with full text
 *   - `news`     + URL  → parity (same shared branch)
 *   - no URL            → no scrape, no `ARTICLE CONTENT:`
 *
 * `firecrawlScrape` is mocked (no FireCrawl I/O). The branch also fires a couple
 * of `safeFetch` calls (markets/polymarket); we stub global `fetch` to a benign
 * empty-JSON response so nothing hits the network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── FireCrawl mock — firecrawlScrape returns a sentinel body ──
// Typed variadic so the spread into the mock factory satisfies TS strict
// (a bare `vi.fn(async () => ...)` infers a zero-arg signature and rejects `...a`).
const mockScrape = vi.fn<(...a: unknown[]) => Promise<string | null>>(
  async () => 'FULL ARTICLE TEXT — lorem ipsum dolor sit amet',
);
vi.mock('@/lib/data/firecrawl', () => ({
  firecrawlScrape: (...a: unknown[]) => mockScrape(...a),
}));

const { correlateClickContext } = await import('./correlation');

beforeEach(() => {
  mockScrape.mockReset().mockResolvedValue('FULL ARTICLE TEXT — lorem ipsum dolor sit amet');
  // The news/newsFeed branch also fires safeFetch(markets) + safeFetch(polymarket).
  // Stub global fetch so those resolve to harmless empty JSON (never the network).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('correlateClickContext — OSINT/news on-click enrichment', () => {
  it('newsFeed (OSINT) + url scrapes the article and emits ARTICLE CONTENT:', async () => {
    const out = await correlateClickContext('newsFeed', 'osintItem', {
      url: 'https://example.com/x',
    });

    expect(mockScrape).toHaveBeenCalledTimes(1);
    expect(mockScrape).toHaveBeenCalledWith('https://example.com/x');
    expect(out).toContain('ARTICLE CONTENT:');
    expect(out).toContain('FULL ARTICLE TEXT');
  });

  it('news + url scrapes the article and emits ARTICLE CONTENT: (shared-branch parity)', async () => {
    const out = await correlateClickContext('news', 'article', {
      url: 'https://example.com/x',
    });

    expect(mockScrape).toHaveBeenCalledTimes(1);
    expect(mockScrape).toHaveBeenCalledWith('https://example.com/x');
    expect(out).toContain('ARTICLE CONTENT:');
    expect(out).toContain('FULL ARTICLE TEXT');
  });

  it('resolves the article URL from trendData.sourceUrl when url is absent', async () => {
    const out = await correlateClickContext('newsFeed', 'osintItem', {
      sourceUrl: 'https://example.com/from-source',
    });

    expect(mockScrape).toHaveBeenCalledWith('https://example.com/from-source');
    expect(out).toContain('ARTICLE CONTENT:');
  });

  it('does NOT scrape and emits no ARTICLE CONTENT: when no url is present', async () => {
    const out = await correlateClickContext('newsFeed', 'osintItem', {});

    expect(mockScrape).not.toHaveBeenCalled();
    expect(out).not.toContain('ARTICLE CONTENT:');
  });
});
