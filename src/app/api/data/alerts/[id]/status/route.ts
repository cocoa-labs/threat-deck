import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/data/alerts/[id]/status — move an alert through its lifecycle.
 *
 * Acknowledging on the ALERTS board is the operator saying "seen, handled"; it
 * sets `status = 'triaging'` so the row drops off the unacknowledged count but
 * stays queryable for the Cyber Wire and the agent.
 *
 * Auth: NextAuth session (allowlisted email) + same-origin, matching the other
 * mutating routes in this app.
 */

import { NextResponse } from 'next/server';
import { toAlertHistoryItem } from '@/lib/aegis/alert-mapper';
import { auth } from '@/lib/auth';
import { type PipelineAlertStatus, setPipelineAlertStatus } from '@/lib/db/queries/pipeline-alerts';
import { isAllowedOrigin } from '@/lib/security/csrf';

const VALID_STATUSES: PipelineAlertStatus[] = [
  'new',
  'triaging',
  'escalated',
  'resolved',
  'dismissed',
];

async function routePOSTImplementation(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: 'cross_origin_blocked' }, { status: 403 });
  }
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const alertId = Number(id);
  if (!Number.isInteger(alertId) || alertId <= 0) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const status = body.status as PipelineAlertStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }

  const row = await setPipelineAlertStatus(alertId, status);
  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ alert: toAlertHistoryItem(row) });
}

export const POST = withRoutePolicy('/api/data/alerts/[id]/status', routePOSTImplementation);
