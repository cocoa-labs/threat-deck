import type { NextResponse } from 'next/server';
import { fetchOSINTFeeds, getOSINTCategories } from '@/lib/data/collectors/osint';
import { feedResponse } from '@/lib/data/feed-response';

function withCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const limit = Number(searchParams.get('limit')) || 15;

  try {
    if (category) {
      const items = await fetchOSINTFeeds(category, limit);
      return withCacheHeaders(
        feedResponse({
          category,
          items,
          count: items.length,
          timestamp: new Date().toISOString(),
        }),
      );
    }

    // Return all categories
    const categories = getOSINTCategories();
    const results = await Promise.all(
      categories.map(async (cat) => ({
        category: cat,
        items: await fetchOSINTFeeds(cat, 5),
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
      { error: err instanceof Error ? err.message : 'Failed to fetch OSINT feeds' },
      { status: 500 },
    );
  }
}
