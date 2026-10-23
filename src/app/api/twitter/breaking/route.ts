import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/twitter/breaking
 *
 * Called from `src/lib/agent/activation.ts:processEvent('cve.kev_added')`
 * when the inbound CISA KEV addition's `ai_relevance > 0.6`. Server-to-
 * server call gated by `CRON_SECRET` so this can't be triggered from the
 * outside even though it's not in a cron schedule.
 *
 * Body: `{ sourceAlertId: number }`
 *
 * Calls generateBreakingTweet() which composes a single AI-cyber tweet
 * for the alert and stages it in the Approval Queue. Idempotent at the
 * generator boundary (each call creates a fresh draft; multiple calls
 * for the same alert produce multiple drafts — the activation cooldown
 * upstream is the rate guard).
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, auditDenied, auditFailure, auditSuccess } from '@/lib/audit';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { generateBreakingTweet } from '@/lib/twitter/content';
import { checkCronSecret } from '../_cron-secret';

export const dynamic = 'force-dynamic';

interface BreakingBody {
  sourceAlertId?: unknown;
}

async function handle(request: Request): Promise<Response> {
  const actorIp = getClientIp(request);
  const actorUa = request.headers.get('user-agent');

  const auth = checkCronSecret(request);
  if (!auth.ok) {
    void auditDenied(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, auth.reason ?? 'unauthorized', {
      actorId: 'agent:breaking',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
    });
    return NextResponse.json({ ok: false, error: auth.reason ?? 'unauthorized' }, { status: 401 });
  }

  let body: BreakingBody;
  try {
    body = (await request.json()) as BreakingBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const sourceAlertId =
    typeof body.sourceAlertId === 'number'
      ? body.sourceAlertId
      : Number.parseInt(String(body.sourceAlertId ?? ''), 10);
  if (!Number.isFinite(sourceAlertId) || sourceAlertId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid_sourceAlertId' }, { status: 400 });
  }

  try {
    const result = await generateBreakingTweet({
      sourceAlertId,
      createdBy: 'agent:breaking',
    });
    if (result.ok) {
      void auditSuccess(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, {
        actorId: 'agent:breaking',
        actorIp,
        actorUa,
        targetKind: 'outbound_draft',
        targetId: String(result.draftId),
        details: {
          draftType: 'breaking',
          sourceAlertId,
          preview: result.preview,
        },
      });
      return NextResponse.json({
        ok: true,
        draftId: result.draftId,
        tweetCount: result.tweetCount,
        preview: result.preview,
      });
    }
    return NextResponse.json({
      ok: false,
      reason: result.reason,
      detail: result.details ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[twitter/breaking] Unexpected error:', msg);
    void auditFailure(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, err, {
      actorId: 'agent:breaking',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
      details: { draftType: 'breaking', sourceAlertId },
    });
    return NextResponse.json({ ok: false, error: msg });
  }
}

const limitedHandle = withRateLimit(handle, {
  key: (req: Request) => `twitter-breaking:${getClientIp(req)}`,
  limit: 20,
  windowMs: 60 * 60_000, // 20/hr per IP — activation cooldowns are upstream
});

async function routePOSTImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

export const POST = withRoutePolicy('/api/twitter/breaking', routePOSTImplementation);
