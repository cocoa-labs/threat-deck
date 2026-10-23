import { NextResponse } from 'next/server';
import { fetchCryptoPrices } from '@/lib/data/collectors/crypto';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit')) || 20;

  try {
    const data = await fetchCryptoPrices(limit);
    const response = NextResponse.json({ data, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=30, s-maxage=60, stale-while-revalidate=30',
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch crypto' },
      { status: 500 },
    );
  }
}
