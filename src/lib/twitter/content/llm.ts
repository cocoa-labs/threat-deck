import { budgetedAIFetch } from '@/lib/security/budget';
/**
 * Phase 9.4 — Anthropic SDK wrapper for Twitter content generators.
 *
 * One call shape used by all four generators. Mirrors the resilience
 * pattern from `src/lib/ai-relevance/haiku.ts` (AbortController timeout,
 * tolerant JSON extractor via the shared util in `src/lib/utils/tolerant-json.ts`,
 * fail-soft return null on any failure path).
 *
 * Model: `claude-sonnet-4-6` per the locked Phase 9.4 decision (brand voice
 * is load-bearing — Haiku's $/run savings is marginal at our volume).
 *
 * The wrapper does NOT validate the returned ThreadDraft's semantics
 * (length per tweet, hashtag on T1) — that is `validateThreadDraft()`'s
 * job in `format.ts`. The wrapper guarantees only that the response was
 * parsed into the expected shape: `{ tweets: [{ text, link? }, ...], canonicalHashtag }`.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { extractJsonObject } from '@/lib/utils/tolerant-json';
import { DEFAULT_HASHTAG } from './format';
import type { DraftTweet, ThreadDraft } from './types';

const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 30_000;

export interface GenerateThreadInput {
  systemPrompt: string;
  userPrompt: string;
  /** Bound on output tokens. Anchor briefs ≈ 800; deepdives ≈ 1600; etc. */
  maxTokens: number;
  /** Used for audit-log targetId on parse failures so we can correlate. */
  draftType: string;
}

export type GenerateThreadResult =
  | { ok: true; draft: ThreadDraft; rawJson: string }
  | { ok: false; reason: 'llm_failed' | 'llm_invalid_output'; details: string };

/**
 * Produce a ThreadDraft from Anthropic. Fail-soft: any failure returns a
 * structured `{ ok: false }` rather than throwing. Callers can decide
 * whether to retry or surface to the user.
 */
export async function generateThread(input: GenerateThreadInput): Promise<GenerateThreadResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: 'llm_failed', details: 'ANTHROPIC_API_KEY not configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let rawText: string;
  try {
    const client = new Anthropic({ fetch: budgetedAIFetch, maxRetries: 0, timeout: 120_000 });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: input.maxTokens,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.userPrompt }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const textBlock = response.content.find((b) => b.type === 'text');
    rawText = textBlock?.text ?? '';
    if (!rawText.trim()) {
      void auditFailure(input.draftType, 'empty response');
      return { ok: false, reason: 'llm_invalid_output', details: 'empty response' };
    }
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    void auditFailure(input.draftType, message);
    return { ok: false, reason: 'llm_failed', details: message };
  }

  const parsed = parseThreadJson(rawText);
  if (!parsed) {
    void auditFailure(input.draftType, `unparseable JSON: ${rawText.slice(0, 240)}`);
    return { ok: false, reason: 'llm_invalid_output', details: 'failed to parse ThreadDraft JSON' };
  }

  return { ok: true, draft: parsed, rawJson: rawText };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Parse the LLM response into a ThreadDraft. Uses the shared tolerant
 * extractor for fence/prose tolerance, then shape-validates the result.
 * Returns null on any structural mismatch — the caller treats null as
 * `llm_invalid_output`.
 */
function parseThreadJson(raw: string): ThreadDraft | null {
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;

  const tweetsRaw = o.tweets;
  if (!Array.isArray(tweetsRaw) || tweetsRaw.length === 0) return null;

  const tweets: DraftTweet[] = [];
  for (const t of tweetsRaw) {
    if (!t || typeof t !== 'object') return null;
    const tt = t as Record<string, unknown>;
    if (typeof tt.text !== 'string' || tt.text.trim().length === 0) return null;
    const draft: DraftTweet = { text: tt.text };
    if (typeof tt.link === 'string' && tt.link.startsWith('http')) {
      draft.link = tt.link;
    }
    tweets.push(draft);
  }

  const hashtag =
    typeof o.canonicalHashtag === 'string' && o.canonicalHashtag.startsWith('#')
      ? o.canonicalHashtag
      : DEFAULT_HASHTAG;

  return { tweets, canonicalHashtag: hashtag };
}

async function auditFailure(draftType: string, details: string): Promise<void> {
  await recordAudit({
    action: AUDIT_ACTIONS.DATA_HAIKU_PARSE_FAILED,
    outcome: 'failure',
    targetKind: 'twitter_draft',
    targetId: draftType,
    errorMessage: details,
    details: { stage: 'twitter_content_llm', model: MODEL },
  });
}
