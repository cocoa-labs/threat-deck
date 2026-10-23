import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET (and POST) /api/outbound/x/jobs/[token]
 *
 * The poll endpoint IS the worker: each call advances the background X-post job
 * by one committed step and returns the fresh view. Reload-safe + serverless-
 * safe — any poll (browser, reload-resume, or the reaper cron) drives it
 * forward. Scoped to the owning actor.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getClientIp } from '@/lib/security/rate-limit';
import { advanceXPostJob } from '@/lib/twitter/x-post-job-service';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }> | { token: string };
}

async function handle(request: Request, ctx: RouteContext): Promise<Response> {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { token } = await Promise.resolve(ctx.params);
  const result = await advanceXPostJob(token, actorEmail, {
    id: actorEmail,
    ip: getClientIp(request),
    ua: request.headers.get('user-agent'),
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: result.error === 'forbidden' ? 403 : 404 });
  }
  return NextResponse.json(result, { status: 200 });
}

const routeGETImplementation = handle;
const routePOSTImplementation = handle;

export const GET = withRoutePolicy('/api/outbound/x/jobs/[token]', routeGETImplementation);
export const POST = withRoutePolicy('/api/outbound/x/jobs/[token]', routePOSTImplementation);
