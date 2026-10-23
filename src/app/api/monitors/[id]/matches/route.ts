import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/monitors/[id]/matches — what this watchlist has actually caught.
 *
 * `monitor_match_log` was write-only for the detail: the scan wrote a row per
 * new hit and `recentMonitorMatches()` had zero callers, so the operator could
 * see that a watchlist had 12 hits (the aggregate on /api/monitors) but never
 * which items they were. This is the read path for the rows themselves.
 *
 * Owner-scoped: the query joins to `monitors` on `user_id`, so a monitor id
 * belonging to another operator returns an empty list rather than their data.
 */

import { NextResponse } from 'next/server';
import { resolveOperatorUser } from '@/lib/auth/operator';
import { recentMonitorMatches } from '@/lib/db/queries/monitors';

interface RouteContext {
  params: Promise<{ id: string }> | { id: string };
}

const MAX_LIMIT = 100;

async function routeGETImplementation(request: Request, ctx: RouteContext): Promise<NextResponse> {
  const user = await resolveOperatorUser();
  if (!user) {
    return NextResponse.json({ matches: [], error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await Promise.resolve(ctx.params);
  const requested = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : 20;

  const rows = await recentMonitorMatches(id, user.id, limit);

  return NextResponse.json({
    matches: rows.map((r) => ({
      id: r.id,
      monitorId: r.monitor_id,
      monitorName: r.monitor_name,
      source: r.source,
      itemId: r.item_id,
      matchedKeyword: r.matched_keyword,
      itemTitle: r.item_title,
      itemUrl: r.item_url,
      firedAt: r.fired_at,
    })),
    count: rows.length,
  });
}

export const GET = withRoutePolicy('/api/monitors/[id]/matches', routeGETImplementation);
