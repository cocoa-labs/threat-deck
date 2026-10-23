import { NextResponse } from 'next/server';
import { geocodeForward } from '@/lib/mapbox/geocode-api';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: 'Missing query parameter "q"' }, { status: 400 });
  }

  const result = await geocodeForward(query.trim());

  if (!result) {
    return NextResponse.json({ result: null });
  }

  return NextResponse.json({ result });
}
