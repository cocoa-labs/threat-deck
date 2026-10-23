import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET  /api/outbound/drafts/[id]  — fetch a single draft incl. draft_payload
 *                                   (the Approval Queue editor lazy-loads the
 *                                   tweets here; the pending list omits payload).
 * PATCH /api/outbound/drafts/[id] — replace a pending draft's payload (inline
 *                                   per-tweet edit) and flip it to `edited`.
 *
 * PATCH mirrors the approve route's defenses: same-origin (CSRF), session gate,
 * rate limit. The edited thread is re-validated with the SAME rules staging
 * uses, so an edit that drops the canonical hashtag or empties a tweet is
 * rejected with a 400 the UI can surface.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { getDraft } from '@/lib/outbound/drafts';
import { updateDraftPayload } from '@/lib/outbound/mutations';
import { isAllowedOrigin } from '@/lib/security/csrf';
import { ownsDraftMedia } from '@/lib/security/media-ownership';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import {
  type EmailDraft,
  type ThreadDraft,
  validateEmailDraft,
  validateThreadDraft,
} from '@/lib/twitter/content';
import { broadcast } from '@/lib/ws/server';

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

async function parseId(ctx: RouteContext): Promise<number | null> {
  const params = await Promise.resolve(ctx.params);
  const id = Number.parseInt(params.id, 10);
  return Number.isNaN(id) || id <= 0 ? null : id;
}

async function routeGETImplementation(_request: Request, ctx: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, draft });
}

interface PatchBody {
  draftPayload?: unknown;
}

async function handlePatch(request: Request, ctx: RouteContext): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'cross_origin_blocked' }, { status: 403 });
  }
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const id = await parseId(ctx);
  if (id == null) return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });

  let body: PatchBody = {};
  try {
    const raw = await request.text();
    body = raw ? (JSON.parse(raw) as PatchBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const payload = body.draftPayload;
  if (!payload || typeof payload !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', detail: 'draftPayload object is required' },
      { status: 400 },
    );
  }

  // Load the draft to learn its channel — validation rules differ (email reply
  // drafts have no tweets[], so the Twitter rules would wrongly reject them).
  const existing = await getDraft(id);
  if (!existing) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  let violation: string | null;
  if (existing.channel === 'email') {
    violation = validateEmailDraft(payload as EmailDraft);
  } else if (!Array.isArray((payload as { tweets?: unknown }).tweets)) {
    violation = 'draftPayload.tweets[] is required';
  } else {
    violation = validateThreadDraft(payload as ThreadDraft);
  }
  if (violation) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', detail: violation },
      { status: 400 },
    );
  }

  const edited = payload as Record<string, unknown>;
  if (
    JSON.stringify([edited.mediaId, edited.mediaIds]) !==
    JSON.stringify([existing.draftPayload.mediaId, existing.draftPayload.mediaIds])
  ) {
    return NextResponse.json(
      { ok: false, error: 'Create a new draft to change private attachments.' },
      { status: 400 },
    );
  }
  if (!(await ownsDraftMedia(edited, existing.createdBy))) {
    return NextResponse.json({ ok: false, error: 'media_not_owned' }, { status: 403 });
  }
  const result = await updateDraftPayload(id, payload as Record<string, unknown>, actorEmail);
  if (!result.ok) {
    const status =
      result.reason === 'not_found' ? 404 : result.reason === 'not_pending' ? 409 : 500;
    return NextResponse.json(
      { ok: false, error: result.reason, detail: result.error ?? null },
      { status },
    );
  }

  void recordAudit({
    action: AUDIT_ACTIONS.OUTBOUND_DRAFT_EDITED,
    outcome: 'success',
    actorId: actorEmail,
    actorIp: getClientIp(request),
    targetKind: 'outbound_draft',
    targetId: String(id),
  });

  // Refresh open drawers (the queue key invalidates on this event).
  try {
    broadcast('alerts', 'outbound:draft_added', { id, channel: existing.channel, severity: null });
  } catch {
    // best-effort — WS may be absent in serverless contexts
  }

  return NextResponse.json({ ok: true, draftId: id, status: 'edited' });
}

const routePATCHImplementation = withRateLimit(handlePatch as never, {
  key: (req: Request) => `approval-queue:edit:${getClientIp(req)}`,
  limit: 60,
  windowMs: 5 * 60_000,
}) as (req: Request, ctx: RouteContext) => Promise<Response>;

export const GET = withRoutePolicy('/api/outbound/drafts/[id]', routeGETImplementation);
export const PATCH = withRoutePolicy('/api/outbound/drafts/[id]', routePATCHImplementation);
