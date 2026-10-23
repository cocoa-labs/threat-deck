import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/outbound/drafts/[id]/approve
 *
 * Body: { publish?: boolean }  (default true — approve + publish in one click)
 *
 * Pipeline:
 *   1. Session auth gate.
 *   2. markApproved(id, session.user.email) — idempotent UPDATE with status guard.
 *      → 409 if status is not drafted|edited; 404 if draft doesn't exist.
 *   3. recordAudit(OUTBOUND_DRAFT_APPROVED).
 *   4. If publish=true: publishDraft(id) — channel-dispatching publisher.
 *      Publish failures return 200 with { ok: false, partial: {...} } so
 *      the row stays in 'approved' state (manual retry possible).
 *   5. Broadcast outbound:draft_decided so other open drawers update.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { getDraft } from '@/lib/outbound/drafts';
import { markApproved } from '@/lib/outbound/mutations';
import { publishDraft } from '@/lib/outbound/publish';
import { isCapabilityEnabled } from '@/lib/security/capabilities';
import { isAllowedOrigin } from '@/lib/security/csrf';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { broadcast } from '@/lib/ws/server';

interface ApproveBody {
  publish?: unknown;
  reviewedPayload?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

async function handleApprove(request: Request, ctx: RouteContext): Promise<Response> {
  // Phase 13 Tier 1 — CSRF defense-in-depth. Approval is a sensitive
  // mutation (can drive Twitter posts via the approve+publish path). On
  // top of the session check below, we reject any POST whose `Origin`
  // header is set and doesn't match our public site URL — that blocks
  // cross-site form attacks while leaving same-origin browser fetches
  // (which set `Origin: <our-domain>`) and direct API tooling
  // (which omits `Origin` entirely) working.
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'cross_origin_blocked' }, { status: 403 });
  }

  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Next.js 15+ wraps params in a Promise; await defensively.
  const params = await Promise.resolve(ctx.params);
  const id = Number.parseInt(params.id, 10);
  if (Number.isNaN(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }

  let body: ApproveBody = {};
  try {
    const raw = await request.text();
    body = raw ? (JSON.parse(raw) as ApproveBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const publish = typeof body.publish === 'boolean' ? body.publish : true;

  // ─── 1. Mark approved (idempotent UPDATE) ───
  const currentDraft = await getDraft(id);
  if (!currentDraft) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  if (
    !body.reviewedPayload ||
    typeof body.reviewedPayload !== 'object' ||
    Array.isArray(body.reviewedPayload)
  ) {
    return NextResponse.json(
      { ok: false, error: 'review_current_draft_before_approval' },
      { status: 400 },
    );
  }
  const capability =
    currentDraft.channel === 'twitter'
      ? 'x'
      : currentDraft.channel === 'email'
        ? 'email'
        : 'publicFeed';
  if (publish && !isCapabilityEnabled(capability))
    return NextResponse.json({ ok: false, error: 'publishing_disabled' }, { status: 503 });
  const approveResult = await markApproved(
    id,
    actorEmail,
    body.reviewedPayload as Record<string, unknown>,
  );
  if (!approveResult.ok) {
    const status =
      approveResult.reason === 'not_found'
        ? 404
        : approveResult.reason === 'not_pending'
          ? 409
          : 500;
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_APPROVED,
      outcome: 'failure',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'outbound_draft',
      targetId: String(id),
      errorMessage: approveResult.reason,
      details: { error: approveResult.error ?? null },
    });
    return NextResponse.json(
      { ok: false, error: approveResult.reason, detail: approveResult.error ?? null },
      { status },
    );
  }

  // ─── 2. Audit the approval ───
  void recordAudit({
    action: AUDIT_ACTIONS.OUTBOUND_DRAFT_APPROVED,
    outcome: 'success',
    actorId: actorEmail,
    actorIp: getClientIp(request),
    targetKind: 'outbound_draft',
    targetId: String(id),
    details: { publishRequested: publish },
  });

  // Look up the draft for the response envelope + WS broadcast metadata.
  const draft = await getDraft(id);

  // Broadcast the decision so other open AgentDrawers update without
  // waiting for their own polling tick. Best-effort: swallow errors.
  try {
    broadcast('alerts', 'outbound:draft_decided', {
      id,
      status: 'approved',
      channel: draft?.channel ?? null,
    });
  } catch {
    // WS server may not be present in serverless contexts — fine.
  }

  // ─── 3. Optionally publish ───
  if (!publish) {
    return NextResponse.json({
      ok: true,
      draftId: id,
      status: 'approved',
      channel: draft?.channel ?? null,
    });
  }

  const publishResult = await publishDraft(id);
  if (!publishResult.ok) {
    // 200 with partial state — the draft is approved but publish failed.
    // The Approval Queue UI surfaces this via a toast / log; the operator
    // can manually retry once the underlying issue (token expired,
    // network) is fixed.
    return NextResponse.json({
      ok: false,
      draftId: id,
      status: 'approved',
      error: publishResult.reason,
      detail: publishResult.details ?? null,
      partial:
        publishResult.reason === 'partial_publish'
          ? {
              publishedCount: publishResult.publishedCount,
              tweetIds: publishResult.tweetIds,
            }
          : undefined,
    });
  }

  // Broadcast the publish completion as a second decided event with the
  // final status, so any drawer that's still showing the row removes it.
  try {
    broadcast('alerts', 'outbound:draft_decided', {
      id,
      status: 'published',
      channel: publishResult.channel,
    });
  } catch {
    // ignore
  }

  return NextResponse.json({
    ok: true,
    draftId: id,
    status: 'published',
    channel: publishResult.channel,
    tweetIds: publishResult.tweetIds,
    dryRun: publishResult.dryRun,
  });
}

const routePOSTImplementation = withRateLimit(handleApprove as never, {
  key: (req: Request) => `approval-queue:approve:${getClientIp(req)}`,
  limit: 30,
  windowMs: 5 * 60_000,
}) as (req: Request, ctx: RouteContext) => Promise<Response>;

export const POST = withRoutePolicy('/api/outbound/drafts/[id]/approve', routePOSTImplementation);
