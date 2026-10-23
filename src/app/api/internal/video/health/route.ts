import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/internal/video/health  (Fly render worker — internal only)
 *
 * Read-only, credit-free probe of the machine that actually runs the CLI.
 * The Vercel deployment's HiggsfieldRemoteVideoProvider.probe() calls this so
 * the VID preflight reflects the worker's real auth state rather than Vercel's
 * (which has no CLI at all). Guarded by the same shared secret as the executor
 * routes.
 */

import { verifyInternalRenderSecret } from '@/lib/security/internal-secret';
import { HiggsfieldCliVideoProvider } from '@/lib/visual/providers/higgsfield-cli-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function routeGETImplementation(req: Request): Promise<Response> {
  const guard = verifyInternalRenderSecret(req);
  if (!guard.ok) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: guard.status });
  }

  const probe = await new HiggsfieldCliVideoProvider().probe();
  return Response.json({ ok: true, ...probe }, { status: 200 });
}

export const GET = withRoutePolicy('/api/internal/video/health', routeGETImplementation);
