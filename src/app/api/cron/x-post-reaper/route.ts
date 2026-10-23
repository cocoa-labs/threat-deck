import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/cron/x-post-reaper — backstop for background X-post jobs.
 *
 * The browser poll drives a job to completion in the normal case. If the user
 * closes the tab mid-generation (no poller left), this Vercel cron advances any
 * stalled non-terminal job so it still finishes. Cron-secret gated like the
 * other crons.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { reapStalledXPostJobs } from '@/lib/twitter/x-post-job-service';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  const gate = checkCronSecret(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });
  }
  const advanced = await reapStalledXPostJobs();
  return NextResponse.json({ ok: true, advanced }, { status: 200 });
}

const routeGETImplementation = handle;
const routePOSTImplementation = handle;

export const GET = withRoutePolicy('/api/cron/x-post-reaper', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/x-post-reaper', routePOSTImplementation);
