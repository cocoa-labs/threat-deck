import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/outbound/generate-image (Phase 14 Tier A)
 *
 * Entry-point for the IMG button in AgentDrawer. Accepts a message snapshot,
 * kicks off a fire-and-forget visual generation pipeline, and returns 202
 * immediately. Clients poll /api/outbound/generated-media/[id] for status.
 *
 * Pipeline:
 *   1. auth() gate
 *   2. Parse + validate body
 *   3. checkOutboundVisualSpend() — 429 on hard cap
 *   4. build VisualBrief from full agent response + source context
 *   5. resolveVisualStyleTag(visualBrief, styleTag) — final template
 *   6. sha256(visual-v2 + content + context + style) → messageHash for dedup
 *   6. SELECT existing row (same hash + style, status pending/ready) → 200 dedup
 *   7. INSERT new row (status='pending') RETURNING id
 *   8. void generateInfographic(...) — background, NOT awaited
 *   9. Return 202 { ok, generatedMediaId, status, pollUrl }
 *
 * Rate limited: 10 requests / hour per client IP (Redis sliding window).
 */

import { auth } from '@/lib/auth';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { startImageGeneration } from '@/lib/visual/image-generation-service';
import type { StyleTag } from '@/lib/visual/style-registry';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';

// ─── Request body shape ───────────────────────────────────────────────────────

interface GenerateImageBody {
  messageContent?: unknown;
  messageTimestamp?: unknown;
  styleTag?: StyleTag;
  entityKind?: string;
  entityId?: string;
  bluf?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  dataTiles?: Array<{ label: string; value: string }>;
  sourceUrl?: string;
  sourceContext?: VisualBriefSourceContext;
}

// ─── Row type returned from INSERT ───────────────────────────────────────────

function getErrorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  // 1. Auth gate
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse body
  let body: GenerateImageBody;
  try {
    body = (await req.json()) as GenerateImageBody;
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // 3. Validate required fields
  const messageContent = typeof body.messageContent === 'string' ? body.messageContent.trim() : '';
  if (!messageContent) {
    return Response.json({ ok: false, error: 'messageContent is required' }, { status: 400 });
  }

  try {
    const result = await startImageGeneration({
      messageContent,
      messageTimestamp: body.messageTimestamp,
      styleTag: body.styleTag,
      entityKind: body.entityKind,
      entityId: body.entityId,
      severity: body.severity,
      dataTiles: body.dataTiles,
      bluf: body.bluf,
      sourceContext: body.sourceContext,
      actorEmail: session.user.email,
    });

    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          error: result.error ?? 'generate_image_failed',
          detail: result.detail,
        },
        { status: result.error === 'visual_spend_cap_exceeded' ? 429 : 500 },
      );
    }

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
    const detail = getErrorDetail(err);
    console.error('[generate-image] request failed:', detail);
    return Response.json({ ok: false, error: 'generate_image_failed', detail }, { status: 500 });
  }
}

// ─── Export with rate limit wrapper ──────────────────────────────────────────

const routePOSTImplementation = withRateLimit(handler, {
  key: (req) => `generate-image:${getClientIp(req)}`,
  limit: 10,
  windowMs: 3_600_000, // 1 hour
});

export const POST = withRoutePolicy('/api/outbound/generate-image', routePOSTImplementation);
