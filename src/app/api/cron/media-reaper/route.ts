import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/cron/media-reaper — backstop for stalled Seedance renders.
 *
 * Mirrors x-post-reaper. A video job only advances while a logged-in browser is
 * polling `/api/outbound/generated-media/[id]`, so closing the tab mid-render
 * orphaned the row: it stayed 'pending' forever, the finished MP4 was never
 * pulled into Blob, and the credits were spent for nothing. Worse, that zombie
 * row used to match the dedup lookup and permanently block re-rendering the
 * same response.
 *
 * This sweep drives pending renders forward and declares the truly dead ones
 * dead, so the operator sees a failure instead of an eternal spinner.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { reapStalledVideoRenders } from '@/lib/visual/video-generation-service';

export const dynamic = 'force-dynamic';
// Sweeps up to 50 pending rows, each potentially a provider call + download.
export const runtime = 'nodejs';
export const maxDuration = 300;

async function handle(request: Request): Promise<Response> {
  const gate = checkCronSecret(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });
  }
  const { advanced, failed } = await reapStalledVideoRenders();
  return NextResponse.json({ ok: true, advanced, failed }, { status: 200 });
}

const routeGETImplementation = handle;
const routePOSTImplementation = handle;

export const GET = withRoutePolicy('/api/cron/media-reaper', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/media-reaper', routePOSTImplementation);
