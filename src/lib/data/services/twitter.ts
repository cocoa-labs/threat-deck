import {
  fetchTwitterSearch,
  fetchTwitterTimeline,
  type TwitterSearchFilter,
} from '@/lib/data/collectors/twitter';
import { feedResponse } from '@/lib/data/feed-response';
import type { Tweet } from '@/lib/types';

const VALID_FILTERS = new Set(['markets', 'geopolitics', 'policy', 'crypto', 'ai', 'infosec']);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get('tab') ?? 'accounts';
  const query = searchParams.get('query') ?? '';
  const rawFilter = searchParams.get('filter');
  const filter =
    rawFilter && VALID_FILTERS.has(rawFilter) ? (rawFilter as TwitterSearchFilter) : undefined;

  try {
    const data: Tweet[] =
      tab === 'search' && query
        ? await fetchTwitterSearch(query, filter)
        : await fetchTwitterTimeline();

    const response = feedResponse({
      data,
      count: data.length,
      timestamp: new Date().toISOString(),
    });
    response.headers.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=120, stale-while-revalidate=60',
    );
    return response;
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch tweets' },
      { status: 500 },
    );
  }
}
