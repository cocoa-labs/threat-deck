import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET/POST /api/cron/alert-reaper — age out untriaged alerts, and prune
 * watchlist match history past its retention window.
 *
 * The ALERTS board is an operational surface: it should show what is live. With
 * nothing aging rows out, a seeded 2024 KEV row sat at `status='new'` forever
 * and — being the only critical row in the table — permanently owned the hero
 * breaking-alert banner. Rows are resolved, not deleted, so the Cyber Wire
 * archive and RSS can still reach them with an explicit status filter.
 *
 * Cron-secret gated like the sibling reapers.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { pruneMonitorMatches } from '@/lib/db/queries/monitors';
import { resolveStaleAlerts } from '@/lib/db/queries/pipeline-alerts';

export const dynamic = 'force-dynamic';

const STALE_AFTER_DAYS = 14;

/**
 * Watchlist match history retention. The scan writes a row per new
 * (monitor, source, item) every 5 minutes and nothing reclaimed them — one scan
 * of one broad monitor produced 37. 90 days keeps "has this ever fired?"
 * answerable across a quarter without unbounded growth.
 *
 * Safe to delete: anything that mattered also became an `aegis_pipeline_alerts`
 * row, which the Cyber Wire and RSS retain independently.
 */
const MATCH_RETENTION_DAYS = 90;

async function handle(request: Request): Promise<Response> {
  const gate = checkCronSecret(request);
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.reason }, { status: 401 });
  }
  const [resolved, prunedMatches] = await Promise.all([
    resolveStaleAlerts(STALE_AFTER_DAYS),
    pruneMonitorMatches(MATCH_RETENTION_DAYS),
  ]);
  return NextResponse.json({
    ok: true,
    resolved,
    staleAfterDays: STALE_AFTER_DAYS,
    prunedMatches,
    matchRetentionDays: MATCH_RETENTION_DAYS,
  });
}

const routeGETImplementation = handle;
const routePOSTImplementation = handle;

export const GET = withRoutePolicy('/api/cron/alert-reaper', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/alert-reaper', routePOSTImplementation);
