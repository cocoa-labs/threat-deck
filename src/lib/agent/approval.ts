import { getPendingApprovals, insertApproval, resolveApproval } from '@/lib/db/queries/agent';
import type { ApprovalRequest } from '@/lib/types';
import { MemoryManager } from './memory';
import { ToolRegistry } from './tool-registry';

/**
 * Legacy human-in-the-loop approval queue — INERT. Read this before trusting it.
 *
 * This module is a complete implementation with no producer. `createApprovalRequest`
 * has zero callers repo-wide, so `approval_queue` is never written, so
 * `fetchPendingApprovals()` always returns `[]` and `processApprovalDecision()`
 * always bails at "Approval request not found" before reaching
 * `executeBypassApproval`. `/api/agent/approve` is fetched by no client code,
 * and `agent-store.pendingApprovals` is only ever set from a WS `approvals`
 * message that nothing emits.
 *
 * It is kept as scaffolding, not deleted, but it is NOT a security control and
 * must not be cited as one.
 *
 * THE WORKING HUMAN GATE IS ELSEWHERE: outbound drafts
 * (`aegis_outbound_drafts` → `/api/outbound/drafts` → `ApprovalQueueSection` in
 * the AgentDrawer). A side-effecting tool stages a draft there and registers
 * with `requiresApproval: false`; the operator reviews, edits, and approves
 * before anything is published. `post_to_x` is the reference implementation.
 *
 * Known latent bug if anyone does revive this: `approval_queue.decided_by` is
 * `UUID REFERENCES users(id)` (migrations/001_initial_schema.sql:149) but the
 * route passes the actor's EMAIL, so `resolveApproval` would throw
 * invalid-input-syntax-for-uuid on the first real decision.
 */

export async function createApprovalRequest(params: {
  agentEventId: string;
  actionType: string;
  actionInput: unknown;
  agentReasoning?: string;
  urgency: string;
}): Promise<string> {
  return insertApproval({
    agentEventId: params.agentEventId,
    actionType: params.actionType,
    actionInput: params.actionInput,
    agentReasoning: params.agentReasoning,
    urgency: params.urgency,
  });
}

export async function fetchPendingApprovals(): Promise<ApprovalRequest[]> {
  const rows = await getPendingApprovals();
  return rows.map((r) => ({
    id: r.id,
    agentEventId: r.agent_event_id ?? '',
    actionType: r.action_type,
    actionInput: r.action_input,
    agentReasoning: r.agent_reasoning ?? undefined,
    urgency: r.urgency as ApprovalRequest['urgency'],
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.status as ApprovalRequest['status'],
  }));
}

/**
 * Process a human approval decision.
 * If approved: execute the original tool call.
 * If rejected: write feedback to agent memory for learning.
 */
export async function processApprovalDecision(params: {
  requestId: string;
  decision: 'approved' | 'rejected';
  userId: string;
  feedback?: string;
}): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const row = await resolveApproval({
    id: params.requestId,
    status: params.decision,
    decidedBy: params.userId,
    feedback: params.feedback,
  });

  if (!row) {
    return { success: false, error: 'Approval request not found' };
  }

  if (params.decision === 'approved') {
    // Execute the original tool call. Thread the approver's identity as the
    // operator context so side-effecting tools resolve "me" correctly.
    const result = await ToolRegistry.executeBypassApproval(
      row.action_type,
      row.action_input as Record<string, unknown>,
      { operatorEmail: params.userId },
    );
    return { success: true, result };
  }

  // Rejected: write to agent memory so it learns from the feedback
  if (params.feedback) {
    try {
      const memory = await MemoryManager.load('system');
      await memory.writeMemory({
        topic: `approval_rejected:${row.action_type}`,
        content: `Action "${row.action_type}" was rejected by user. Input: ${JSON.stringify(row.action_input).slice(0, 200)}. Reason: ${params.feedback}`,
        importance: 'high',
      });
    } catch {
      // Memory write failure is non-critical
    }
  }

  return { success: true };
}
