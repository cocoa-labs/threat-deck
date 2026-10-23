import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.D — Actor target forecast endpoint.
 *
 * GET /api/aegis/predictions/actor-forecast?actorId=LockBit
 *
 * Returns the Bayesian Dirichlet-Categorical posterior over the actor's
 * next-target SECTOR and next-target COUNTRY, with 95% credible intervals.
 *
 * Sources:
 *   - aegis_threat_actor_targets — primary target history (industry, country)
 *   - aegis_threat_actor_campaigns — to mark "recent" observations (90d)
 *
 * Recency window: 90 days (matches Phase 11.B.6 default). Recent observations
 * count double in the posterior so the model picks up trajectory changes.
 *
 * Error policy: 200 with `forecast: null` on missing actor or empty history.
 * 400 ONLY on missing actorId.
 */

import { NextResponse } from 'next/server';
import {
  aggregateObservations,
  type DirichletForecast,
  forecastFromObservations,
} from '@/lib/aegis/forecasting/actor-target-bayesian';
import { query } from '@/lib/db/client';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

const RECENT_WINDOW_DAYS = 90;
const RECENT_CUTOFF_SECONDS = RECENT_WINDOW_DAYS * 24 * 60 * 60;

interface TargetRow {
  category: string | null;
  is_recent: boolean;
}

interface RouteResponse {
  ok: boolean;
  actorId: string;
  actorDisplayName: string | null;
  forecast: {
    sectors: DirichletForecast | null;
    countries: DirichletForecast | null;
  } | null;
  sourceUrl: string | null;
  error?: string;
}

async function handleGet(request: Request): Promise<NextResponse<RouteResponse>> {
  const { searchParams } = new URL(request.url);
  const actorIdParam = searchParams.get('actorId');

  if (!actorIdParam || actorIdParam.length === 0 || actorIdParam.length > 200) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        actorId: actorIdParam ?? '',
        actorDisplayName: null,
        forecast: null,
        sourceUrl: null,
        error: 'invalid_actor_id',
      },
      { status: 400 },
    );
  }

  const sourceUrl = `/api/aegis/threat-actors/view?id=${encodeURIComponent(actorIdParam)}`;

  try {
    // 1. Resolve actor — accept either actor_id or display_name (case-insensitive)
    //    or a value present in aliases[].
    const { rows: actorRows } = await query<{ actor_id: string; display_name: string }>(
      `SELECT actor_id, display_name FROM aegis_threat_actors
         WHERE actor_id = $1
            OR LOWER(display_name) = LOWER($1)
            OR $1 = ANY(aliases)
         LIMIT 1`,
      [actorIdParam],
    );
    if (actorRows.length === 0) {
      return NextResponse.json<RouteResponse>({
        ok: true,
        actorId: actorIdParam,
        actorDisplayName: null,
        forecast: null,
        sourceUrl,
      });
    }
    const actor = actorRows[0]!;

    // 2. Sector observations
    const { rows: sectorRows } = await query<TargetRow>(
      `SELECT industry AS category,
              CASE
                WHEN created_at IS NULL THEN FALSE
                ELSE EXTRACT(EPOCH FROM (NOW() - created_at::timestamptz)) <= $2
              END AS is_recent
         FROM aegis_threat_actor_targets
         WHERE actor_id = $1 AND industry IS NOT NULL`,
      [actor.actor_id, RECENT_CUTOFF_SECONDS],
    );

    // 3. Country observations (schema gotcha: column is `geography`, not `country`)
    const { rows: countryRows } = await query<TargetRow>(
      `SELECT geography AS category,
              CASE
                WHEN created_at IS NULL THEN FALSE
                ELSE EXTRACT(EPOCH FROM (NOW() - created_at::timestamptz)) <= $2
              END AS is_recent
         FROM aegis_threat_actor_targets
         WHERE actor_id = $1 AND geography IS NOT NULL`,
      [actor.actor_id, RECENT_CUTOFF_SECONDS],
    );

    const sectorObs = aggregateObservations(
      sectorRows
        .filter((r): r is TargetRow & { category: string } => Boolean(r.category))
        .map((r) => ({ category: r.category, isRecent: r.is_recent })),
    );
    const countryObs = aggregateObservations(
      countryRows
        .filter((r): r is TargetRow & { category: string } => Boolean(r.category))
        .map((r) => ({ category: r.category, isRecent: r.is_recent })),
    );

    const sectors = sectorObs.length > 0 ? forecastFromObservations(sectorObs) : null;
    const countries = countryObs.length > 0 ? forecastFromObservations(countryObs) : null;

    return NextResponse.json<RouteResponse>({
      ok: true,
      actorId: actor.actor_id,
      actorDisplayName: actor.display_name,
      forecast: { sectors, countries },
      sourceUrl,
    });
  } catch (err) {
    return NextResponse.json<RouteResponse>({
      ok: false,
      actorId: actorIdParam,
      actorDisplayName: null,
      forecast: null,
      sourceUrl,
      error: err instanceof Error ? err.message : 'forecast_failed',
    });
  }
}

// Phase 13 Tier 3 — Per-IP rate-limit. Bayesian inference is cheap but
// the actor-targets table scan grows linearly; 30/min/IP is plenty for
// IntelCard hover cycles + blocks enumeration of actor space.
const routeGETImplementation = withRateLimit(handleGet, {
  key: (req: Request) => `predictions-actor-forecast:${getClientIp(req)}`,
  limit: 30,
  windowMs: 60_000,
});

export const GET = withRoutePolicy('/api/aegis/predictions/actor-forecast', routeGETImplementation);
