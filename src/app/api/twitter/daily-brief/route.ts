import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST / GET /api/twitter/daily-brief
 *
 * Vercel cron entry at 12:00 UTC (08:00 ET). Calls
 * generateDailyBrief() which composes the 5-7 tweet morning thread and
 * stages it in the Approval Queue (status='drafted'). Nothing publishes
 * autonomously — the human gate at the AgentDrawer is the only path to
 * a live tweet (Phase 9.1).
 *
 * Auth: same `CRON_SECRET` pattern as /api/email/digest.
 * Always returns 200 (fail-soft) — surfaces 401 only on bad cron secret.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, auditDenied, auditFailure, auditSuccess } from '@/lib/audit';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { generateDailyBrief } from '@/lib/twitter/content';
import { checkCronSecret } from '../_cron-secret';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  const actorIp = getClientIp(request);
  const actorUa = request.headers.get('user-agent');

  const auth = checkCronSecret(request);
  if (!auth.ok) {
    void auditDenied(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, auth.reason ?? 'unauthorized', {
      actorId: 'cron:daily_brief',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
    });
    return NextResponse.json({ ok: false, error: auth.reason ?? 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await generateDailyBrief({ createdBy: 'cron:daily_brief' });
    if (result.ok) {
      void auditSuccess(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, {
        actorId: 'cron:daily_brief',
        actorIp,
        actorUa,
        targetKind: 'outbound_draft',
        targetId: String(result.draftId),
        details: {
          draftType: 'daily_brief',
          tweetCount: result.tweetCount,
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
    console.error('[twitter/daily-brief] Unexpected error:', msg);
    void auditFailure(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, err, {
      actorId: 'cron:daily_brief',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
      details: { draftType: 'daily_brief' },
    });
    return NextResponse.json({ ok: false, error: msg });
  }
}

const limitedHandle = withRateLimit(handle, {
  key: 'twitter-daily-brief:global',
  limit: 4,
  windowMs: 60 * 60_000, // 4/hr cap — production fires 1/day, allow manual retests
});

async function routePOSTImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

async function routeGETImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

export const POST = withRoutePolicy('/api/twitter/daily-brief', routePOSTImplementation);
export const GET = withRoutePolicy('/api/twitter/daily-brief', routeGETImplementation);
