import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET/POST /api/aegis/geo-refresh — refresh the live geo-threat events table.
 *
 * Phase 1C. Runs every 30 min per vercel.json. Populates
 * `aegis_geo_threat_events` (actor→target attacks + CERT disclosures) which the
 * globe / war-room map and /api/data/cyber-geo read.
 *
 * Auth: `checkCronSecret` (Authorization: Bearer or x-cron-secret). In dev with
 * CRON_SECRET unset the gate fails open, so the route can be hit manually to
 * seed the table. Fail-soft: always returns 200 with `ok` reflecting status, so
 * cron never treats a transient miss as a retry signal (the refresh is
 * idempotent and the next tick catches up).
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { refreshGeoEvents } from '@/lib/data/collectors/geo-events';

interface RouteResponse {
  ok: boolean;
  geo: Awaited<ReturnType<typeof refreshGeoEvents>> | { ok: false; reason: 'skipped' };
  errors: string[];
}

async function runRefresh(request: Request): Promise<NextResponse<RouteResponse>> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        geo: { ok: false, reason: 'skipped' },
        errors: [auth.reason ?? 'auth failed'],
      },
      { status: 401 },
    );
  }

  const errors: string[] = [];
  let geo: RouteResponse['geo'] = { ok: false, reason: 'skipped' };
  try {
    geo = await refreshGeoEvents(300);
  } catch (err) {
    errors.push(`geo: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json<RouteResponse>({
    ok: errors.length === 0 && geo.ok,
    geo,
    errors,
  });
}

async function routeGETImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runRefresh(request);
}

async function routePOSTImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return runRefresh(request);
}

export const GET = withRoutePolicy('/api/aegis/geo-refresh', routeGETImplementation);
export const POST = withRoutePolicy('/api/aegis/geo-refresh', routePOSTImplementation);
