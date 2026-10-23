import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET/POST /api/cron/monitor-scan — run the watchlist scan (Phase 2).
 *
 * Every 5 min per vercel.json. Matches enabled monitors' keywords against fresh
 * feed items and records new hits to monitor_match_log. Auth via checkCronSecret
 * (fails open in dev so the route can be hit manually). Fail-soft: always 200.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { type MonitorScanSummary, runMonitorScan } from '@/lib/monitors/scan';

interface RouteResponse {
  ok: boolean;
  scan:
    | MonitorScanSummary
    | { monitorsScanned: 0; newMatches: 0; byMonitor: Record<string, never> };
  errors: string[];
}

async function run(request: Request): Promise<NextResponse<RouteResponse>> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        scan: { monitorsScanned: 0, newMatches: 0, byMonitor: {} },
        errors: [auth.reason ?? 'auth failed'],
      },
      { status: 401 },
    );
  }

  const errors: string[] = [];
  let scan: RouteResponse['scan'] = { monitorsScanned: 0, newMatches: 0, byMonitor: {} };
  try {
    scan = await runMonitorScan();
  } catch (err) {
    errors.push(`monitor-scan: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json<RouteResponse>({ ok: errors.length === 0, scan, errors });
}

async function routeGETImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return run(request);
}

async function routePOSTImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return run(request);
}

export const GET = withRoutePolicy('/api/cron/monitor-scan', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/monitor-scan', routePOSTImplementation);
