vi.mock('@/lib/security/safe-fetch', () => ({
  safeFetch: async (url: string) => new Response(url),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsItem } from '@/lib/types';
import { fetchRSSFeedResult, fetchRSSFeeds, normalizeNewsCategory } from './rss';

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getCached: vi.fn(),
  parseURL: vi.fn(),
  scoreItems: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock('rss-parser', () => ({
  default: vi.fn(
    class MockParser {
      parseString = mocks.parseURL;
    },
  ),
}));

vi.mock('../rate-limiter', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getCached: mocks.getCached,
  setCache: mocks.setCache,
}));

vi.mock('@/lib/ai-relevance', () => ({
  scoreItems: mocks.scoreItems,
}));

function newsItem(id: string, category: string = 'tech'): NewsItem {
  return {
    id,
    title: `${id} title`,
    url: `https://example.com/${id}`,
    source: 'Cached Source',
    category,
    publishedAt: '2026-06-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mocks.checkRateLimit.mockReset();
  mocks.getCached.mockReset();
  mocks.parseURL.mockReset();
  mocks.scoreItems.mockReset();
  mocks.setCache.mockReset();

  mocks.checkRateLimit.mockReturnValue(true);
  mocks.getCached.mockResolvedValue(null);
  mocks.scoreItems.mockResolvedValue([]);
  mocks.setCache.mockResolvedValue(undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normalizeNewsCategory', () => {
  it('maps legacy and tool-facing aliases to canonical RSS keys', () => {
    expect(normalizeNewsCategory('financial')).toBe('finance');
    expect(normalizeNewsCategory('government_policy')).toBe('government');
    expect(normalizeNewsCategory('geopolitical')).toBe('politics');
    expect(normalizeNewsCategory('tech_ai')).toBe('tech');
    expect(normalizeNewsCategory('technology')).toBe('tech');
    expect(normalizeNewsCategory('cybersecurity')).toBe('cyber');
    expect(normalizeNewsCategory('not-a-feed')).toBeNull();
  });
});

describe('fetchRSSFeedResult', () => {
  it('returns cached canonical results before rate limiting', async () => {
    const cached = [newsItem('cached-1'), newsItem('cached-2')];
    mocks.getCached.mockResolvedValueOnce(cached);
    mocks.checkRateLimit.mockReturnValue(false);

    const result = await fetchRSSFeedResult('technology', 1);

    expect(mocks.getCached).toHaveBeenCalledWith('news:tech');
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.parseURL).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requestedCategory: 'technology',
      category: 'tech',
      count: 1,
      items: cached.slice(0, 1),
    });
  });

  it('dedupes concurrent cold fetches for the same canonical category', async () => {
    mocks.parseURL.mockImplementation(async (url: string) => ({
      items: [
        {
          title: `Story from ${url}`,
          link: url,
          guid: url,
          isoDate: '2026-06-01T00:00:00.000Z',
        },
      ],
    }));

    const [direct, alias] = await Promise.all([
      fetchRSSFeeds('tech', 3),
      fetchRSSFeeds('tech_ai', 3),
    ]);

    expect(mocks.checkRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.parseURL).toHaveBeenCalledTimes(5);
    expect(mocks.setCache).toHaveBeenCalledTimes(1);
    expect(direct).toHaveLength(3);
    expect(alias).toEqual(direct);
  });

  it('does not cache an empty all-feed failure', async () => {
    mocks.parseURL.mockRejectedValue(new Error('feed down'));

    const result = await fetchRSSFeedResult('tech', 10);

    expect(result.items).toEqual([]);
    expect(result.degradedReason).toBe('empty_fetch');
    expect(mocks.setCache).not.toHaveBeenCalled();
  });

  it('reports rate-limit degradation without caching an empty result', async () => {
    mocks.checkRateLimit.mockReturnValue(false);

    const result = await fetchRSSFeedResult('tech', 10);

    expect(result.items).toEqual([]);
    expect(result.degradedReason).toBe('rate_limited');
    expect(mocks.parseURL).not.toHaveBeenCalled();
    expect(mocks.setCache).not.toHaveBeenCalled();
  });
});
