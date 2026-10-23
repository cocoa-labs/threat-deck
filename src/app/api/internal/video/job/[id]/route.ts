import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/internal/video/job/[id]  (Fly render worker — internal only)
 *
 * Machine-to-machine executor: runs `higgsfield` CLI `generate get <id>` on the
 * Fly machine and returns the raw HiggsfieldJobState. Called by the Vercel
 * deployment's HiggsfieldRemoteVideoProvider during polling. Guarded by the
 * shared x-internal-render-secret header; no NextAuth session.
 */

import { verifyInternalRenderSecret } from '@/lib/security/internal-secret';
import {
  HiggsfieldCliError,
  HiggsfieldCliVideoProvider,
} from '@/lib/visual/providers/higgsfield-cli-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function statusFromCliError(code: HiggsfieldCliError['code']): number {
  return code === 'disabled' ? 503 : 500;
}

async function routeGETImplementation(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = verifyInternalRenderSecret(req);
  if (!guard.ok) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: guard.status });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  try {
    const job = await new HiggsfieldCliVideoProvider().getJob(id);
    return Response.json(job, { status: 200 });
  } catch (err) {
    if (err instanceof HiggsfieldCliError) {
      return Response.json(
        { ok: false, error: err.code, detail: err.detail ?? err.message },
        { status: statusFromCliError(err.code) },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[internal/video/job] failed:', detail);
    return Response.json({ ok: false, error: 'get_job_failed', detail }, { status: 500 });
  }
}

export const GET = withRoutePolicy('/api/internal/video/job/[id]', routeGETImplementation);
