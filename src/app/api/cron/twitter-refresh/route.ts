import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Twitter OAuth token keep-alive — PRODUCTION scheduler.
 *
 * Vercel Cron hits this hourly (see vercel.json). It proactively refreshes the
 * stored access token before it expires so posts never hit the lazy
 * expired-refresh path, and so the rotating refresh token keeps rotating
 * (preventing inactivity expiry). With this running you authorize X ONCE and
 * stay connected indefinitely.
 *
 * Local dev uses a different mechanism (an in-process interval in
 * `src/instrumentation.ts`) because Vercel Cron doesn't run on a laptop and
 * serverless instances are too ephemeral for setInterval.
 *
 * Auth: same cron-secret gate as the other Vercel crons (Bearer / x-cron-secret).
 * Always returns 200 (even on no_token / refresh_failed) so Vercel doesn't mark
 * the job failed + retry-spam; the body carries the real status for logs.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { proactiveRefreshToken } from '@/lib/twitter/oauth';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  const gate = checkCronSecret(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });
  }
  const result = await proactiveRefreshToken();
  if (!result.ok && result.reason !== 'fresh') {
    console.warn('[twitter/keepalive] proactive refresh:', result.reason);
  }
  return NextResponse.json(result, { status: 200 });
}

// Vercel Cron sends GET; also accept POST for manual / scripted invocation.
const routeGETImplementation = handle;
const routePOSTImplementation = handle;

export const GET = withRoutePolicy('/api/cron/twitter-refresh', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/twitter-refresh', routePOSTImplementation);
