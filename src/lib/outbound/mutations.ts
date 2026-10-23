/**
 * Phase 9.1 — Outbound draft write helpers.
 *
 * Every status transition that the Approval Queue triggers goes through one
 * of these three functions:
 *
 *     markApproved  →  status: drafted|edited → approved
 *     markRejected  →  status: drafted|edited → rejected
 *     markPublished →  status: approved → published, sets outbound_log_id
 *
 * Idempotency / concurrency: each UPDATE includes a `WHERE status IN (…)`
 * guard so a second concurrent writer sees zero rows updated and returns
 * `{ ok: false, reason: 'not_pending' }`. This is how two simultaneous
 * "APPROVE" clicks on the same draft resolve deterministically — first
 * write wins, second gets a 409 from the route handler.
 *
 * Fail-soft contract: errors return typed failure objects, never throw.
 */

import { query } from '@/lib/db/client';
import { logger } from '@/lib/logger';

export type DecisionResult =
  | { ok: true; status: 'approved' | 'rejected' | 'published' | 'edited' }
  | { ok: false; reason: 'not_pending' | 'not_found' | 'db_error'; error?: string };

/** Transition drafted/edited → approved. Idempotent against concurrent callers. */
export async function markApproved(
  id: number,
  decidedBy: string,
  reviewedPayload: Record<string, unknown>,
): Promise<DecisionResult> {
  try {
    const { rowCount } = await query(
      `UPDATE aegis_outbound_drafts
          SET status = 'approved', decided_at = NOW(), decided_by = $2
        WHERE id = $1 AND status IN ('drafted', 'edited') AND draft_payload = $3::jsonb`,
      [id, decidedBy, JSON.stringify(reviewedPayload)],
    );
    if (rowCount === 0) {
      return classifyMiss(id);
    }
    return { ok: true, status: 'approved' };
  } catch (err) {
    return dbErr('markApproved', id, err);
  }
}

/** Transition drafted/edited → rejected with mandatory reason. */
export async function markRejected(
  id: number,
  decidedBy: string,
  reason: string,
): Promise<DecisionResult> {
  if (!reason || reason.trim().length === 0) {
    return { ok: false, reason: 'db_error', error: 'reason is required' };
  }
  try {
    const { rowCount } = await query(
      `UPDATE aegis_outbound_drafts
          SET status = 'rejected', decided_at = NOW(), decided_by = $2,
              rejection_reason = $3
        WHERE id = $1 AND status IN ('drafted', 'edited')`,
      [id, decidedBy, reason.trim().slice(0, 1_000)],
    );
    if (rowCount === 0) {
      return classifyMiss(id);
    }
    return { ok: true, status: 'rejected' };
  } catch (err) {
    return dbErr('markRejected', id, err);
  }
}

/**
 * Transition approved → published. `outboundLogId` is the FK back to
 * `aegis_outbound_log`; pass null for channels (e.g., rss) where no
 * outbound log row is created.
 */
export async function markPublished(
  id: number,
  outboundLogId: number | null,
): Promise<DecisionResult> {
  try {
    const { rowCount } = await query(
      `UPDATE aegis_outbound_drafts
          SET status = 'published', published_at = NOW(), outbound_log_id = $2
        WHERE id = $1 AND status = 'approved'`,
      [id, outboundLogId],
    );
    if (rowCount === 0) {
      return classifyMiss(id);
    }
    return { ok: true, status: 'published' };
  } catch (err) {
    return dbErr('markPublished', id, err);
  }
}

/**
 * Replace a pending draft's payload (inline edit from the Approval Queue) and
 * flip it to `edited`. Same status guard as the decision mutations so a draft
 * that's already approved/rejected/published can't be edited out from under a
 * concurrent reviewer. `previewText` is refreshed from the first tweet so the
 * queue row reflects the edit.
 */
export async function updateDraftPayload(
  id: number,
  payload: Record<string, unknown>,
  editedBy: string,
): Promise<DecisionResult> {
  const tweets = Array.isArray(payload.tweets) ? payload.tweets : [];
  const firstText =
    tweets[0] && typeof (tweets[0] as { text?: unknown }).text === 'string'
      ? String((tweets[0] as { text: string }).text)
      : '';
  try {
    const { rowCount } = await query(
      `UPDATE aegis_outbound_drafts
          SET status = 'edited', draft_payload = $2::jsonb, preview_text = $3, decided_by = $4
        WHERE id = $1 AND status IN ('drafted', 'edited')`,
      [id, JSON.stringify(payload), firstText.slice(0, 240), editedBy],
    );
    if (rowCount === 0) {
      return classifyMiss(id);
    }
    return { ok: true, status: 'edited' };
  } catch (err) {
    return dbErr('updateDraftPayload', id, err);
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * When an UPDATE affects 0 rows, classify why: either the draft doesn't
 * exist (`not_found`) or it does but its status doesn't qualify
 * (`not_pending`). Lets the route return 404 vs 409 distinctly.
 */
async function classifyMiss(id: number): Promise<DecisionResult> {
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM aegis_outbound_drafts WHERE id = $1) AS exists`,
      [id],
    );
    if (!rows[0]?.exists) {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: false, reason: 'not_pending' };
  } catch {
    return { ok: false, reason: 'db_error', error: 'classification failed' };
  }
}

function dbErr(op: string, id: number, err: unknown): DecisionResult {
  const message = err instanceof Error ? err.message : String(err);
  logger.warn(`[outbound] ${op} failed`, { id, err: message });
  return { ok: false, reason: 'db_error', error: message };
}
