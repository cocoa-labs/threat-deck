import { NextResponse } from 'next/server';
import {
  fetchCommodities,
  fetchIndices,
  fetchQuotes,
  fetchSectors,
} from '@/lib/data/collectors/markets';

function withCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=30, s-maxage=60, stale-while-revalidate=30',
  );
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const symbols = searchParams.get('symbols');

  try {
    if (symbols) {
      const data = await fetchQuotes(symbols.split(','));
      return withCacheHeaders(NextResponse.json({ data, timestamp: new Date().toISOString() }));
    }

    switch (type) {
      case 'sectors': {
        const data = await fetchSectors();
        return withCacheHeaders(NextResponse.json({ data, timestamp: new Date().toISOString() }));
      }
      case 'commodities': {
        const data = await fetchCommodities();
        return withCacheHeaders(NextResponse.json({ data, timestamp: new Date().toISOString() }));
      }
      default: {
        const [indices, sectors, commodities] = await Promise.all([
          fetchIndices(),
          fetchSectors(),
          fetchCommodities(),
        ]);
        return withCacheHeaders(
          NextResponse.json({
            indices,
            sectors,
            commodities,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch markets' },
      { status: 500 },
    );
  }
}
