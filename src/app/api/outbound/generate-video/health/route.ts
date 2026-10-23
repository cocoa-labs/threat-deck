import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/outbound/generate-video/health
 *
 * Operator preflight for the VID button, modelled on /api/twitter/status.
 * Answers "would a render work right now?" without starting one — the probe is
 * a read-only CLI call that spends no credits.
 *
 * Before this existed, a signed-out CLI was only discoverable AFTER composing a
 * render: the popover round-tripped, printed a red error, and the message died
 * with the popover. Now the chip degrades up front and the remediation copy is
 * correct for the transport that would actually have run (local CLI in dev, the
 * Fly worker in production).
 *
 * Never returns token material — only a coarse state plus remediation prose.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { getVideoProvider, isRemoteVideoConfigured } from '@/lib/visual/providers/video-provider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handleGet(_req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const transport = isRemoteVideoConfigured() ? 'remote_worker' : 'local_cli';

  try {
    const probe = await getVideoProvider().probe();
    return NextResponse.json({
      ok: true,
      transport: probe.transport,
      state: probe.state,
      ready: probe.state === 'ready',
      detail: probe.detail ?? null,
    });
  } catch (err) {
    // getVideoProvider() itself throws when the remote transport is selected
    // but unconfigured.
    return NextResponse.json({
      ok: true,
      transport,
      state: 'error',
      ready: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

const routeGETImplementation = withRateLimit(handleGet, {
  key: (req) => `generate-video-health:${getClientIp(req)}`,
  limit: 30,
  windowMs: 60_000,
});

export const GET = withRoutePolicy('/api/outbound/generate-video/health', routeGETImplementation);
