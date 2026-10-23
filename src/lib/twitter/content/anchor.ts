/**
 * Phase 9.4 — Anchor mode generators.
 *
 * `generateDailyBrief` runs daily via the Phase 9.5 cron at 12:00 UTC.
 * Produces a 5-7 tweet thread for `the configured X account`:
 *   T1   — masthead framing today's AI-cyber landscape
 *   T2-T6 — top AI-cyber stories of the last 24h, sorted by
 *           `aiRelevance × severityWeight(severity)`
 *   TN   — CTA tweet linking to /feed/cyber-wire with thread numbering
 *
 * `generateBreakingTweet` runs from `src/lib/agent/activation.ts` when a
 * `cve.kev_added` event fires AND the alert's `ai_relevance > 0.6`. Single
 * tweet, no thread.
 *
 * Both route composition through the shared `composeThread` spine (generate →
 * validate → optional count-fix retry). X is long-form now, so the old
 * 280-char length-rescue is gone — there is no per-tweet character budget to
 * overflow.
 *
 * Failure modes are surfaced as `GeneratorResult.ok=false` with a stable
 * reason code; the cron / activation watcher logs and moves on.
 */

import { composeThread } from './compose-thread';
import { fetchBreakingContext, fetchDailyBriefTopStories } from './data';
import { ANCHOR_SYSTEM } from './prompts';
import { stageDraft } from './staging';
import type { GeneratorResult } from './types';

const DAILY_BRIEF_WINDOW_HOURS = 24;
const DAILY_BRIEF_MAX_STORIES = 5;
const DAILY_BRIEF_MIN_STORIES = 3;
// Long-form bump: with the 280 cap gone, story tweets can run longer, so we
// give the JSON envelope more headroom to avoid a max_tokens truncation that
// would surface as llm_invalid_output. 1800 covers a 7-tweet long-form thread.
const DAILY_BRIEF_MAX_TOKENS = 1800;
// Breaking single-tweet — long-form headroom over the prior 320.
const BREAKING_MAX_TOKENS = 500;

/**
 * Compose, validate, and stage the daily morning brief thread.
 */
export async function generateDailyBrief(opts?: {
  /** Override the default 24h window — useful for tests. */
  sinceHours?: number;
  /** Who triggered this generation — defaults to the production cron string. */
  createdBy?: string;
}): Promise<GeneratorResult> {
  const sinceHours = opts?.sinceHours ?? DAILY_BRIEF_WINDOW_HOURS;
  const createdBy = opts?.createdBy ?? 'cron:daily_brief';

  const stories = await fetchDailyBriefTopStories({
    sinceHours,
    maxStories: DAILY_BRIEF_MAX_STORIES,
  });
  if (stories.length < DAILY_BRIEF_MIN_STORIES) {
    return {
      ok: false,
      reason: 'no_qualifying_items',
      details: `${stories.length} qualifying stories in ${sinceHours}h window (need ≥ ${DAILY_BRIEF_MIN_STORIES})`,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = [
    `Generate today's AI Cyber Wire daily brief thread for the configured X account.`,
    `Today's date: ${today}`,
    `Stories in priority order (already sorted by ai_relevance × severity_weight):`,
    '',
    ...stories.map((s, i) =>
      [
        `--- Story ${i + 1} ---`,
        `Headline: ${s.headline}`,
        s.cveId ? `CVE: ${s.cveId}` : null,
        `Severity: ${s.severity.toUpperCase()}`,
        `AI relevance: ${s.aiRelevance.toFixed(2)}`,
        s.summary ? `Summary: ${s.summary.slice(0, 600)}` : null,
        `Source URL: ${s.sourceUrl}`,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    '',
    `Compose a thread of ${stories.length + 2} tweets: T1 masthead, T2-T${stories.length + 1} stories in priority order, T${stories.length + 2} CTA. Output STRICT JSON per the system prompt.`,
  ].join('\n');

  const result = await composeThread({
    systemPrompt: ANCHOR_SYSTEM,
    contextBlock: userPrompt,
    shape: 'thread',
    maxTokens: DAILY_BRIEF_MAX_TOKENS,
    draftType: 'daily_brief',
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, details: result.details };
  }
  const draft = result.draft;

  // Severity / aiRelevance for the queue row are derived from the apex story —
  // it determines how urgently the human reviewer should pick it up.
  const apex = stories[0]!;
  const stage = await stageDraft({
    channel: 'twitter',
    draftType: 'daily_brief',
    agentMode: 'anchor',
    headline: `Daily brief — ${stories.length} AI-cyber stories (${today})`,
    previewText: draft.tweets[0]?.text ?? `Daily brief for ${today}`,
    draftPayload: draft,
    aiRelevance: apex.aiRelevance,
    severity: apex.severity as never, // SQL CHECK catches if it's not in the enum
    sourceAlertId: apex.sourceAlertId,
    createdBy,
  });
  if (!stage.ok) {
    return { ok: false, reason: 'persist_failed', details: stage.error };
  }

  return {
    ok: true,
    draftId: stage.draftId,
    tweetCount: draft.tweets.length,
    preview: (draft.tweets[0]?.text ?? '').slice(0, 120),
  };
}

/**
 * Compose, validate, and stage a single breaking tweet for a specific
 * pipeline alert. Called from `activation.ts` on `cve.kev_added` when the
 * source alert's `ai_relevance > 0.6`.
 */
export async function generateBreakingTweet(opts: {
  sourceAlertId: number;
  createdBy?: string;
}): Promise<GeneratorResult> {
  const createdBy = opts.createdBy ?? 'agent';

  const story = await fetchBreakingContext({ sourceAlertId: opts.sourceAlertId });
  if (!story) {
    return {
      ok: false,
      reason: 'no_qualifying_items',
      details: `no alert with id=${opts.sourceAlertId}`,
    };
  }

  const userPrompt = [
    `Generate a single breaking tweet for the configured X account.`,
    `Headline: ${story.headline}`,
    story.cveId ? `CVE: ${story.cveId}` : null,
    `Severity: ${story.severity.toUpperCase()}`,
    `AI relevance: ${story.aiRelevance.toFixed(2)}`,
    story.summary ? `Summary: ${story.summary.slice(0, 600)}` : null,
    `Source URL: ${story.sourceUrl}`,
    '',
    'Output STRICT JSON with a single tweet object in the tweets array.',
  ]
    .filter(Boolean)
    .join('\n');

  // shape:'single' makes composeThread enforce exactly one tweet (with one
  // restating retry) — replaces the old explicit length check + rescue.
  const result = await composeThread({
    systemPrompt: ANCHOR_SYSTEM,
    contextBlock: userPrompt,
    shape: 'single',
    maxTokens: BREAKING_MAX_TOKENS,
    draftType: 'breaking',
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, details: result.details };
  }
  const draft = result.draft;

  const stage = await stageDraft({
    channel: 'twitter',
    draftType: 'breaking',
    agentMode: 'anchor',
    headline: `Breaking: ${story.headline.slice(0, 180)}`,
    previewText: draft.tweets[0]?.text ?? story.headline,
    draftPayload: draft,
    aiRelevance: story.aiRelevance,
    severity: story.severity as never,
    sourceAlertId: story.sourceAlertId,
    createdBy,
  });
  if (!stage.ok) {
    return { ok: false, reason: 'persist_failed', details: stage.error };
  }

  return {
    ok: true,
    draftId: stage.draftId,
    tweetCount: 1,
    preview: (draft.tweets[0]?.text ?? '').slice(0, 120),
  };
}
