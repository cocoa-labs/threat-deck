/**
 * Phase 9.4 — Fix Architect mode generator.
 *
 * `generatePatchThread` composes a per-CVE remediation playbook thread for
 * `the configured X account`. Pulled when an AI-stack CVE patch drops (manual trigger v1
 * per the plan — `cve.patch_released` activation hook is a Phase 9.5+
 * follow-up). The reader is an engineer who needs concrete, vendor-specific
 * actions in the next hour.
 *
 * Voice contract: numbered steps, concrete artifacts (patch versions,
 * vendor advisory IDs, MITRE M-IDs), no generic advice.
 */

import { composeThread } from './compose-thread';
import { fetchPatchContext } from './data';
import { FIX_ARCHITECT_SYSTEM } from './prompts';
import { stageDraft } from './staging';
import type { GeneratorResult } from './types';

const PATCH_THREAD_MAX_TOKENS = 1200;

/**
 * Compose, validate, and stage a per-CVE remediation playbook thread.
 */
export async function generatePatchThread(opts: {
  cveId: string;
  createdBy?: string;
}): Promise<GeneratorResult> {
  const createdBy = opts.createdBy ?? 'agent';
  const cveId = opts.cveId.toUpperCase();

  const context = await fetchPatchContext({ cveId });
  if (!context) {
    return {
      ok: false,
      reason: 'no_qualifying_items',
      details: `no aegis_cves row for ${cveId}`,
    };
  }

  const { story, affectedProducts, remediations } = context;

  if (remediations.length === 0) {
    return {
      ok: false,
      reason: 'no_qualifying_items',
      details: `no remediations on record for ${cveId} — patch thread would have no concrete artifacts`,
    };
  }

  const userPrompt = [
    `Generate a per-CVE remediation playbook thread for the configured X account.`,
    '',
    `--- CVE ---`,
    `CVE: ${cveId}`,
    `Severity: ${story.severity.toUpperCase()}`,
    `Headline: ${story.headline}`,
    story.summary ? `Summary: ${story.summary.slice(0, 1200)}` : null,
    `Source URL: ${story.sourceUrl}`,
    '',
    `--- AFFECTED PRODUCTS ---`,
    affectedProducts.length > 0
      ? affectedProducts.map((p) => `- ${p}`).join('\n')
      : '(none on record)',
    '',
    `--- VENDOR REMEDIATIONS ---`,
    remediations
      .map(
        (r) =>
          `- Vendor: ${r.vendor}\n  Patch version: ${r.patchVersion}\n  Released: ${r.releasedAt || 'unspecified'}${
            r.advisoryUrl ? `\n  Advisory: ${r.advisoryUrl}` : ''
          }`,
      )
      .join('\n'),
    '',
    `Compose a 6-8 tweet numbered playbook following the structure in the system prompt. Each step cites a concrete vendor patch version, advisory ID, or MITRE M-ID. No generic advice ("update your software", "patch promptly") — every step is actionable today.`,
  ]
    .filter(Boolean)
    .join('\n');

  const result = await composeThread({
    systemPrompt: FIX_ARCHITECT_SYSTEM,
    contextBlock: userPrompt,
    shape: 'thread',
    maxTokens: PATCH_THREAD_MAX_TOKENS,
    draftType: 'patch_thread',
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, details: result.details };
  }
  const draft = result.draft;

  const stage = await stageDraft({
    channel: 'twitter',
    draftType: 'patch_thread',
    agentMode: 'fix_architect',
    headline: `Patch playbook — ${cveId}`,
    previewText: draft.tweets[0]?.text ?? `Patch playbook for ${cveId}`,
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
