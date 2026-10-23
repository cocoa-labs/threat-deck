import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/outbound/generate-video
 *
 * Entry-point for the VID button in AgentDrawer. Mirrors generate-image:
 * accepts a message snapshot, kicks off a Seedance render, and returns 202
 * immediately. Clients poll /api/outbound/generated-media/[id] for status (the
 * AgentDrawer auto-poller owns this — the button does not block).
 *
 * Generation runs through getVideoProvider(): the local `higgsfield` CLI in
 * dev, or the Fly render worker in production (via HIGGSFIELD_REMOTE_URL).
 *
 * Rate limited: 5 requests / hour per client IP (video is pricier + slower than
 * the IMG button's 10/hour).
 */

import { auth } from '@/lib/auth';
import { checkRateLimit, refundRateLimit } from '@/lib/security/rate-limit';
import { startVideoGeneration } from '@/lib/visual/video-generation-service';
import { normalizeVideoParams } from '@/lib/visual/video-params';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';

// The dedup path awaits a liveness refresh, which can reach the provider.
export const runtime = 'nodejs';
export const maxDuration = 120;

const RENDER_LIMIT = 5;
const RENDER_WINDOW_MS = 3_600_000; // 1 hour

interface GenerateVideoBody {
  messageContent?: unknown;
  messageTimestamp?: unknown;
  aspectRatio?: unknown;
  durationSeconds?: unknown;
  resolution?: unknown;
  genre?: unknown;
  entityKind?: string;
  entityId?: string;
  sourceContext?: VisualBriefSourceContext;
}

function getErrorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function handler(req: Request): Promise<Response> {
  // 1. Auth gate — deliberately BEFORE the rate limiter (see the export below),
  //    so an expired session retrying in a stale tab can't burn render quota.
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let body: GenerateVideoBody;
  try {
    body = (await req.json()) as GenerateVideoBody;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // 3. Validate required fields
  const messageContent = typeof body.messageContent === 'string' ? body.messageContent.trim() : '';
  if (!messageContent) {
    return Response.json({ ok: false, error: 'messageContent is required' }, { status: 400 });
  }

  // 4. Normalize the popover knobs (Format / Length / Genre) through the shared
  //    seedance_2_0 allowlists, so this route and the agent tool agree.
  const params = normalizeVideoParams(body);

  // 5. Rate limit — after auth + validation, keyed on the operator rather than
  //    their IP (single-tenant app). Refunded below if no render actually ran.
  const bucket = `generate-video:${session.user.email}`;
  const limit = await checkRateLimit(bucket, RENDER_LIMIT, RENDER_WINDOW_MS);
  if (!limit.allowed) {
    return Response.json(
      {
        ok: false,
        error: 'rate_limit_exceeded',
        detail: `Too many renders. Try again in ${limit.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const result = await startVideoGeneration({
      content: messageContent,
      messageTimestamp: body.messageTimestamp,
      ...params,
      entityKind: body.entityKind,
      entityId: body.entityId,
      sourceContext: body.sourceContext,
      actorEmail: session.user.email,
    });

    if (!result.ok) {
      // Nothing was rendered and nothing was billed — don't spend a slot.
      await refundRateLimit(bucket);
      console.error('[generate-video] start failed:', result.error, result.detail);
      return Response.json(
        {
          ok: false,
          error: result.error ?? 'generate_video_failed',
          detail: result.detail,
        },
        { status: result.error === 'visual_spend_cap_exceeded' ? 429 : 500 },
      );
    }
    // A dedup hit reuses an existing render — it costs nothing, so it shouldn't
    // count against the hourly budget either.
    if (result.dedup) await refundRateLimit(bucket);

    return Response.json(
      {
        ok: true,
        generatedMediaId: result.generatedMediaId,
        status: result.status,
        blobUrl: result.blobUrl ?? null,
        styleTag: result.styleTag,
        pollUrl: result.pollUrl,
        dedup: result.dedup,
      },
      { status: result.dedup ? 200 : 202 },
    );
  } catch (err) {
    await refundRateLimit(bucket);
    const detail = getErrorDetail(err);
    console.error('[generate-video] request failed:', detail);
    return Response.json({ ok: false, error: 'generate_video_failed', detail }, { status: 500 });
  }
}

const routePOSTImplementation = handler;

export const POST = withRoutePolicy('/api/outbound/generate-video', routePOSTImplementation);
