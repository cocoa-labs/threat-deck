/**
 * GET/POST /api/cron/aegis-ingest — pull fresh CVEs/KEV/IOCs/advisories/breaches
 * from the collectors and UPSERT into the AEGIS tables. Runs every 15 min per
 * vercel.json. Auth via checkCronSecret. Fail-soft: always 200 (idempotent; next
 * tick catches up).
 */
import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { runAegisIngest } from '@/lib/aegis/ingest';
import { withRoutePolicy } from '@/lib/security/route-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // ingest can page NVD; allow the 300s ceiling

interface RouteResponse {
  ok: boolean;
  ingest: Awaited<ReturnType<typeof runAegisIngest>> | { ok: false; totalUpserted: 0; sources: [] };
  errors: string[];
}

async function run(request: Request): Promise<NextResponse<RouteResponse>> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        ingest: { ok: false, totalUpserted: 0, sources: [] },
        errors: [auth.reason ?? 'auth failed'],
      },
      { status: 401 },
    );
  }

  const errors: string[] = [];
  let ingest: RouteResponse['ingest'] = { ok: false, totalUpserted: 0, sources: [] };
  try {
    ingest = await runAegisIngest();
  } catch (err) {
    errors.push(`ingest: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json<RouteResponse>({ ok: errors.length === 0 && ingest.ok, ingest, errors });
}

async function routeGETImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return run(request);
}

async function routePOSTImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return run(request);
}

export const GET = withRoutePolicy('/api/cron/aegis-ingest', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/aegis-ingest', routePOSTImplementation);
