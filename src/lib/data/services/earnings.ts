import { NextResponse } from 'next/server';
import { fetchEarningsCalendar } from '@/lib/data/collectors/earnings';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = searchParams.get('days') ? Number(searchParams.get('days')) : undefined;
  const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;

  try {
    const data = await fetchEarningsCalendar({ days, limit });
    const response = NextResponse.json({ data, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=900, s-maxage=1800, stale-while-revalidate=900',
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch earnings data' },
      { status: 500 },
    );
  }
}
