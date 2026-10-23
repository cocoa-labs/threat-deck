import { NextResponse } from 'next/server';
import { fetchChartOHLCV } from '@/lib/data/collectors/chart-ohlcv';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe') ?? '3M';
  const interval = searchParams.get('interval') ?? '1day';

  if (!symbol) {
    return NextResponse.json({ error: 'Missing required parameter: symbol' }, { status: 400 });
  }

  try {
    const data = await fetchChartOHLCV(symbol, timeframe, interval);
    const response = NextResponse.json(data);
    response.headers.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=300, stale-while-revalidate=60',
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch chart data' },
      { status: 500 },
    );
  }
}
