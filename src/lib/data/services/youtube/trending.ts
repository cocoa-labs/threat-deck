import { NextResponse } from 'next/server';
import { fetchTrendingVideos } from '@/lib/data/collectors/youtube-search';

export async function GET() {
  try {
    const results = await fetchTrendingVideos();

    const response = NextResponse.json({
      results,
      cached: false,
    });

    response.headers.set(
      'Cache-Control',
      'public, max-age=1800, s-maxage=1800, stale-while-revalidate=900',
    );
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'YouTube trending failed' },
      { status: 500 },
    );
  }
}
