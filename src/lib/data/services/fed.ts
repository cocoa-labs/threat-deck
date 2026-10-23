import { fetchFedData } from '@/lib/data/collectors/fed';
import { feedResponse } from '@/lib/data/feed-response';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const indicators = searchParams.get('indicators')?.split(',');

  try {
    const data = await fetchFedData(indicators);
    const response = feedResponse({ data, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=1800',
    );
    return response;
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch Fed data' },
      { status: 500 },
    );
  }
}
