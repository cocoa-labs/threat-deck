/**
 * ═══════════════════════════════════════════════
 * Cocoa AI Threat Deck — Audit Trail Recorder
 * ═══════════════════════════════════════════════
 *
 * The single entry point for security-sensitive event logging. Every call
 * does two things:
 *
 *   1. Emit a structured log line at `info`/`audit` level via `logger.audit()`
 *      so the event lands in stdout for the log shipper (Datadog/Vector/Loki).
 *
 *   2. Persist a row to the `aegis_audit_log` Postgres table for long-term
 *      retention and querying by the SECURITY runbook, compliance reports,
 *      and the agent itself.
 *
 * The DB write is **fire-and-forget** — it returns a Promise that the caller
 * may choose to await or not. Logging must NEVER block the request hot path.
 * If the write fails, the failure is logged but not thrown. The stdout log
 * line is the source of truth in that scenario.
 *
 * What to audit (use `AUDIT_ACTIONS` for canonical action strings):
 *   - Authentication flow events (magic-link request/accept/reject)
 *   - Outbound writes (Twitter post, email digest send)
 *   - Privileged mutations (alert rule changes, brief publishing)
 *   - Admin actions (OAuth token rotation, manual KEV add)
 *
 * What NOT to audit (use `logger.info`/`debug` instead):
 *   - Routine data fetches
 *   - Healthchecks, status pings
 *   - Agent tool invocations (those have their own structured event log)
 *
 * Sensitive payload rules — enforced by `redactSensitive()`:
 *   - Strip keys named `password`, `token`, `secret`, `api_key`, `authorization`,
 *     `cookie`, `set-cookie`, `bearer`, `refresh_token`, `access_token`.
 *   - Mask string values longer than 200 chars (truncate + ellipsis).
 *   - Email addresses inside strings are preserved (they're useful audit signal).
 */

import { query } from '@/lib/db/client';
import { formatError, logger } from '@/lib/logger';

// ─── Canonical action vocabulary ─────────────────────────────────────────────

/**
 * Canonical audit action strings. Use these constants instead of free-form
 * strings so we can grep for callers and so the SECURITY runbook documents a
 * stable vocabulary. Naming convention: `<category>.<verb>_<object>` in
 * snake_case.
 */
