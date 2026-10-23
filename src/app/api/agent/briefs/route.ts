import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 13 Tier 1 — auth + audit hardening.
 *
 * Pre-Phase-13 the POST handler accepted arbitrary brief rows from
 * anonymous callers — data-poisoning + storage-exhaustion vector. Now:
 *
 *   - GET requires session (briefs may include sensitive intelligence).
 *   - POST requires session + records an audit row keyed to the user.
 *   - insertBrief() previously had no userId association; this remains
 *     true because the existing schema column is FK to a UUID `users`
 *     table that isn't wired in single-tenant mode. The audit row
 *     captures the actor; Phase 12 (multi-user) will reconcile FK.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { getRecentBriefs, insertBrief } from '@/lib/db/queries/agent';
import { getClientIp } from '@/lib/security/rate-limit';
import type { BriefFormat } from '@/lib/types';

async function routeGETImplementation(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const rows = await getRecentBriefs({ limit: 20 });
    const briefs = rows.map((r) => {
      const contentObj = r.content as { text?: string; conversationId?: string } | null;
      return {
        id: r.id,
        headline: r.headline,
        confidence: r.confidence ?? undefined,
        format: r.format as BriefFormat,
        timestamp: r.created_at,
        content: contentObj?.text ?? undefined,
        conversationId: contentObj?.conversationId ?? undefined,
      };
    });
    return NextResponse.json(briefs);
  } catch {
    return NextResponse.json([]);
  }
}

async function routePOSTImplementation(request: Request): Promise<NextResponse> {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    headline?: string;
    format?: string;
    confidence?: string;
    content?: string;
    conversationId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  // Length caps to bound the storage-exhaustion vector even from valid users.
  const headline = (body.headline ?? 'Untitled Brief').slice(0, 500);
  const content = (body.content ?? '').slice(0, 50_000);
  const format = (body.format ?? 'standard').slice(0, 50);

  try {
    const id = await insertBrief({
      topic: headline,
      format,
      headline,
      confidence: body.confidence,
      content: { text: content, conversationId: body.conversationId },
    });

    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_BRIEF_CREATED,
      outcome: 'success',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_brief',
      targetId: String(id),
      details: { headline: headline.slice(0, 200), format },
    });

    return NextResponse.json({ id });
  } catch (err) {
    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_BRIEF_CREATED,
      outcome: 'failure',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_brief',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save brief' },
      { status: 500 },
    );
  }
}

export const GET = withRoutePolicy('/api/agent/briefs', routeGETImplementation);
export const POST = withRoutePolicy('/api/agent/briefs', routePOSTImplementation);
