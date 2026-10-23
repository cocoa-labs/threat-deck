import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/twitter/compose
 *
 * Authenticated, non-publishing helper for the response-level POST TO X
 * modal. It asks the server-side LLM composer for richer default copy and
 * falls back to the deterministic package when the model is unavailable.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isAllowedOrigin } from '@/lib/security/csrf';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { buildXPublishPackageWithLlm } from '@/lib/twitter/publish-package-llm';
import { normalizeSourceContext } from '@/lib/visual/visual-brief';

interface ComposeRequestBody {
  messageContent?: unknown;
  sourceContext?: unknown;
  fallbackSourceUrl?: unknown;
}

async function handlePost(request: Request): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ ok: false, error: 'cross_origin_blocked' }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: ComposeRequestBody;
  try {
    body = (await request.json()) as ComposeRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const messageContent = typeof body.messageContent === 'string' ? body.messageContent.trim() : '';
  if (!messageContent) {
    return NextResponse.json({ ok: false, error: 'empty_message' }, { status: 400 });
  }

  const fallbackSourceUrl =
    typeof body.fallbackSourceUrl === 'string' ? body.fallbackSourceUrl : undefined;
  const pkg = await buildXPublishPackageWithLlm({
    messageContent,
    sourceContext: normalizeSourceContext(body.sourceContext),
    fallbackSourceUrl,
  });

  return NextResponse.json({ ok: true, package: pkg });
}

async function bucketKey(req: Request): Promise<string> {
  try {
    const session = await auth();
    const userId = session?.user?.email;
    if (userId) return `twitter-compose:user:${userId.toLowerCase()}`;
  } catch {
    // Falls through to IP key.
  }
  return `twitter-compose:ip:${getClientIp(req)}`;
}

async function POST_handler(request: Request): Promise<Response> {
  const key = await bucketKey(request);
  const limited = withRateLimit(handlePost, {
    key,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  return limited(request);
}

export const POST = withRoutePolicy('/api/twitter/compose', POST_handler);
