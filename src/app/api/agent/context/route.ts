import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 13 Tier 1 — auth + scope-to-session hardening.
 *
 * DELETE /api/agent/context clears the calling user's conversation
 * history. Pre-Phase-13 this route accepted an attacker-controlled
 * `userId` query param and would wipe ANY user's conversations — no auth
 * gate. The new behaviour:
 *
 *   - Require an authenticated session (401 if missing).
 *   - Always scope the clear to `session.user.email`, ignoring any
 *     `userId` query string the caller supplies. This means legacy
 *     clients that still send the param keep working (server overrides);
 *     Tier 4 will sweep the param from the 2 client callers
 *     (AgentCommandBar, AgentDrawer).
 *   - Audit each clear so we have a record of intentional vs accidental
 *     wipes.
 */

import { NextResponse } from 'next/server';
import { deleteAttachmentBlobs } from '@/lib/agent/attachments/blob-cleanup';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { clearConversationExchanges } from '@/lib/db/queries/agent';
import { softDeleteChatAttachmentsForOwner } from '@/lib/db/queries/attachments';
import { getClientIp } from '@/lib/security/rate-limit';

async function routeDELETEImplementation(request: Request): Promise<NextResponse> {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    // Always scope to the authenticated user — explicitly override any
    // `userId` query param a caller might send. Pre-Tier-1 the param was
    // honored verbatim, letting `?userId=admin` wipe the admin's history.
    const deletedAttachments = await softDeleteChatAttachmentsForOwner(actorEmail);
    await Promise.allSettled(deletedAttachments.map((row) => deleteAttachmentBlobs(row)));
    await clearConversationExchanges({ userId: actorEmail });

    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_CONTEXT_CLEARED,
      outcome: 'success',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_context',
      targetId: actorEmail,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    void recordAudit({
      action: AUDIT_ACTIONS.AGENT_CONTEXT_CLEARED,
      outcome: 'failure',
      actorId: actorEmail,
      actorIp: getClientIp(request),
      targetKind: 'agent_context',
      targetId: actorEmail,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Failed to clear context' },
      { status: 500 },
    );
  }
}

export const DELETE = withRoutePolicy('/api/agent/context', routeDELETEImplementation);
