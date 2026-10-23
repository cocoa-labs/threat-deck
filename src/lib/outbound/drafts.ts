/**
 * Phase 9.1 — Outbound draft read helpers.
 *
 * The Approval Queue UI and the future stale-escalation cron (Phase 9.5)
 * both read pending drafts. This module is the single place that knows
 * how to translate `aegis_v_pending_drafts` (and the broader
 * `aegis_outbound_drafts`) into typed application shapes.
 *
 * Fail-soft contract: every function returns either a typed value, `null`,
 * or `[]` on failure — never throws. DB errors log via `logger.warn` and
 * the caller falls back gracefully.
 */

import { query } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import type {
  AgentMode,
  DraftChannel,
  DraftSeverity,
  DraftStatus,
  DraftType,
} from '@/lib/outbound/constants';

export interface DraftRow {
  id: number;
  sourceAlertId: number | null;
  channel: DraftChannel;
  draftType: DraftType;
  agentMode: AgentMode;
  headline: string;
  previewText: string | null;
  aiRelevance: number | null;
  severity: DraftSeverity | null;
  status: DraftStatus;
  createdBy: string;
  createdAt: string; // ISO timestamp
  ageSeconds: number;
}

/** Full draft including the LLM-generated payload — used by publishDraft + approve/reject API responses. */
export interface DraftFull extends DraftRow {
  draftPayload: Record<string, unknown>;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectionReason: string | null;
  publishedAt: string | null;
  outboundLogId: number | null;
}

interface RawPendingRow {
  id: string | number;
  source_alert_id: number | null;
  channel: string;
  draft_type: string;
  agent_mode: string;
  headline: string;
  preview_text: string | null;
  ai_relevance: string | null;
  severity: string | null;
  status: string;
  created_by: string;
  created_at: Date | string;
  age_seconds: number | string;
}

interface RawFullRow extends RawPendingRow {
  draft_payload: Record<string, unknown>;
  decided_at: Date | string | null;
  decided_by: string | null;
  rejection_reason: string | null;
  published_at: Date | string | null;
  outbound_log_id: number | null;
}

/**
 * List drafts awaiting human review (status in 'drafted' or 'edited').
 * Reads from the Phase 9.0 view `aegis_v_pending_drafts` which already
 * sorts critical → high → ai_relevance → recency.
 *
 * Returns at most `opts.limit` rows (default 20). Filter by channel if
 * provided. Returns `[]` on any DB error.
 */
export async function listPendingDrafts(opts?: {
  channel?: DraftChannel;
  limit?: number;
}): Promise<DraftRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 100);
  try {
    const { rows } = opts?.channel
      ? await query<RawPendingRow>(
          `SELECT id, source_alert_id, channel, draft_type, agent_mode, headline,
                  preview_text, ai_relevance, severity, status, created_by, created_at, age_seconds
             FROM aegis_v_pending_drafts
            WHERE channel = $1
            LIMIT $2`,
          [opts.channel, limit],
        )
      : await query<RawPendingRow>(
          `SELECT id, source_alert_id, channel, draft_type, agent_mode, headline,
                  preview_text, ai_relevance, severity, status, created_by, created_at, age_seconds
             FROM aegis_v_pending_drafts
            LIMIT $1`,
          [limit],
        );
    return rows.map(toDraftRow);
  } catch (err) {
    logger.warn('[outbound] listPendingDrafts failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * List drafts of any status (including approved / rejected / published) for
 * the "all" view in the Approval Queue UI. Sorted newest first.
 */
export async function listAllDrafts(opts?: {
  channel?: DraftChannel;
  limit?: number;
}): Promise<DraftRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  try {
    const { rows } = opts?.channel
      ? await query<RawPendingRow>(
          `SELECT id, source_alert_id, channel, draft_type, agent_mode, headline,
                  preview_text, ai_relevance, severity, status, created_by, created_at,
                  EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_seconds
             FROM aegis_outbound_drafts
            WHERE channel = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [opts.channel, limit],
        )
      : await query<RawPendingRow>(
          `SELECT id, source_alert_id, channel, draft_type, agent_mode, headline,
                  preview_text, ai_relevance, severity, status, created_by, created_at,
                  EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_seconds
             FROM aegis_outbound_drafts
            ORDER BY created_at DESC
            LIMIT $1`,
          [limit],
        );
    return rows.map(toDraftRow);
  } catch (err) {
    logger.warn('[outbound] listAllDrafts failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Fetch a single draft by id, INCLUDING the full draft_payload. Used by
 * publishDraft (needs the tweets array) and the approve/reject routes
 * (for the response envelope).
 */
export async function getDraft(id: number): Promise<DraftFull | null> {
  try {
    const { rows } = await query<RawFullRow>(
      `SELECT id, source_alert_id, channel, draft_type, agent_mode, headline,
              preview_text, draft_payload, ai_relevance, severity, status, created_by,
              created_at, decided_at, decided_by, rejection_reason, published_at,
              outbound_log_id,
              EXTRACT(EPOCH FROM (NOW() - created_at))::int AS age_seconds
         FROM aegis_outbound_drafts
        WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return toDraftFull(row);
  } catch (err) {
    logger.warn('[outbound] getDraft failed', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Return the timestamp of the most recently decided draft (any status
 * except 'drafted' / 'edited'). Used by the empty-state footnote
 * (`// queue clear // last reviewed 2h ago`). Returns null if no decision
 * has ever been recorded.
 */
export async function lastDecidedAt(): Promise<string | null> {
  try {
    const { rows } = await query<{ decided_at: Date | string | null }>(
      `SELECT decided_at FROM aegis_outbound_drafts
        WHERE decided_at IS NOT NULL
        ORDER BY decided_at DESC LIMIT 1`,
    );
    const row = rows[0];
    if (!row?.decided_at) return null;
    return row.decided_at instanceof Date ? row.decided_at.toISOString() : String(row.decided_at);
  } catch {
    return null;
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function toDraftRow(r: RawPendingRow): DraftRow {
  return {
    id: Number(r.id),
    sourceAlertId: r.source_alert_id ?? null,
    channel: r.channel as DraftChannel,
    draftType: r.draft_type as DraftType,
    agentMode: r.agent_mode as AgentMode,
    headline: r.headline,
    previewText: r.preview_text,
    aiRelevance: r.ai_relevance == null ? null : Number(r.ai_relevance),
    severity: (r.severity as DraftSeverity | null) ?? null,
    status: r.status as DraftStatus,
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    ageSeconds: Number(r.age_seconds),
  };
}

function toDraftFull(r: RawFullRow): DraftFull {
  const base = toDraftRow(r);
  return {
    ...base,
    draftPayload: r.draft_payload ?? {},
    decidedAt: r.decided_at
      ? r.decided_at instanceof Date
        ? r.decided_at.toISOString()
        : String(r.decided_at)
      : null,
    decidedBy: r.decided_by,
    rejectionReason: r.rejection_reason,
    publishedAt: r.published_at
      ? r.published_at instanceof Date
        ? r.published_at.toISOString()
        : String(r.published_at)
      : null,
    outboundLogId: r.outbound_log_id,
  };
}
