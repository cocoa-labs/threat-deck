import { fetchCryptoPrices } from '@/lib/data/collectors/crypto';
import { feedResponse } from '@/lib/data/feed-response';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit')) || 20;

  try {
    const data = await fetchCryptoPrices(limit);
    const response = feedResponse({ data, timestamp: new Date().toISOString() });
    response.headers.set(
      'Cache-Control',
      'public, max-age=30, s-maxage=60, stale-while-revalidate=30',
    );
    return response;
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch crypto' },
      { status: 500 },
    );
  }
}
