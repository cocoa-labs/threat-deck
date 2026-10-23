import { assembleTvContext } from '@/lib/data/collectors/tv-context';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get('channelId');

  if (!channelId) {
    return new Response(JSON.stringify({ error: 'channelId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const data = await assembleTvContext(channelId);

    if (!data) {
      return new Response(JSON.stringify({ error: 'Unknown channel' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data, timestamp: new Date().toISOString() }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed to assemble TV context' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
