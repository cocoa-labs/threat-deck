import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/outbound/x/replies — replies to OUR recent posted threads (X detour
 * Step 5). Reuses the checkXReplies engine; auth-gated (only the operator sees
 * our reply activity). Fail-soft: returns an empty set on tier-blocked reads.
 */

import { NextResponse } from 'next/server';
import { checkXReplies } from '@/lib/agent/outbound-tool-handlers';
import { auth } from '@/lib/auth';

async function routeGETImplementation(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ posts: [], summary: 'unauthorized' }, { status: 401 });
  }
  const result = await checkXReplies({ limit: 8 });
  return NextResponse.json({ posts: result.posts, summary: result.summary });
}

export const GET = withRoutePolicy('/api/outbound/x/replies', routeGETImplementation);
