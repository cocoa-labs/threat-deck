import { NextResponse } from 'next/server';
import { fetchFedCalendar } from '@/lib/data/collectors/fed-calendar';

export async function GET() {
  try {
    const data = await fetchFedCalendar();
    const response = NextResponse.json({ data, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=1800, s-maxage=3600, stale-while-revalidate=1800',
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch Fed calendar' },
      { status: 500 },
    );
  }
}
