import { withRoutePolicy } from '@/lib/security/route-policy';

/** Retired: every external post must pass through the persistent approval queue. */
export const POST = withRoutePolicy('/api/twitter/post', async (_request: Request) =>
  Response.json(
    { ok: false, error: 'Use /api/outbound/x/review and approve the resulting draft.' },
    { status: 410 },
  ),
);
