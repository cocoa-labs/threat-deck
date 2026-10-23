import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST / GET /api/twitter/predictions-thread
 *
 * Vercel cron entry — fires Mondays at 13:00 UTC (09:00 ET). Calls
 * generateWeeklyPredictionsThread() which composes the 4-tweet weekly
 * predictions thread for the configured X account and stages it in the Approval Queue.
 * Nothing publishes autonomously — the human gate at the AgentDrawer is
 * the only path to a live tweet.
 *
 * Auth: same checkCronSecret pattern as /api/twitter/daily-brief.
 * Always returns 200 (fail-soft) — 401 only on bad cron secret.
 *
 * Mirrors /api/twitter/daily-brief/route.ts exactly to keep the
 * Phase-9 staging surface uniform.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, auditDenied, auditFailure, auditSuccess } from '@/lib/audit';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { generateWeeklyPredictionsThread } from '@/lib/twitter/content';
import { checkCronSecret } from '../_cron-secret';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  const actorIp = getClientIp(request);
  const actorUa = request.headers.get('user-agent');

  const auth = checkCronSecret(request);
  if (!auth.ok) {
    void auditDenied(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, auth.reason ?? 'unauthorized', {
      actorId: 'cron:predictions_thread',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
    });
    return NextResponse.json({ ok: false, error: auth.reason ?? 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await generateWeeklyPredictionsThread({ createdBy: 'cron:predictions_thread' });
    if (result.ok) {
      void auditSuccess(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, {
        actorId: 'cron:predictions_thread',
        actorIp,
        actorUa,
        targetKind: 'outbound_draft',
        targetId: String(result.draftId),
        details: {
          draftType: 'predictions_thread',
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
    console.error('[twitter/predictions-thread] Unexpected error:', msg);
    void auditFailure(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, err, {
      actorId: 'cron:predictions_thread',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
      details: { draftType: 'predictions_thread' },
    });
    return NextResponse.json({ ok: false, error: msg });
  }
}

const limitedHandle = withRateLimit(handle, {
  key: 'twitter-predictions-thread:global',
  limit: 4,
  windowMs: 60 * 60_000, // 4/hr cap — production fires 1/week, allow manual retests
});

async function routePOSTImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

async function routeGETImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

export const POST = withRoutePolicy('/api/twitter/predictions-thread', routePOSTImplementation);
export const GET = withRoutePolicy('/api/twitter/predictions-thread', routeGETImplementation);