export const AUDIT_ACTIONS = {
  // Auth
  AUTH_MAGIC_LINK_REQUESTED: 'auth.magic_link_requested',
  AUTH_MAGIC_LINK_ACCEPTED: 'auth.magic_link_accepted',
  AUTH_MAGIC_LINK_DENIED: 'auth.magic_link_denied',
  AUTH_SESSION_CREATED: 'auth.session_created',
  AUTH_SESSION_REVOKED: 'auth.session_revoked',

  // Outbound
  OUTBOUND_TWEET_POSTED: 'outbound.tweet_posted',
  OUTBOUND_TWEET_FAILED: 'outbound.tweet_failed',
  OUTBOUND_TWEET_DENIED: 'outbound.tweet_denied',
  OUTBOUND_TWEET_DUPLICATE: 'outbound.tweet_duplicate',
  OUTBOUND_EMAIL_DIGEST_SENT: 'outbound.email_digest_sent',
  OUTBOUND_EMAIL_ALERT_SENT: 'outbound.email_alert_sent',
  // Phase 13 Tier 5 — operator-initiated EMAIL ME button on agent responses.
  // Operator clicks the button in the AgentDrawer footer; route renders the
  // agent's SITREP via AgentResponseEmail template and ships to the
  // operator's inbox (EMAIL_ME_RECIPIENT env var, falls back to session.user.email).
  OUTBOUND_EMAIL_AGENT_RESPONSE_SENT: 'outbound.email_agent_response_sent',
  // Phase 13 Tier 5.1 — conversational email tool. Agent fires
  // `email_conversation` from a natural-language operator ask; this
  // action audits each per-recipient send (one row per recipient when
  // the tool fans out to multiple addresses).
  OUTBOUND_EMAIL_AGENT_CONVERSATION_SENT: 'outbound.email_agent_conversation_sent',
  // Phase 14 Tier A — visual generation
  OUTBOUND_VISUAL_GENERATED: 'outbound.visual_generated',
  OUTBOUND_VISUAL_FAILED: 'outbound.visual_failed',
  OUTBOUND_VISUAL_BLOCKED_COST: 'outbound.visual_blocked_cost',
  OUTBOUND_RSS_PUBLISHED: 'outbound.rss_published',

  // Admin
  ADMIN_OAUTH_TOKEN_ROTATED: 'admin.oauth_token_rotated',
  ADMIN_OAUTH_TOKEN_REVOKED: 'admin.oauth_token_revoked',
  ADMIN_KEV_ADDED: 'admin.kev_added',
  ADMIN_ALERT_RULE_CREATED: 'admin.alert_rule_created',
  ADMIN_ALERT_RULE_DELETED: 'admin.alert_rule_deleted',

  // Agent (high-trust, low-volume — most agent activity goes to agent_events, not here)
  AGENT_BRIEF_PUBLISHED: 'agent.brief_published',
  AGENT_ESCALATION_RAISED: 'agent.escalation_raised',
  AGENT_APPROVAL_GRANTED: 'agent.approval_granted',
  AGENT_APPROVAL_REJECTED: 'agent.approval_rejected',
  // Agent invocation failed — categorized error from SSE stream
  AGENT_INVOKE_FAILED: 'agent.invoke_failed',
  // Phase 13 Tier 1 — security-relevant agent mutations behind the auth gates.
  AGENT_INVOKE_REQUESTED: 'agent.invoke_requested',
  AGENT_STREAM_OPENED: 'agent.stream_opened',
  AGENT_ACTIVATE_REQUESTED: 'agent.activate_requested',
  AGENT_MEMORY_WRITTEN: 'agent.memory_written',
  AGENT_BRIEF_CREATED: 'agent.brief_created',
  AGENT_CONTEXT_CLEARED: 'agent.context_cleared',

  // Data
  DATA_KEV_INGESTED: 'data.kev_ingested',
  DATA_BREACH_INGESTED: 'data.breach_ingested',
  // AI-relevance scoring (Phase 9.2)
  DATA_AI_RELEVANCE_SCORED: 'data.ai_relevance_scored',
  DATA_HAIKU_PARSE_FAILED: 'data.haiku_parse_failed',
  // Phase 11 forecasting + data foundation
  DATA_EPSS_INGESTED: 'data.epss_ingested',
  // Phase 1 — AEGIS ingest orchestrator rollup (one row per cron run)
  DATA_AEGIS_INGESTED: 'data.aegis_ingested',
  // Phase 1C — live geo-threat events
  DATA_GEO_EVENTS_INGESTED: 'data.geo_events_ingested',
  // Phase 2 — watchlist scan
  DATA_MONITOR_SCANNED: 'data.monitor_scanned',
  DATA_FORECAST_GENERATED: 'data.forecast_generated',
  DATA_FORECAST_OUTCOME_OBSERVED: 'data.forecast_outcome_observed',

  // Outbound draft lifecycle (Phase 9.4 + 9.1)
  // 9.4 introduces CREATED (generators stage drafts).
  // 9.1 adds APPROVED / REJECTED / PUBLISHED (Approval Queue UI).
  // 9.5 will add STALE_ESCALATED (escalation cron).
  // EDITED — inline per-tweet edit from the Approval Queue (conversational X posting).
  OUTBOUND_DRAFT_CREATED: 'outbound.draft_created',
  OUTBOUND_DRAFT_APPROVED: 'outbound.draft_approved',
  OUTBOUND_DRAFT_REJECTED: 'outbound.draft_rejected',
  OUTBOUND_DRAFT_EDITED: 'outbound.draft_edited',
  OUTBOUND_DRAFT_PUBLISHED: 'outbound.draft_published',
  // Phase 9.5 — escalation cron sweeps stale critical drafts and emails reviewers.
  OUTBOUND_DRAFT_STALE_ESCALATED: 'outbound.draft_stale_escalated',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditCategory = 'auth' | 'outbound' | 'admin' | 'agent' | 'data';
export type AuditOutcome = 'success' | 'failure' | 'denied' | 'rate_limited';

// Derive the category from the action prefix — keeps audit() calls terse and
// guarantees the action ↔ category mapping never drifts.
function categoryFromAction(action: string): AuditCategory {
  const prefix = action.split('.', 1)[0];
  switch (prefix) {
    case 'auth':
      return 'auth';
    case 'outbound':
      return 'outbound';
    case 'admin':
      return 'admin';
    case 'agent':
      return 'agent';
    case 'data':
      return 'data';
    default:
      return 'admin';
  }
}

// ─── Sensitive value redaction ───────────────────────────────────────────────

const SENSITIVE_KEY_RE =
  /password|secret|token|api[_-]?key|authorization|cookie|bearer|refresh|access[_-]?token|private[_-]?key/i;

const MAX_STRING_LEN = 200;
const MAX_UA_LEN = 256;

/**
 * Recursively walk an object, replacing values under sensitive keys with
 * '[REDACTED]' and truncating very long strings. Returns a NEW object — the
 * input is not mutated.
 */
export function redactSensitive(input: unknown, depth = 0): unknown {
  if (depth > 8) return '[REDACTED:max_depth]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (input.length > MAX_STRING_LEN) {
      return `${input.slice(0, MAX_STRING_LEN)}…[truncated ${input.length} chars]`;
    }
    return input;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactSensitive(v, depth + 1));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitive(value, depth + 1);
      }
    }
    return out;
  }
  return String(input);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface AuditEvent {
  action: AuditAction | string;
  outcome: AuditOutcome;
  actorId?: string | null;
  actorIp?: string | null;
  actorUa?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
  errorMessage?: string | null;
  /**
   * Optional explicit category. Defaults to the prefix of `action`. Override
   * only if your action string doesn't follow the `category.verb_object`
   * convention.
   */
  category?: AuditCategory;
}

