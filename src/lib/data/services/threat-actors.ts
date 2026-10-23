import { NextResponse } from 'next/server';
import { fetchMitreAttackGroups } from '@/lib/data/collectors/mitre-attack';
import type { ThreatActorType } from '@/lib/types';

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

const VALID_ACTOR_TYPES: ReadonlySet<ThreatActorType> = new Set([
  'apt',
  'ransomware',
  'hacktivist',
  'criminal',
  'insider',
  'unknown',
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const actorTypeParam = searchParams.get('actor_type')?.toLowerCase();
  const country = searchParams.get('country')?.toUpperCase();
  const limit = Number(searchParams.get('limit')) || 100;

  const actorType =
    actorTypeParam && VALID_ACTOR_TYPES.has(actorTypeParam as ThreatActorType)
      ? (actorTypeParam as ThreatActorType)
      : undefined;

  try {
    let actors = await fetchMitreAttackGroups();

    if (actorType) {
      actors = actors.filter((a) => a.actorType === actorType);
    }
    if (country) {
      actors = actors.filter((a) => a.attributionCountry?.toUpperCase() === country);
    }

    const trimmed = actors.slice(0, limit);

    return withCacheHeaders(
      NextResponse.json({
        data: trimmed,
        count: trimmed.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch threat actors' },
      { status: 500 },
    );
  }
}
