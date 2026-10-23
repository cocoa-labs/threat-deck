/**
 * Phase 9 — Outbound draft staging: single source of truth for enum literals.
 *
 * The SQL CHECK constraints in `migrations/008_outbound_drafts.sql` MUST stay
 * in sync with these tuples. If a value is added here, add it to the CHECK
 * via a NEW migration — DO NOT edit the existing migration after it has been
 * applied.
 *
 * Pattern: derive the TS union types from the const tuple via
 * `(typeof TUPLE)[number]` so adding a value here adds it to the union
 * automatically.
 */

/** Lifecycle states a draft passes through before / after publish. */
export const DRAFT_STATUSES = [
  'drafted', // agent or cron just wrote this row; awaiting human review
  'edited', // human reviewer modified payload; still pending decision
  'approved', // human marked OK; publish dispatcher will run on next sweep
  'rejected', // human declined with a reason; will not publish
  'published', // dispatcher posted to the channel; outbound_log_id is set
  'superseded', // a newer draft replaced this one (e.g., re-staged daily brief)
] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Outbound channels the draft can target. */
export const DRAFT_CHANNELS = ['twitter', 'email', 'rss'] as const;
export type DraftChannel = (typeof DRAFT_CHANNELS)[number];

/** Kinds of draft content; drives generator selection + UI grouping. */
export const DRAFT_TYPES = [
  'daily_brief', // anchor mode, 5–7 tweet thread, fired daily at 12:00 UTC
  'breaking', // anchor mode, single tweet on critical KEV + ai_relevance>0.6
  'weekly_deepdive', // analyst mode, 8–10 tweet Monday-only SITREP thread
  'patch_thread', // fix_architect mode, per-CVE remediation playbook thread
  'predictions_thread', // analyst mode (Phase 11), Monday weekly predictions
  'agent_post', // in-app post_to_x tool: operator-initiated thread/single (migration 016)
] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

/** Three-mode agent posture (matches agent/SOUL.md + prompts.ts). */
export const AGENT_MODES = ['anchor', 'analyst', 'fix_architect'] as const;
export type AgentMode = (typeof AGENT_MODES)[number];

/** Severity values copied from source alert for queue sorting. */
export const DRAFT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type DraftSeverity = (typeof DRAFT_SEVERITIES)[number];

/** AI-relevance category enum (matches aegis_news_enrichments CHECK). */
export const AI_CATEGORIES = [
  'vendor_incident',
  'defensive',
  'offensive',
  'agentic_safety',
  'unrelated',
] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

/** Scorer model used for the persisted enrichment. */
export const AI_RELEVANCE_MODELS = ['keywords', 'haiku-4-5'] as const;
export type AiRelevanceModel = (typeof AI_RELEVANCE_MODELS)[number];

/** Type guards — useful in route handlers when validating untrusted input. */
export function isDraftStatus(v: unknown): v is DraftStatus {
  return typeof v === 'string' && (DRAFT_STATUSES as readonly string[]).includes(v);
}
export function isDraftChannel(v: unknown): v is DraftChannel {
  return typeof v === 'string' && (DRAFT_CHANNELS as readonly string[]).includes(v);
}
export function isDraftType(v: unknown): v is DraftType {
  return typeof v === 'string' && (DRAFT_TYPES as readonly string[]).includes(v);
}
export function isAgentMode(v: unknown): v is AgentMode {
  return typeof v === 'string' && (AGENT_MODES as readonly string[]).includes(v);
}
export function isDraftSeverity(v: unknown): v is DraftSeverity {
  return typeof v === 'string' && (DRAFT_SEVERITIES as readonly string[]).includes(v);
}
