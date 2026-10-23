import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST / GET /api/twitter/weekly-deepdive
 *
 * Vercel cron entry at 14:00 UTC every Monday. Calls
 * generateWeeklyDeepDive() which picks the week's apex AI-cyber story,
 * enriches with MITRE TTPs + IOCs from the AEGIS join graph, and stages
 * an 8-10 tweet analyst-mode SITREP thread. Approval-gated like daily-brief.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, auditDenied, auditFailure, auditSuccess } from '@/lib/audit';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { generateWeeklyDeepDive } from '@/lib/twitter/content';
import { checkCronSecret } from '../_cron-secret';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  const actorIp = getClientIp(request);
  const actorUa = request.headers.get('user-agent');

  const auth = checkCronSecret(request);
  if (!auth.ok) {
    void auditDenied(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, auth.reason ?? 'unauthorized', {
      actorId: 'cron:weekly_deepdive',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
    });
    return NextResponse.json({ ok: false, error: auth.reason ?? 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await generateWeeklyDeepDive({ createdBy: 'cron:weekly_deepdive' });
    if (result.ok) {
      void auditSuccess(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, {
        actorId: 'cron:weekly_deepdive',
        actorIp,
        actorUa,
        targetKind: 'outbound_draft',
        targetId: String(result.draftId),
        details: {
          draftType: 'weekly_deepdive',
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
    console.error('[twitter/weekly-deepdive] Unexpected error:', msg);
    void auditFailure(AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED, err, {
      actorId: 'cron:weekly_deepdive',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
      details: { draftType: 'weekly_deepdive' },
    });
    return NextResponse.json({ ok: false, error: msg });
  }
}

const limitedHandle = withRateLimit(handle, {
  key: 'twitter-weekly-deepdive:global',
  limit: 2,
  windowMs: 60 * 60_000, // 2/hr cap — production fires 1/week
});

async function routePOSTImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

async function routeGETImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

export const POST = withRoutePolicy('/api/twitter/weekly-deepdive', routePOSTImplementation);
export const GET = withRoutePolicy('/api/twitter/weekly-deepdive', routeGETImplementation);
