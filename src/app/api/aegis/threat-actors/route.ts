import { NextResponse } from 'next/server';
import { ingestProvenance } from '@/lib/aegis/ingest/provenance';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/threat-actors
 *
 * Returns threat actor rankings from `aegis_v_actor_rankings` view.
 * Used by ThreatActorScoresPanel for the deep-intel deck.
 *
 * Query params:
 *   - actor_type: apt | ransomware | hacktivist | criminal | insider | unknown
 *   - min_score: 0..100
 *   - country: ISO country code
 *   - limit: 1..200 (default 100)
 */

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=900, stale-while-revalidate=300',
  );
  return response;
}

const VALID_ACTOR_TYPES = new Set([
  'apt',
  'ransomware',
  'hacktivist',
  'criminal',
  'insider',
  'unknown',
]);

async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const actorTypeRaw = searchParams.get('actor_type')?.toLowerCase();
  const actorType = actorTypeRaw && VALID_ACTOR_TYPES.has(actorTypeRaw) ? actorTypeRaw : undefined;
  const minScoreRaw = searchParams.get('min_score');
  const minScore = minScoreRaw !== null ? Number(minScoreRaw) : undefined;
  const country = searchParams.get('country')?.toUpperCase();
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 200);

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (actorType) {
      conditions.push(`actor_type = $${paramIdx++}`);
      params.push(actorType);
    }
    if (minScore !== undefined && !Number.isNaN(minScore)) {
      conditions.push(`composite_score >= $${paramIdx++}`);
      params.push(minScore);
    }
    if (country) {
      conditions.push(`UPPER(attribution_country) = $${paramIdx++}`);
      params.push(country);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        actor_id, display_name, aliases, actor_type,
        attribution_country, sophistication, last_active_at,
        composite_score, actor_grade, actor_tier,
        capability_score, reach_score, recency_score,
        velocity_score, attribution_confidence,
        campaign_count, target_count
      FROM aegis_v_actor_rankings
      ${whereClause}
      LIMIT ${limit}
    `;

    const result = await query<Record<string, unknown>>(sql, params);

    const provenance = await ingestProvenance('threat-actors');
    const data = result.rows.map((r) => ({
      _provenance: provenance,
      actorId: r.actor_id,
      displayName: r.display_name,
      aliases: r.aliases,
      actorType: r.actor_type,
      attributionCountry: r.attribution_country,
      sophistication: r.sophistication,
      lastActiveAt: r.last_active_at,
      compositeScore: r.composite_score,
      actorGrade: r.actor_grade,
      actorTier: r.actor_tier,
      capabilityScore: r.capability_score,
      reachScore: r.reach_score,
      recencyScore: r.recency_score,
      velocityScore: r.velocity_score,
      attributionConfidence: r.attribution_confidence,
      campaignCount: r.campaign_count,
      targetCount: r.target_count,
      sourceUrl: `/api/aegis/threat-actors/view?id=${r.actor_id}`,
    }));

    return withCacheHeaders(
      NextResponse.json({
        data,
        count: data.length,
        provenance,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.error('[aegis/threat-actors] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch AEGIS threat actors' },
      { status: 500 },
    );
  }
}

export const GET = withRoutePolicy('/api/aegis/threat-actors', routeGETImplementation);
