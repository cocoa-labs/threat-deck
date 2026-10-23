/**
 * Phase 9.4 — Single chokepoint that every generator calls to land a draft
 * in the Approval Queue.
 *
 * Responsibilities:
 *   1. Validate the input payload at the boundary (cheap defense in depth —
 *      the generators already validate, but a defensive layer here protects
 *      against future direct callers).
 *   2. INSERT a row into `aegis_outbound_drafts` with `status='drafted'`.
 *   3. Audit via `recordAudit(OUTBOUND_DRAFT_CREATED)`.
 *   4. Broadcast a `outbound:draft_added` event on the `alerts` WS channel
 *      so any open AgentDrawer ApprovalQueueSection (Phase 9.1) shows the
 *      new draft in <250ms instead of waiting for the 30s polling tick.
 *
 * WS broadcast is best-effort: in serverless runtimes the singleton
 * `wsServer` has no clients connected, so the call is a cheap no-op. Open
 * browsers get drafts via WS when the custom server is running and via
 * polling otherwise — the contract is "no draft is lost", not "every
 * draft arrives via WS".
 */

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { query } from '@/lib/db/client';
import {
  type AgentMode,
  type DraftChannel,
  type DraftSeverity,
  type DraftType,
  isAgentMode,
  isDraftChannel,
  isDraftType,
} from '@/lib/outbound/constants';
import { broadcast } from '@/lib/ws/server';
import { validateEmailDraft, validateThreadDraft } from './format';
import type { EmailDraft, ThreadDraft } from './types';

export interface StageDraftInput {
  channel: DraftChannel;
  draftType: DraftType;
  agentMode: AgentMode;
  /** Single-line summary for the queue row. Truncated to 240 chars. */
  headline: string;
  /** ~140-char preview for the queue UI. Truncated to 240 chars. */
  previewText: string;
  /** ThreadDraft for channel='twitter', EmailDraft for channel='email'. */
  draftPayload: ThreadDraft | EmailDraft;
  aiRelevance?: number;
  severity?: DraftSeverity;
  /** Soft FK to aegis_pipeline_alerts.id — see migration 008. */
  sourceAlertId?: number;
  /** 'cron:daily_brief' | 'cron:weekly_deepdive' | 'agent' | user email */
  createdBy: string;
}

export type StageDraftResult =
  | { ok: true; draftId: number }
  | { ok: false; reason: 'invalid_payload' | 'db_insert_failed'; error: string };

const HEADLINE_MAX = 240;
const PREVIEW_MAX = 240;

/** Persist a draft in the Approval Queue. Single source of truth for draft writes. */
export async function stageDraft(input: StageDraftInput): Promise<StageDraftResult> {
  // ─── boundary validation ───────────────────────────────────────────────────
  const validation = validateInput(input);
  if (validation) {
    return { ok: false, reason: 'invalid_payload', error: validation };
  }

  const payload = input.draftPayload;
  const mediaIds =
    'tweets' in payload ? (payload.mediaId ? [payload.mediaId] : []) : (payload.mediaIds ?? []);
  if (mediaIds.length) {
    const owned = await query<{ id: string }>(
      'SELECT id::text FROM aegis_generated_media WHERE id = ANY($1::bigint[]) AND owner_email = $2',
      [mediaIds, input.createdBy],
    );
    if (new Set(owned.rows.map((r) => r.id)).size !== new Set(mediaIds).size)
      return { ok: false, reason: 'invalid_payload', error: 'media_not_owned' };
  }
  const headline = input.headline.slice(0, HEADLINE_MAX);
  const previewText = input.previewText.slice(0, PREVIEW_MAX);

  // ─── INSERT ───────────────────────────────────────────────────────────────
  let draftId: number;
  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO aegis_outbound_drafts
         (source_alert_id, channel, draft_type, agent_mode, headline, preview_text,
          draft_payload, ai_relevance, severity, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'drafted', $10)
       RETURNING id`,
      [
        input.sourceAlertId ?? null,
        input.channel,
        input.draftType,
        input.agentMode,
        headline,
        previewText,
        JSON.stringify(input.draftPayload),
        input.aiRelevance ?? null,
        input.severity ?? null,
        input.createdBy,
      ],
    );
    const row = rows[0];
    if (!row) {
      return {
        ok: false,
        reason: 'db_insert_failed',
        error: 'INSERT returned no row',
      };
    }
    draftId = Number(row.id);
  } catch (err) {
    return {
      ok: false,
      reason: 'db_insert_failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ─── side effects (fire-and-forget; never block the success path) ──────────
  void recordAudit({
    action: AUDIT_ACTIONS.OUTBOUND_DRAFT_CREATED,
    outcome: 'success',
    actorId: input.createdBy,
    targetKind: 'outbound_draft',
    targetId: String(draftId),
    details: {
      channel: input.channel,
      draftType: input.draftType,
      agentMode: input.agentMode,
      tweetCount: 'tweets' in input.draftPayload ? input.draftPayload.tweets.length : 0,
      severity: input.severity ?? null,
      aiRelevance: input.aiRelevance ?? null,
      sourceAlertId: input.sourceAlertId ?? null,
    },
  });

  // WS broadcast — best-effort. In serverless contexts wsServer has no
  // listeners so this is a cheap no-op. Wrap in try so any future runtime
  // surprise doesn't fail the stage call.
  try {
    broadcast('alerts', 'outbound:draft_added', {
      id: draftId,
      channel: input.channel,
      severity: input.severity ?? null,
    });
  } catch {
    // Intentionally swallow — broadcast is enrichment, not contract.
  }

  return { ok: true, draftId };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/** Return null when the input is structurally valid, otherwise the first failure reason. */
function validateInput(input: StageDraftInput): string | null {
  if (!isDraftChannel(input.channel)) return `invalid channel: ${String(input.channel)}`;
  if (!isDraftType(input.draftType)) return `invalid draftType: ${String(input.draftType)}`;
  if (!isAgentMode(input.agentMode)) return `invalid agentMode: ${String(input.agentMode)}`;
  if (typeof input.headline !== 'string' || input.headline.trim().length === 0) {
    return 'headline is empty';
  }
  if (typeof input.createdBy !== 'string' || input.createdBy.trim().length === 0) {
    return 'createdBy is empty';
  }
  if (
    input.aiRelevance !== undefined &&
    (Number.isNaN(input.aiRelevance) || input.aiRelevance < 0 || input.aiRelevance > 1)
  ) {
    return `aiRelevance out of [0, 1]: ${input.aiRelevance}`;
  }
  const draftViolation =
    input.channel === 'email'
      ? validateEmailDraft(input.draftPayload as EmailDraft)
      : validateThreadDraft(input.draftPayload as ThreadDraft);
  if (draftViolation) return `draftPayload invalid: ${draftViolation}`;
  return null;
}
