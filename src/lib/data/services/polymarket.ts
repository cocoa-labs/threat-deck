import { fetchPredictionMarkets } from '@/lib/data/collectors/polymarket';
import { feedResponse } from '@/lib/data/feed-response';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') ?? undefined;
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

  try {
    const data = await fetchPredictionMarkets({ category, limit });
    const response = feedResponse({
      data,
      count: data.length,
      timestamp: new Date().toISOString(),
    });
    response.headers.set(
      'Cache-Control',
      'public, max-age=120, s-maxage=300, stale-while-revalidate=120',
    );
    return response;
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch prediction markets' },
      { status: 500 },
    );
  }
}