/**
 * Record an audit event. Returns a Promise so callers MAY await the DB write
 * for tests or end-of-request flushing, but in production code you can safely
 * call it without awaiting — failures are logged, never thrown.
 */
export async function recordAudit(event: AuditEvent): Promise<void> {
  const category = event.category ?? categoryFromAction(event.action);
  const redactedDetails = redactSensitive(event.details ?? {});

  // Truncate user-agent — they can be 500+ chars from some clients and we
  // don't want them blowing up audit row size or breaking the column index.
  const truncatedUa =
    event.actorUa && event.actorUa.length > MAX_UA_LEN
      ? event.actorUa.slice(0, MAX_UA_LEN)
      : (event.actorUa ?? null);

  // 1. Always emit to stdout. This is synchronous and never fails.
  logger.audit(event.action, {
    category,
    outcome: event.outcome,
    actorId: event.actorId ?? undefined,
    actorIp: event.actorIp ?? undefined,
    targetKind: event.targetKind ?? undefined,
    targetId: event.targetId ?? undefined,
    requestId: event.requestId ?? undefined,
    error: event.errorMessage ?? undefined,
    details: redactedDetails,
  });

  // 2. Fire-and-forget DB persistence. Caller may await; we never await internally.
  // Normalize actorIp at this boundary: `getClientIp()` returns the literal
  // string 'unknown' as its fallback when no x-forwarded-for / x-real-ip
  // header is present (test env, server-to-server calls). Postgres's `inet`
  // column type rejects that string and the entire audit INSERT fails,
  // leaving the DB row missing even though the JSON audit line lands.
  // Map 'unknown' → null so the inet column accepts it.
  const normalizedIp = !event.actorIp || event.actorIp === 'unknown' ? null : event.actorIp;
  try {
    await query(
      `INSERT INTO aegis_audit_log
        (action, category, outcome, actor_id, actor_ip, actor_ua,
         target_kind, target_id, request_id, details, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        event.action,
        category,
        event.outcome,
        event.actorId ?? null,
        normalizedIp,
        truncatedUa,
        event.targetKind ?? null,
        event.targetId ?? null,
        event.requestId ?? null,
        JSON.stringify(redactedDetails),
        event.errorMessage ?? null,
      ],
    );
  } catch (err) {
    // DB write failed — we don't want to break the request path, but we need
    // to make this loud in logs so it can be investigated. The stdout audit
    // line is the source of truth at this point.
    logger.error('audit.db_write_failed', {
      action: event.action,
      err: formatError(err),
    });
  }
}

/**
 * Convenience: record a "success" audit event.
 */
export function auditSuccess(
  action: AuditAction | string,
  rest: Omit<AuditEvent, 'action' | 'outcome'> = {},
): Promise<void> {
  return recordAudit({ action, outcome: 'success', ...rest });
}

/**
 * Convenience: record a "failure" audit event with error context.
 */
export function auditFailure(
  action: AuditAction | string,
  err: unknown,
  rest: Omit<AuditEvent, 'action' | 'outcome' | 'errorMessage'> = {},
): Promise<void> {
  const formatted = formatError(err);
  return recordAudit({
    action,
    outcome: 'failure',
    errorMessage: formatted.message,
    ...rest,
    details: { ...(rest.details ?? {}), errorName: formatted.name },
  });
}

/**
 * Convenience: record a "denied" audit event (allowlist rejection, missing
 * permission, missing CRON_SECRET, etc).
 */
export function auditDenied(
  action: AuditAction | string,
  reason: string,
  rest: Omit<AuditEvent, 'action' | 'outcome' | 'errorMessage'> = {},
): Promise<void> {
  return recordAudit({
    action,
    outcome: 'denied',
    errorMessage: reason,
    ...rest,
  });
}

/**
 * Convenience: record a "rate_limited" audit event. Use when a request was
 * rejected by the rate limiter — distinct from a permission denial.
 */
export function auditRateLimited(
  action: AuditAction | string,
  rest: Omit<AuditEvent, 'action' | 'outcome'> = {},
): Promise<void> {
  return recordAudit({ action, outcome: 'rate_limited', ...rest });
}
