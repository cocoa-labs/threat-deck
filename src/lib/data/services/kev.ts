import { NextResponse } from 'next/server';
import { fetchKevCatalog } from '@/lib/data/collectors/cve-feed';

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit')) || 100;

  try {
    // Collector already returns sorted by addedToKevAt DESC.
    const kev = await fetchKevCatalog(limit);

    return withCacheHeaders(
      NextResponse.json({
        data: kev,
        count: kev.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch KEV catalog' },
      { status: 500 },
    );
  }
}
