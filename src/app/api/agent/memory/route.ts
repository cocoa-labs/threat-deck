import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 13 Tier 1 — auth + audit hardening.
 *
 * Long-term Max memory is the highest-leverage prompt-injection vector
 * — a planted memory persists across sessions and influences future
 * generations. Pre-Phase-13 anyone could POST arbitrary memory rows. Now:
 *
 *   - GET requires session.
 *   - POST requires session, length-caps the content, audits the write.
 *
 * Single-tenant scope: memory rows aren't user-scoped at the schema level
 * (the table has no user_id FK yet — multi-user is Phase 12, deferred).
 * For now the audit row is the per-actor anchor.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { getAgentMemory, writeAgentMemory } from '@/lib/db/queries/agent';
import { getClientIp } from '@/lib/security/rate-limit';

const VALID_IMPORTANCE = new Set(['low', 'medium', 'high', 'critical']);

async function routeGETImplementation(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const topic = searchParams.get('topic') ?? undefined;
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(100, Math.max(1, parseInt(limitParam, 10))) : undefined;

    const rows = await getAgentMemory({ topic, limit });

    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('[Agent Memory GET Error]', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : `Failed to fetch ${AGENT_IDENTITY.name} memory`,
      },
      { status: 500 },
    );
  }
}

async function routePOSTImplementation(request: Request): Promise<NextResponse> {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { topic?: string; content?: string; importance?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const topic = body.topic?.slice(0, 200);
  const content = body.content?.slice(0, 20_000);
  const importance =
    body.importance && VALID_IMPORTANCE.has(body.importance) ? body.importance : undefined;

  if (!topic || !content) {
    return NextResponse.json({ error: 'topic and content are required' }, { status: 400 });
  }

  try {
    const id = await writeAgentMemory({ topic, content, importance });

    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_MEMORY_WRITTEN,
      outcome: 'success',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_memory',
      targetId: String(id),
      details: { topic: topic.slice(0, 200), importance: importance ?? null },
    });

    return NextResponse.json({ id });
  } catch (err) {
    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_MEMORY_WRITTEN,
      outcome: 'failure',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_memory',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    console.error('[Agent Memory POST Error]', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : `Failed to write ${AGENT_IDENTITY.name} memory`,
      },
      { status: 500 },
    );
  }
}

export const GET = withRoutePolicy('/api/agent/memory', routeGETImplementation);
export const POST = withRoutePolicy('/api/agent/memory', routePOSTImplementation);
