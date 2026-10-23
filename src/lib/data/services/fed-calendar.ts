import { fetchFedCalendar } from '@/lib/data/collectors/fed-calendar';
import { feedResponse } from '@/lib/data/feed-response';

export async function GET() {
  try {
    const data = await fetchFedCalendar();
    const response = feedResponse({ data, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=1800',
    );
    return response;
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch Fed calendar' },
      { status: 500 },
    );
  }
}
