import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/outbound/drafts/[id]/reject
 *
 * Body: { reason: string }  (mandatory paper trail — empty is 400)
 *
 * Pipeline:
 *   1. Session auth gate.
 *   2. markRejected(id, session.user.email, reason) — idempotent UPDATE.
 *      → 409 if status is not drafted|edited; 404 if draft doesn't exist.
 *   3. recordAudit(OUTBOUND_DRAFT_REJECTED) with the reason in details.
 *   4. Broadcast outbound:draft_decided so other open drawers update.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { getDraft } from '@/lib/outbound/drafts';
import { markRejected } from '@/lib/outbound/mutations';
import { isAllowedOrigin } from '@/lib/security/csrf';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { broadcast } from '@/lib/ws/server';

interface RejectBody {
  reason?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

async function handleReject(request: Request, ctx: RouteContext): Promise<Response> {
  // Phase 13 Tier 1 — Origin-header CSRF guard. See approve/route.ts for
  // the rationale. Cross-site form POSTs always set `Origin` to the
  // attacker's domain; same-origin browser fetches set ours; direct API
  // tooling omits `Origin` and passes through.
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'cross_origin_blocked' }, { status: 403 });
  }

  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const params = await Promise.resolve(ctx.params);
  const id = Number.parseInt(params.id, 10);
  if (Number.isNaN(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }

  let body: RejectBody;
  try {
    body = (await request.json()) as RejectBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    return NextResponse.json(
      { ok: false, error: 'reason_required', detail: 'reason is mandatory for rejection' },
      { status: 400 },
    );
  }

  // ─── Mark rejected (idempotent UPDATE) ───
  const result = await markRejected(id, actorEmail, reason);
  if (!result.ok) {
    const status =
      result.reason === 'not_found' ? 404 : result.reason === 'not_pending' ? 409 : 500;
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_REJECTED,
      outcome: 'failure',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'outbound_draft',
      targetId: String(id),
      errorMessage: result.reason,
      details: { reason: reason.slice(0, 200), error: result.error ?? null },
    });
    return NextResponse.json(
      { ok: false, error: result.reason, detail: result.error ?? null },
      { status },
    );
  }

  void recordAudit({
    action: AUDIT_ACTIONS.OUTBOUND_DRAFT_REJECTED,
    outcome: 'success',
    actorId: actorEmail,
    actorIp: getClientIp(request),
    targetKind: 'outbound_draft',
    targetId: String(id),
    details: { reason: reason.slice(0, 500) },
  });

  // Best-effort WS broadcast — sync open drawers.
  const draft = await getDraft(id);
  try {
    broadcast('alerts', 'outbound:draft_decided', {
      id,
      status: 'rejected',
      channel: draft?.channel ?? null,
    });
  } catch {
    // ignore
  }

  return NextResponse.json({
    ok: true,
    draftId: id,
    status: 'rejected',
    channel: draft?.channel ?? null,
  });
}

const routePOSTImplementation = withRateLimit(handleReject as never, {
  key: (req: Request) => `approval-queue:reject:${getClientIp(req)}`,
  limit: 30,
  windowMs: 5 * 60_000,
}) as (req: Request, ctx: RouteContext) => Promise<Response>;

export const POST = withRoutePolicy('/api/outbound/drafts/[id]/reject', routePOSTImplementation);
