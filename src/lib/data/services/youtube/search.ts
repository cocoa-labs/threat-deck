import { NextResponse } from 'next/server';
import type { SearchFilters } from '@/lib/data/collectors/youtube-search';
import { parseSearchFilters, searchYouTube } from '@/lib/data/collectors/youtube-search';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q) {
    return NextResponse.json({ error: 'Missing required parameter: q' }, { status: 400 });
  }

  try {
    // Parse NLP filters from the raw query
    const { cleanQuery, filters: nlpFilters } = parseSearchFilters(q);

    // Explicit params override NLP-extracted filters
    const filters: SearchFilters = { ...nlpFilters };
    if (searchParams.get('publishedAfter')) {
      filters.publishedAfter = searchParams.get('publishedAfter')!;
    }
    if (searchParams.get('videoDuration')) {
      filters.videoDuration = searchParams.get('videoDuration') as SearchFilters['videoDuration'];
    }
    if (searchParams.get('channelId')) {
      filters.channelId = searchParams.get('channelId')!;
    }
    if (searchParams.get('order')) {
      filters.order = searchParams.get('order') as SearchFilters['order'];
    }
    if (searchParams.get('maxResults')) {
      filters.maxResults = Number(searchParams.get('maxResults'));
    }

    const results = await searchYouTube(cleanQuery, filters);

    const response = NextResponse.json({
      results,
      query: q,
      resultCount: results.length,
    });

    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'YouTube search failed' },
      { status: 500 },
    );
  }
}
