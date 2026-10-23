import { fetchChartOHLCV } from '@/lib/data/collectors/chart-ohlcv';
import { feedResponse } from '@/lib/data/feed-response';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe') ?? '3M';
  const interval = searchParams.get('interval') ?? '1day';

  if (!symbol) {
    return feedResponse({ error: 'Missing required parameter: symbol' }, { status: 400 });
  }

  try {
    const data = await fetchChartOHLCV(symbol, timeframe, interval);
    const response = feedResponse(data);
    response.headers.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
    );
    return response;
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch chart data' },
      { status: 500 },
    );
  }
}
