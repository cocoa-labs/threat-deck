import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET/POST /api/cron/email-reply-scan — refresh reply counts on our recently
 * sent emails (email detour Step 6). Walks the sent-email registry and fetches
 * each thread's replies via the Gmail reader, updating reply_count +
 * last_checked_at (the touch happens inside checkEmailReplies).
 *
 * No auto-reply — the manual approval gate stays. This just keeps the Email
 * Replies panel + tool warm and is the hook for future autonomous reply
 * suggestions. Auth via checkCronSecret (fails open in dev). Fail-soft: always
 * 200. When the Gmail read scope isn't granted yet, every thread reports 0
 * replies (no error).
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { checkEmailReplies } from '@/lib/agent/outbound-tool-handlers';

interface RouteResponse {
  ok: boolean;
  emailsScanned: number;
  totalReplies: number;
  errors: string[];
}

async function run(request: Request): Promise<NextResponse<RouteResponse>> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json<RouteResponse>(
      { ok: false, emailsScanned: 0, totalReplies: 0, errors: [auth.reason ?? 'auth failed'] },
      { status: 401 },
    );
  }

  const errors: string[] = [];
  let emailsScanned = 0;
  let totalReplies = 0;
  try {
    const result = await checkEmailReplies({ limit: 10 });
    emailsScanned = result.posts.length;
    totalReplies = result.posts.reduce((sum, p) => sum + p.replyCount, 0);
  } catch (err) {
    errors.push(`email-reply-scan: ${err instanceof Error ? err.message : String(err)}`);
  }

  return NextResponse.json<RouteResponse>({
    ok: errors.length === 0,
    emailsScanned,
    totalReplies,
    errors,
  });
}

async function routeGETImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return run(request);
}

async function routePOSTImplementation(request: Request): Promise<NextResponse<RouteResponse>> {
  return run(request);
}

export const GET = withRoutePolicy('/api/cron/email-reply-scan', routeGETImplementation);
export const POST = withRoutePolicy('/api/cron/email-reply-scan', routePOSTImplementation);
