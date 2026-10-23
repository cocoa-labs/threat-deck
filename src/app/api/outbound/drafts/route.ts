import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/outbound/drafts
 *
 * List drafts for the Approval Queue UI. Session-auth gated.
 *
 * Query params:
 *   status:  'pending' (default) | 'all'
 *   channel: 'twitter' | 'email' | 'rss' (optional filter)
 *   limit:   1..100 (default 20 for pending, 50 for all)
 *
 * Response:
 *   { ok: true, drafts: DraftRow[] }
 *   { ok: false, error: '...' } with appropriate HTTP status
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isDraftChannel } from '@/lib/outbound/constants';
import { listAllDrafts, listPendingDrafts } from '@/lib/outbound/drafts';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

async function handleGet(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const channelParam = url.searchParams.get('channel');
  const limitParam = url.searchParams.get('limit');

  if (status !== 'pending' && status !== 'all') {
    return NextResponse.json(
      { ok: false, error: 'invalid_status', detail: 'status must be pending or all' },
      { status: 400 },
    );
  }

  const channel = channelParam && isDraftChannel(channelParam) ? channelParam : undefined;
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  if (limitParam && (Number.isNaN(limit) || (limit ?? 0) < 1)) {
    return NextResponse.json({ ok: false, error: 'invalid_limit' }, { status: 400 });
  }

  const drafts =
    status === 'all'
      ? await listAllDrafts({ channel, limit })
      : await listPendingDrafts({ channel, limit });

  return NextResponse.json({ ok: true, drafts });
}

const routeGETImplementation = withRateLimit(handleGet, {
  key: (req: Request) => `approval-queue:list:${getClientIp(req)}`,
  limit: 60,
  windowMs: 60_000,
});

export const GET = withRoutePolicy('/api/outbound/drafts', routeGETImplementation);
