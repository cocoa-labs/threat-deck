import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.A.4 — Time-series aggregation refresh + EPSS refresh cron.
 *
 * Runs nightly at 03:00 UTC per vercel.json. Two responsibilities:
 *
 *   1. Refresh EPSS scores for CVEs we know about (Phase 11.A.1).
 *      Picks up CVEs with NULL EPSS first, batches calls to FIRST.org.
 *
 *   2. Refresh `aegis_daily_metrics` aggregations (Phase 11.A.4).
 *      Recomputes 5 daily-count metrics over the trailing 730 days +
 *      backfills zero-count rows so the time-series is continuous.
 *
 * Fail-soft: ALWAYS returns 200 with `ok` reflecting the per-step status.
 * A failure in EPSS doesn't stop aggregations from running — they're
 * independent passes. Cron infrastructure should never read non-200 as a
 * signal to retry; this route is idempotent and the next-day cron will
 * pick up anything that slipped.
 *
 * Auth: `checkCronSecret` (Authorization: Bearer or x-cron-secret).
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { refreshAggregations } from '@/lib/aegis/forecasting/aggregations';
import { refreshEpss } from '@/lib/data/collectors/epss';

interface RouteResponse {
  ok: boolean;
  epss: Awaited<ReturnType<typeof refreshEpss>> | { ok: false; reason: 'skipped' };
  aggregations: Awaited<ReturnType<typeof refreshAggregations>> | { ok: false; reason: 'skipped' };
  errors: string[];
}

async function routePOSTImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runRefresh(request);
}

// GET is supported so Vercel Cron (which uses GET by default) hits the
// same handler. Lets us swap between cron providers without changing the
// route signature.
async function routeGETImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runRefresh(request);
}

async function runRefresh(request: Request): Promise<NextResponse<RouteResponse>> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        epss: { ok: false, reason: 'skipped' },
        aggregations: { ok: false, reason: 'skipped' },
        errors: [auth.reason ?? 'auth failed'],
      },
      { status: 401 },
    );
  }

  const errors: string[] = [];

  // ─── EPSS refresh ─────────────────────────────────────────────────────
  // Cap at 500 CVEs per nightly run. Combined with the 1.1s pause between
  // FIRST.org batches, that's ~5-6 min wall-clock max. The next night
  // catches anything that didn't fit.
  let epssResult: RouteResponse['epss'] = { ok: false, reason: 'skipped' };
  try {
    epssResult = await refreshEpss(500);
  } catch (err) {
    errors.push(`epss: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ─── Aggregations refresh ─────────────────────────────────────────────
  // Runs even if EPSS failed — they read from different source tables.
  let aggResult: RouteResponse['aggregations'] = { ok: false, reason: 'skipped' };
  try {
    aggResult = await refreshAggregations(730);
  } catch (err) {
    errors.push(`aggregations: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ok = both passes ran without throwing AND at least one produced output.
  // We accept the case where EPSS returns ok:false reason:'rate_limited'
  // — that's a valid throttle, not a failure.
  const okOverall = errors.length === 0 && 'rowsTouched' in aggResult; // aggregations succeeded

  return NextResponse.json<RouteResponse>({
    ok: okOverall,
    epss: epssResult,
    aggregations: aggResult,
    errors,
  });
}

export const POST = withRoutePolicy('/api/aegis/forecast-aggregations', routePOSTImplementation);
export const GET = withRoutePolicy('/api/aegis/forecast-aggregations', routeGETImplementation);
