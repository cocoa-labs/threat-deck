import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchRSSFeedResult,
  fetchRSSFeeds,
  getRSSCategories,
  normalizeNewsCategory,
} from '@/lib/data/collectors/rss';
import { fetchTwitterTimeline } from '@/lib/data/collectors/twitter';
import type { NewsItem, Tweet } from '@/lib/types';
import { GET } from './route';

vi.mock('@/lib/data/collectors/rss', () => ({
  fetchRSSFeedResult: vi.fn(),
  fetchRSSFeeds: vi.fn(),
  getRSSCategories: vi.fn(),
  normalizeNewsCategory: vi.fn(),
}));

vi.mock('@/lib/data/collectors/twitter', () => ({
  fetchTwitterTimeline: vi.fn(),
}));

const mockFetchRSSFeedResult = vi.mocked(fetchRSSFeedResult);
const mockFetchRSSFeeds = vi.mocked(fetchRSSFeeds);
const mockGetRSSCategories = vi.mocked(getRSSCategories);
const mockNormalizeNewsCategory = vi.mocked(normalizeNewsCategory);
const mockFetchTwitterTimeline = vi.mocked(fetchTwitterTimeline);

function news(partial: Partial<NewsItem> & Pick<NewsItem, 'id' | 'source' | 'title'>): NewsItem {
  return {
    category: 'cyber',
    publishedAt: '2026-05-31T22:30:00.000Z',
    url: `https://example.com/${partial.id}`,
    ...partial,
  };
}

