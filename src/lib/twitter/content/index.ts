/**
 * Phase 9.4 — Twitter content generators public surface.
 *
 * Callers (cron routes, activation watcher, ad-hoc tooling) import the four
 * `generate*` functions and `stageDraft` from here. Internal modules
 * (`data.ts`, `llm.ts`, `prompts.ts`) stay private — if a future surface
 * needs them, that's a signal to lift those into shared utilities.
 *
 *   src/app/api/twitter/daily-brief/route.ts        → generateDailyBrief
 *   src/app/api/twitter/breaking/route.ts           → generateBreakingTweet
 *   src/app/api/twitter/weekly-deepdive/route.ts    → generateWeeklyDeepDive
 *   src/app/api/twitter/patch-thread/route.ts (v1.5)→ generatePatchThread
 *   src/lib/agent/activation.ts                     → generateBreakingTweet (KEV hook)
 */

export { generateWeeklyDeepDive } from './analyst';
export { generateBreakingTweet, generateDailyBrief } from './anchor';
export {
  buildXThreadDirective,
  type ComposeThreadInput,
  type ComposeThreadResult,
  composeThread,
  type XPostShape,
} from './compose-thread';
export { generatePatchThread } from './fix-architect';
export { validateEmailDraft, validateThreadDraft } from './format';
export { generateWeeklyPredictionsThread } from './predictions';
// The three per-mode cyber personas power the autonomous Cyber Wire cron.
// GENERAL_POST_SYSTEM powers the in-app post_to_x tool + manual button — it
// posts ANY brief (cyber-led, but markets/macro/mixed too) and never refuses.
export {
  ANALYST_SYSTEM,
  ANCHOR_SYSTEM,
  FIX_ARCHITECT_SYSTEM,
  GENERAL_POST_SYSTEM,
} from './prompts';
export { type StageDraftInput, type StageDraftResult, stageDraft } from './staging';
export type {
  DraftTweet,
  EmailDraft,
  GeneratorFailReason,
  GeneratorResult,
  ThreadDraft,
} from './types';
