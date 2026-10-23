import { fetchCongressTrades } from '@/lib/data/collectors/congress';
import { feedResponse } from '@/lib/data/feed-response';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const member = searchParams.get('member') ?? undefined;
  const symbol = searchParams.get('symbol') ?? undefined;
  const days = searchParams.get('days') ? Number(searchParams.get('days')) : undefined;

  try {
    const data = await fetchCongressTrades({ member, symbol, days });
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
      { error: err instanceof Error ? err.message : 'Failed to fetch congress trades' },
      { status: 500 },
    );
  }
}