function tweet(partial: Partial<Tweet> & Pick<Tweet, 'id' | 'text' | 'authorUsername'>): Tweet {
  return {
    authorId: `author-${partial.id}`,
    authorName: partial.authorUsername,
    createdAt: '2026-05-31T23:00:00.000Z',
    domain: 'ai',
    likeCount: 50,
    quoteCount: 0,
    relevant: true,
    replyCount: 1,
    retweetCount: 5,
    url: `https://x.com/${partial.authorUsername}/status/${partial.id}`,
    ...partial,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-31T23:30:00.000Z'));
  mockFetchRSSFeeds.mockReset();
  mockFetchRSSFeedResult.mockReset();
  mockGetRSSCategories.mockReset();
  mockNormalizeNewsCategory.mockReset();
  mockFetchTwitterTimeline.mockReset();
  mockGetRSSCategories.mockReturnValue(['politics', 'tech', 'finance', 'government']);
  mockNormalizeNewsCategory.mockImplementation((category) => {
    const aliases: Record<string, string> = {
      financial: 'finance',
      geopolitical: 'politics',
      gov: 'government',
      government_policy: 'government',
      tech_ai: 'tech',
      technology: 'tech',
      cybersecurity: 'cyber',
    };
    return (aliases[category] ?? category) as ReturnType<typeof normalizeNewsCategory>;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/data/news?mode=top-pulse', () => {
  it('composes cyber RSS, AI RSS, and curated X into a top pulse payload', async () => {
    mockFetchRSSFeeds.mockImplementation(async (category) => {
      if (category === 'cyber') {
        return [
          news({
            id: 'cyber-1',
            source: 'SANS ISC',
            title: 'YARA rule detects active malware campaign',
            publishedAt: '2026-05-31T21:30:00.000Z',
          }),
        ];
      }
      if (category === 'ai') {
        return [
          news({
            id: 'ai-1',
            source: 'OpenAI News',
            title: 'OpenAI announces new model safety benchmark',
            category: 'ai',
            publishedAt: '2026-05-31T23:00:00.000Z',
          }),
        ];
      }
      return [];
    });
    mockFetchTwitterTimeline.mockResolvedValue([
      tweet({
        id: 'x-1',
        text: 'Claude model release benchmark shows a new agentic safety frontier.',
        authorUsername: 'AnthropicAI',
      }),
    ]);

    const res = await GET(
      new Request('http://localhost:3002/api/data/news?mode=top-pulse&limit=5'),
    );
    const json = (await res.json()) as {
      items: NewsItem[];
      count: number;
      sourceStats: { socialIncluded: number; bySource: Record<string, number> };
    };

    expect(res.status).toBe(200);
    expect(mockFetchRSSFeeds).toHaveBeenCalledWith('cyber', 60);
    expect(mockFetchRSSFeeds).toHaveBeenCalledWith('ai', 60);
    expect(mockFetchTwitterTimeline).toHaveBeenCalled();
    expect(json.items.map((item) => item.source)).toEqual([
      'SANS ISC',
      'OpenAI News',
      '@AnthropicAI',
    ]);
    expect(json.count).toBe(3);
    expect(json.sourceStats.socialIncluded).toBe(1);
    expect(json.sourceStats.bySource['@AnthropicAI']).toBe(1);
  });
});

describe('GET /api/data/news?mode=ticker', () => {
  it('keeps the existing all-category ticker path intact', async () => {
    mockGetRSSCategories.mockReturnValue(['cyber', 'finance']);
    mockFetchRSSFeeds.mockImplementation(async (category) => [
      news({
        id: category,
        source: category,
        title: `${category} headline`,
        category,
        publishedAt:
          category === 'finance' ? '2026-05-31T23:00:00.000Z' : '2026-05-31T22:00:00.000Z',
      }),
    ]);

    const res = await GET(new Request('http://localhost:3002/api/data/news?mode=ticker&limit=2'));
    const json = (await res.json()) as { items: NewsItem[] };

    expect(res.status).toBe(200);
    expect(mockFetchTwitterTimeline).not.toHaveBeenCalled();
    expect(json.items.map((item) => item.category)).toEqual(['finance', 'cyber']);
  });
});

describe('GET /api/data/news?category=...', () => {
  it('returns the canonical tech feed payload with metadata', async () => {
    const items = [
      news({
        id: 'tech-1',
        source: 'The Verge',
        title: 'AMD extends AM5 socket support',
        category: 'tech',
      }),
    ];
    mockFetchRSSFeedResult.mockResolvedValue({
      requestedCategory: 'tech',
      category: 'tech',
      items,
      count: 1,
    });

    const res = await GET(new Request('http://localhost:3002/api/data/news?category=tech'));
    const json = (await res.json()) as {
      requestedCategory: string;
      category: string;
      items: NewsItem[];
      count: number;
    };

    expect(res.status).toBe(200);
    expect(mockFetchRSSFeedResult).toHaveBeenCalledWith('tech', 15);
    expect(json.requestedCategory).toBe('tech');
    expect(json.category).toBe('tech');
    expect(json.items).toEqual(items);
    expect(json.count).toBe(1);
  });

  it('normalizes legacy category aliases before fetching', async () => {
    const items = [
      news({
        id: 'finance-1',
        source: 'Bloomberg Markets',
        title: 'Markets move higher',
        category: 'finance',
      }),
    ];
    mockFetchRSSFeedResult.mockResolvedValue({
      requestedCategory: 'financial',
      category: 'finance',
      items,
      count: 1,
    });

    const res = await GET(
      new Request('http://localhost:3002/api/data/news?category=financial&limit=5'),
    );
    const json = (await res.json()) as {
      requestedCategory: string;
      category: string;
      items: NewsItem[];
    };

    expect(res.status).toBe(200);
    expect(mockNormalizeNewsCategory).toHaveBeenCalledWith('financial');
    expect(mockFetchRSSFeedResult).toHaveBeenCalledWith('financial', 5);
    expect(json.requestedCategory).toBe('financial');
    expect(json.category).toBe('finance');
    expect(json.items).toEqual(items);
  });

  it('rejects unknown categories instead of returning a fake empty feed', async () => {
    mockNormalizeNewsCategory.mockReturnValueOnce(null);

    const res = await GET(
      new Request('http://localhost:3002/api/data/news?category=not-a-category'),
    );
    const json = (await res.json()) as {
      error: string;
      requestedCategory: string;
      categories: string[];
    };

    expect(res.status).toBe(400);
    expect(mockFetchRSSFeedResult).not.toHaveBeenCalled();
    expect(json.error).toBe('Unknown news category: not-a-category');
    expect(json.requestedCategory).toBe('not-a-category');
    expect(json.categories).toEqual(['politics', 'tech', 'finance', 'government']);
  });
});
