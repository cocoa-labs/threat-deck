import { NextResponse } from 'next/server';
import { resolveYouTubeLiveStreams } from '@/lib/data/collectors/livestream';

export async function GET() {
  try {
    const data = await resolveYouTubeLiveStreams();
    const response = NextResponse.json({ data, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=3600, s-maxage=21600, stale-while-revalidate=3600',
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to resolve livestreams' },
      { status: 500 },
    );
  }
}
