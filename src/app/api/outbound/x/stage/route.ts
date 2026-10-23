import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/outbound/x/stage
 *
 * The manual "Post to X" button's entry point — unified with the conversational
 * `post_to_x` agent tool. Both now route through the SAME shared composer +
 * staging pipeline: this handler delegates to `postToX`, which composes an
 * on-voice N-tweet thread via the Cyber Wire composer and STAGES it in the
 * approval queue (it never posts). The operator reviews / edits / approves the
 * draft in the AgentDrawer queue, which then runs publishTwitter.
 *
 * Defenses mirror the approve route: same-origin (CSRF), session gate, rate
 * limit. Staging is the human gate, so nothing reaches the public account here.
 *
 * Body: { content, shape?: 'thread'|'single', tweetCount?: 2-7,
 *         attachMediaId?: string, mode?: 'anchor'|'analyst'|'fix_architect' }
 */

import { NextResponse } from 'next/server';
import { postToX } from '@/lib/agent/outbound-tool-handlers';
import { auth } from '@/lib/auth';
import { isAllowedOrigin } from '@/lib/security/csrf';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

interface StageBody {
  content?: unknown;
  shape?: unknown;
  tweetCount?: unknown;
  attachMediaId?: unknown;
  mode?: unknown;
}

async function handleStage(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'cross_origin_blocked' }, { status: 403 });
  }
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: StageBody = {};
  try {
    const raw = await request.text();
    body = raw ? (JSON.parse(raw) as StageBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const content = typeof body.content === 'string' ? body.content : '';
  if (!content.trim()) {
    return NextResponse.json({ ok: false, error: 'content_required' }, { status: 400 });
  }

  // Delegate to the shared compose-and-stage handler with the operator's
  // identity so the draft's created_by is the operator (not the agent).
  const result = await postToX({
    content,
    shape: body.shape,
    tweetCount: body.tweetCount,
    attachMediaId: body.attachMediaId,
    mode: body.mode,
    operatorEmail: actorEmail,
  });

  return NextResponse.json(
    { ok: result.ok, summary: result.summary, error: result.error },
    { status: result.ok ? 200 : 400 },
  );
}

const routePOSTImplementation = withRateLimit(handleStage as never, {
  key: (req: Request) => `outbound:x-stage:${getClientIp(req)}`,
  limit: 20,
  windowMs: 5 * 60_000,
}) as (req: Request) => Promise<Response>;

export const POST = withRoutePolicy('/api/outbound/x/stage', routePOSTImplementation);
