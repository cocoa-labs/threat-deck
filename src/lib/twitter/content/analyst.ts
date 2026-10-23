/**
 * Phase 9.4 — Senior Technical Analyst mode generator.
 *
 * `generateWeeklyDeepDive` runs every Monday at 14:00 UTC via the Phase 9.5
 * cron. Picks the week's apex AI-cyber story, enriches it with MITRE TTPs
 * and IOCs from the AEGIS join graph, and stages an 8-10 tweet SITREP
 * thread for `the configured X account`.
 *
 * Distinct from `anchor` mode: deeper analytical voice, named technique IDs,
 * Bottom-Line-Up-Front masthead followed by data summary → key findings →
 * MITRE mapping → closing.
 */

import { composeThread } from './compose-thread';
import { fetchApexWeeklyStory } from './data';
import { ANALYST_SYSTEM } from './prompts';
import { stageDraft } from './staging';
import type { GeneratorResult } from './types';

const DEEPDIVE_WINDOW_DAYS = 7;
const DEEPDIVE_MAX_TOKENS = 1600;

/**
 * Compose, validate, and stage the Monday weekly deep-dive thread.
 */
export async function generateWeeklyDeepDive(opts?: {
  /** Override the default 7-day window — useful for tests. */
  sinceDays?: number;
  createdBy?: string;
}): Promise<GeneratorResult> {
  const sinceDays = opts?.sinceDays ?? DEEPDIVE_WINDOW_DAYS;
  const createdBy = opts?.createdBy ?? 'cron:weekly_deepdive';

  const context = await fetchApexWeeklyStory({ sinceDays });
  if (!context) {
    return {
      ok: false,
      reason: 'no_qualifying_items',
      details: `no apex AI-cyber story in last ${sinceDays} days`,
    };
  }

  const { story, ttps, iocs, campaigns } = context;

  const userPrompt = [
    `Generate the weekly AI Cyber Wire deep-dive thread for the configured X account.`,
    `Apex story for the week of ${weekOf(new Date())}.`,
    '',
    `--- APEX STORY ---`,
    `Headline: ${story.headline}`,
    story.cveId ? `CVE: ${story.cveId}` : null,
    `Severity: ${story.severity.toUpperCase()}`,
    `AI relevance: ${story.aiRelevance.toFixed(2)}`,
    story.summary ? `Summary: ${story.summary.slice(0, 1500)}` : null,
    `Source URL: ${story.sourceUrl}`,
    '',
    `--- MITRE TTPs OBSERVED (related actors) ---`,
    ttps.length > 0 ? ttps.join(', ') : '(none on record)',
    '',
    `--- IOCs (related to apex CVE) ---`,
    iocs.length > 0 ? iocs.join('\n') : '(none on record)',
    '',
    `--- RELATED CAMPAIGNS ---`,
    campaigns.length > 0 ? campaigns.join(', ') : '(none on record)',
    '',
    `Compose an 8-10 tweet SITREP thread following the structure in the system prompt. Cite the MITRE technique IDs and IOC values where the data supports it.`,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await composeThread({
    systemPrompt: ANALYST_SYSTEM,
    contextBlock: userPrompt,
    shape: 'thread',
    maxTokens: DEEPDIVE_MAX_TOKENS,
    draftType: 'weekly_deepdive',
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, details: result.details };
  }
  const draft = result.draft;

  const stage = await stageDraft({
    channel: 'twitter',
    draftType: 'weekly_deepdive',
    agentMode: 'analyst',
    headline: `Weekly deep-dive — ${story.headline.slice(0, 180)}`,
    previewText: draft.tweets[0]?.text ?? story.headline,
    draftPayload: draft,
    aiRelevance: story.aiRelevance,
    severity: story.severity as never,
    sourceAlertId: story.sourceAlertId || undefined,
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

function weekOf(d: Date): string {
  // ISO-week-style label "MMM D, YYYY". Good enough for masthead context.
  return d.toISOString().slice(0, 10);
}
