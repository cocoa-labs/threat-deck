import { fetchWhaleTransactions } from '@/lib/data/collectors/whales';
import { feedResponse } from '@/lib/data/feed-response';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const min_value = searchParams.get('min_value')
    ? Number(searchParams.get('min_value'))
    : undefined;
  const blockchain = searchParams.get('blockchain') ?? undefined;

  try {
    const data = await fetchWhaleTransactions({ min_value, blockchain });
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
      { error: err instanceof Error ? err.message : 'Failed to fetch whale transactions' },
      { status: 500 },
    );
  }
}
