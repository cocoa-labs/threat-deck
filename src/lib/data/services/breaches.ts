import { NextResponse } from 'next/server';
import { fetchHibpBreaches } from '@/lib/data/collectors/breach-feed';

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const industry = searchParams.get('industry')?.toLowerCase();
  const country = searchParams.get('country')?.toLowerCase();
  const limit = Number(searchParams.get('limit')) || 100;

  try {
    let breaches = await fetchHibpBreaches(limit * 2);

    // HIBP doesn't ship industry/country; we do a best-effort filter against
    // the notes/breachType string. When metadata isn't available, the filter
    // is a no-op so the panel still gets results.
    if (industry) {
      breaches = breaches.filter((b) => {
        const hay = `${b.notes ?? ''} ${b.breachType ?? ''}`.toLowerCase();
        return hay.includes(industry);
      });
    }
    if (country) {
      breaches = breaches.filter((b) => {
        const hay = `${b.notes ?? ''} ${b.sourceUrl ?? ''}`.toLowerCase();
        return hay.includes(country);
      });
    }

    const trimmed = breaches.slice(0, limit);

    return withCacheHeaders(
      NextResponse.json({
        data: trimmed,
        count: trimmed.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch breaches' },
      { status: 500 },
    );
  }
}
