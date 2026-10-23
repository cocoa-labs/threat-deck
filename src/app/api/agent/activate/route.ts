import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 13 Tier 1 — dual-mode auth (session OR cron-secret).
 *
 * /api/agent/activate is the entry point for triggering autonomous agent
 * activations from arbitrary eventType + data payloads. Pre-Phase-13 it
 * was unauthenticated — attacker could fabricate `cve.kev_added` events
 * to drive breaking-tweet drafts into the approval queue.
 *
 * Two legitimate callers:
 *   1. Browser activation watcher (use-activation-events.ts) POSTs with
 *      the user's session cookie when the dashboard sees a real signal.
 *   2. Future server-to-server crons may POST with the shared CRON_SECRET.
 *
 * Either authenticates the request; both rejected = 401.
 *
 * Note: processEvent() remains exported from @/lib/agent/activation so
 * internal in-process callers (severity-history emitter, etc.) don't
 * need to round-trip through HTTP.
 */

import { NextResponse } from 'next/server';
import { checkCronSecret } from '@/app/api/twitter/_cron-secret';
import { extractBluf, processEvent } from '@/lib/agent/activation';
import { registerAllTools } from '@/lib/agent/tools';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

registerAllTools();

async function handleActivate(request: Request): Promise<Response> {
  // Dual-mode auth: session OR cron-secret. Either is sufficient.
  const session = await auth();
  const sessionEmail = session?.user?.email ?? null;
  const cronAuth = sessionEmail ? null : checkCronSecret(request);

  if (!sessionEmail && !cronAuth?.ok) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized', reason: cronAuth?.reason ?? 'no session' },
      { status: 401 },
    );
  }

  const actorId = sessionEmail ?? 'cron:agent-activate';

  let body: { eventType?: string; data?: Record<string, unknown>; headline?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { eventType, data } = body;
  if (!eventType) {
    return NextResponse.json({ error: 'eventType is required' }, { status: 400 });
  }

  try {
    // Carry the client's own headline into the event payload so the alert row
    // lands with a readable title immediately, rather than waiting ~10s for the
    // agent's BLUF to overwrite the mechanical fallback.
    const payload = { ...(data ?? {}) };
    if (typeof body.headline === 'string' && body.headline.trim()) {
      payload.headline = body.headline.trim().slice(0, 200);
    }

    const result = await processEvent(eventType, payload);

    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_ACTIVATE_REQUESTED,
      outcome: 'success',
      actorId,
      actorIp: getClientIp(request),
      targetKind: 'agent_activation',
      targetId: eventType.slice(0, 200),
      details: { triggered: Boolean(result), severity: result?.trigger.severity ?? null },
    });

    if (!result) {
      return NextResponse.json({ triggered: false });
    }

    // Extract headline from the first line or BLUF of the response
    const text = result.result.text;
    const headline = extractBluf(text) ?? `${AGENT_IDENTITY.name} analysis complete`;

    return NextResponse.json({
      triggered: true,
      text,
      headline,
      severity: result.trigger.severity,
      source: result.trigger.source,
      tokensInput: result.result.tokensInput,
      tokensOutput: result.result.tokensOutput,
      durationMs: result.result.durationMs,
    });
  } catch (err) {
    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_ACTIVATE_REQUESTED,
      outcome: 'failure',
      actorId,
      actorIp: getClientIp(request),
      targetKind: 'agent_activation',
      targetId: eventType.slice(0, 200),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Activation failed' },
      { status: 500 },
    );
  }
}

// Phase 13 Tier 3 — Per-user rate-limit. Browser activation watcher
// fires ~1 event per detected signal with a 120s client-side cooldown,
// so 60/min/user is a comfortable ceiling. Cron-secret callers (the
// dual-mode path) bucket under their IP since there's no user identity.
async function activateBucketKey(req: Request): Promise<string> {
  try {
    const session = await auth();
    const email = session?.user?.email;
    if (email) return `agent-activate:user:${email.toLowerCase()}`;
  } catch {
    // fall through
  }
  return `agent-activate:ip:${getClientIp(req)}`;
}

async function POST_handler(request: Request): Promise<Response> {
  const key = await activateBucketKey(request);
  const limited = withRateLimit(handleActivate, {
    key,
    limit: 60,
    windowMs: 60_000,
  });
  return limited(request);
}

export const POST = withRoutePolicy('/api/agent/activate', POST_handler);
