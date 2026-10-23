import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * POST /api/internal/video/start  (Fly render worker — internal only)
 *
 * Machine-to-machine executor: runs the `higgsfield` CLI `generate create` on
 * the Fly machine (where the binary + OAuth creds live) and returns the raw
 * HiggsfieldJobState. The Vercel deployment's HiggsfieldRemoteVideoProvider is
 * the only caller; it authenticates with the x-internal-render-secret header.
 *
 * No NextAuth session — guarded solely by the shared secret. On Vercel (no CLI)
 * this route is inert: the CLI provider throws 'disabled' → 503.
 */

import { reserveBudget } from '@/lib/security/budget';
import { verifyInternalRenderSecret } from '@/lib/security/internal-secret';
import {
  HiggsfieldCliError,
  HiggsfieldCliVideoProvider,
  type HiggsfieldStartVideoInput,
} from '@/lib/visual/providers/higgsfield-cli-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StartBody {
  prompt?: unknown;
  aspectRatio?: unknown;
  durationSeconds?: unknown;
  resolution?: unknown;
  mode?: unknown;
  genre?: unknown;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function statusFromCliError(code: HiggsfieldCliError['code']): number {
  return code === 'disabled' ? 503 : 500;
}

async function routePOSTImplementation(req: Request): Promise<Response> {
  const guard = verifyInternalRenderSecret(req);
  if (!guard.ok) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: guard.status });
  }

  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const prompt = str(body.prompt);
  if (!prompt) {
    return Response.json({ ok: false, error: 'prompt is required' }, { status: 400 });
  }

  const input: HiggsfieldStartVideoInput = {
    prompt,
    aspectRatio: str(body.aspectRatio),
    durationSeconds: num(body.durationSeconds),
    resolution: str(body.resolution),
    mode: str(body.mode),
    genre: str(body.genre),
  };

  try {
    const release = await reserveBudget('media', Number(process.env.VIDEO_RESERVATION_USD || 20));
    try {
      const job = await new HiggsfieldCliVideoProvider().startVideo(input);
      return Response.json(job, { status: 200 });
    } finally {
      await release();
    }
  } catch (err) {
    if (err instanceof HiggsfieldCliError) {
      return Response.json(
        { ok: false, error: err.code, detail: err.detail ?? err.message },
        { status: statusFromCliError(err.code) },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[internal/video/start] failed:', detail);
    return Response.json({ ok: false, error: 'start_failed', detail }, { status: 500 });
  }
}

export const POST = withRoutePolicy('/api/internal/video/start', routePOSTImplementation);
