import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/outbound/email/replies — replies to OUR recent sent emails (email
 * detour Step 5). Reuses the checkEmailReplies engine; auth-gated (only the
 * operator sees our reply activity). Fail-soft: returns an empty set when the
 * Gmail read scope hasn't been granted to the service account yet.
 */

import { NextResponse } from 'next/server';
import { checkEmailReplies } from '@/lib/agent/outbound-tool-handlers';
import { auth } from '@/lib/auth';

async function routeGETImplementation(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ posts: [], summary: 'unauthorized' }, { status: 401 });
  }
  const result = await checkEmailReplies({ limit: 8 });
  return NextResponse.json({ posts: result.posts, summary: result.summary });
}

export const GET = withRoutePolicy('/api/outbound/email/replies', routeGETImplementation);
