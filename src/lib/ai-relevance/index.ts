/**
 * Phase 9.2 — AI-cyber relevance scoring.
 *
 * Public surface for the scoring pipeline. Callers should import from here,
 * not from the internal module files, so we can reshape internals (e.g., add
 * a v2 scorer behind a feature flag) without churning consumers.
 *
 * Typical use:
 *   ```ts
 *   import { scoreItem, scoreItems } from '@/lib/ai-relevance';
 *   const result = await scoreItem({ url, title, summary });
 *   // result.aiRelevance, result.aiCategory, result.modelUsed, ...
 *   ```
 */

export { type HaikuScoreInput, type HaikuScoreResult, scoreWithHaiku } from './haiku';
export { type KeywordScoreResult, scoreByKeywords } from './keywords';
export { type EnrichmentRow, getEnrichment, upsertEnrichment } from './persist';
export { type ScoreInput, type ScoreResult, scoreItem, scoreItems } from './scorer';
