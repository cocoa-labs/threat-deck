import type { NextResponse } from 'next/server';
import {
  fetchRSSFeedResult,
  fetchRSSFeeds,
  getRSSCategories,
  normalizeNewsCategory,
} from '@/lib/data/collectors/rss';
import { fetchTwitterTimeline } from '@/lib/data/collectors/twitter';
import { feedResponse } from '@/lib/data/feed-response';
import { buildTopPulseItems } from '@/lib/data/top-pulse';

function withCacheHeaders(response: NextResponse, profile: 'default' | 'top-pulse' = 'default') {
  const cacheControl =
    profile === 'top-pulse'
      ? 'public, max-age=30, s-maxage=60, stale-while-revalidate=30'
      : 'public, max-age=120, s-maxage=300, stale-while-revalidate=120';
  response.headers.set('Cache-Control', cacheControl);
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const mode = searchParams.get('mode');
  const limit = Number(searchParams.get('limit')) || 15;

  try {
    // Ticker mode: flat date-sorted list across all categories
    if (mode === 'ticker') {
      const categories = getRSSCategories();
      const perCategory = Math.max(1, Math.ceil(limit / categories.length));
      const results = await Promise.allSettled(
        categories.map((cat) => fetchRSSFeeds(cat, perCategory)),
      );

      const allItems: Awaited<ReturnType<typeof fetchRSSFeeds>> = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allItems.push(...result.value);
        }
      }

      // Sort by date descending and take top `limit`
      allItems.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );

      return withCacheHeaders(
        feedResponse({
          items: allItems.slice(0, limit),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    if (mode === 'top-pulse') {
      const sourceLimit = Math.max(limit * 4, 60);
      const [cyberResult, aiResult, tweetsResult] = await Promise.allSettled([
        fetchRSSFeeds('cyber', sourceLimit),
        fetchRSSFeeds('ai', sourceLimit),
        fetchTwitterTimeline(),
      ]);

      const pulse = buildTopPulseItems({
        cyberItems: cyberResult.status === 'fulfilled' ? cyberResult.value : [],
        aiItems: aiResult.status === 'fulfilled' ? aiResult.value : [],
        tweets: tweetsResult.status === 'fulfilled' ? tweetsResult.value : [],
        limit,
      });

      return withCacheHeaders(
        feedResponse({
          items: pulse.items,
          count: pulse.items.length,
          sourceStats: pulse.sourceStats,
          timestamp: new Date().toISOString(),
        }),
        'top-pulse',
      );
    }

    if (category) {
      if (!normalizeNewsCategory(category)) {
        return feedResponse(
          {
            error: `Unknown news category: ${category}`,
            requestedCategory: category,
            categories: getRSSCategories(),
          },
          { status: 400 },
        );
      }

      const result = await fetchRSSFeedResult(category, limit);
      return withCacheHeaders(
        feedResponse({
          requestedCategory: result.requestedCategory,
          category: result.category,
          items: result.items,
          count: result.count,
          ...(result.degradedReason ? { degradedReason: result.degradedReason } : {}),
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // Return all categories
    const categories = getRSSCategories();
    const results = await Promise.all(
      categories.map(async (cat) => ({
        category: cat,
        items: await fetchRSSFeeds(cat, 5),
      })),
    );

    return withCacheHeaders(
      feedResponse({
        feeds: results,
        categories,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch news' },
      { status: 500 },
    );
  }
}
