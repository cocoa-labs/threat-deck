import { budgetedAIFetch } from '@/lib/security/budget';
/**
 * Phase 10.2 — Pivot Haiku augmentation tier.
 *
 * Fired ONLY for high-relevance entities — the gate lives in the route
 * (10.1), this module just runs the Haiku call. The Haiku tier appends a
 * SINGLE additional pivot to the templated baseline; the route trims the
 * lowest-rank template before returning so the displayed total stays at 3.
 *
 * Resilience pattern mirrors src/lib/ai-relevance/haiku.ts verbatim:
 *   - AbortController with hard 1500ms timeout (PRD §10.1)
 *   - Tolerant JSON parse via extractJsonObject (code-fence safe)
 *   - Strict shape validation on the parsed object
 *   - Fail-soft return null on ANY error — the route falls back to the
 *     templated baseline alone
 *   - DATA_HAIKU_PARSE_FAILED audit on parse / shape failure
 *
 * Cost note: at the 1500ms timeout + ~200 max_tokens, one call is roughly
 * $0.005. With the rate-limit of 5/min keyed on `haiku_pivots` (Phase 10.3)
 * and a 1h cache on the route, a typical day hits 30-50 Haiku calls. About
 * $0.20/day.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { PivotEntityRow, PivotKind, PivotSuggestion } from '@/lib/aegis/pivot-templates';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { extractJsonObject } from '@/lib/utils/tolerant-json';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 200;
const TIMEOUT_MS = 1_500;

const SYSTEM_PROMPT = `You are the co-investigator on Cocoa AI Threat Deck. Given an AEGIS entity (threat actor, CVE, victim, or campaign) and a list of pivot suggestions an analyst has already been offered, propose ONE additional pivot the analyst should run NEXT.

Rules:
- Output a SINGLE pivot, distinct from the existing ones.
- Label must be ≤ 60 chars, a concise verb phrase (start with a verb). No "deep analysis", no "investigate the …". Be sharp.
- Prefill prompt is the literal text that will pre-fill the agent input. It should be a complete instruction in 1–2 sentences. No greeting, no preamble.
- contextNeeded lists the entity fields your prompt depends on (snake_case keys present on the entity row).
- Pivots should chain — they should follow naturally from what an analyst would ask AFTER seeing the existing suggestions. Lateral moves are good (different angle), redundant moves are not.

Output STRICT JSON only — no preamble, no code fences:
{"label": "<≤60 char concise verb phrase>", "prefillPrompt": "<1-2 sentence instruction>", "contextNeeded": ["<field1>", "<field2>"]}`;

/**
 * Generate ONE additional pivot for a high-relevance entity. Returns null
 * on any failure — the caller MUST fall back to its templated baseline.
 *
 * The `existingTemplates` arg is fed into the user prompt so Haiku knows
 * what's already been offered and produces a novel pivot rather than a
 * paraphrase.
 */
export async function generateHaikuPivot(
  entity: PivotEntityRow,
  existingTemplates: readonly PivotSuggestion[],
): Promise<PivotSuggestion | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const userPrompt = buildUserPrompt(entity, existingTemplates);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const client = new Anthropic({ fetch: budgetedAIFetch, maxRetries: 0, timeout: 120_000 });
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    const textBlock = response.content.find((b) => b.type === 'text');
    const rawText = textBlock?.text ?? '';
    const parsed = parseHaikuPivotJson(rawText);
    if (!parsed) {
      void recordAudit({
        action: AUDIT_ACTIONS.DATA_HAIKU_PARSE_FAILED,
        outcome: 'failure',
        targetKind: 'pivot_suggestion',
        targetId: entityIdOf(entity),
        details: { rawText: rawText.slice(0, 500), kind: entity.kind },
      });
      return null;
    }

    return {
      label: parsed.label.slice(0, 60),
      prefillPrompt: parsed.prefillPrompt,
      contextNeeded: parsed.contextNeeded,
      // Caller assigns final rank — appended at index = existingTemplates.length
      // and then the route may trim. We seed rank to a sentinel.
      rank: existingTemplates.length,
      source: 'haiku',
    };
  } catch (err) {
    clearTimeout(timeout);
    void recordAudit({
      action: AUDIT_ACTIONS.DATA_HAIKU_PARSE_FAILED,
      outcome: 'failure',
      targetKind: 'pivot_suggestion',
      targetId: entityIdOf(entity),
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function entityIdOf(entity: PivotEntityRow): string {
  switch (entity.kind) {
    case 'threat_actor':
      return entity.data.actor_id;
    case 'cve':
      return entity.data.cve_id;
    case 'victim':
      return String(entity.data.id);
    case 'campaign':
      return String(entity.data.id);
  }
}

function buildUserPrompt(
  entity: PivotEntityRow,
  existingTemplates: readonly PivotSuggestion[],
): string {
  const existing = existingTemplates.map((t) => `- ${t.label}`).join('\n') || '(none)';
  return [
    `Entity kind: ${formatKind(entity.kind)}`,
    `Entity data: ${JSON.stringify(entity.data)}`,
    `Pivots already offered:`,
    existing,
    `Now propose ONE additional pivot.`,
  ].join('\n');
}

function formatKind(kind: PivotKind): string {
  return kind === 'threat_actor'
    ? 'Threat actor'
    : kind === 'cve'
      ? 'CVE'
      : kind === 'victim'
        ? 'Victim (compromised org)'
        : 'Campaign';
}

interface ParsedHaikuPivot {
  label: string;
  prefillPrompt: string;
  contextNeeded: string[];
}

/**
 * Parse a Haiku pivot JSON response into a typed shape. Delegates fence /
 * embedded-JSON tolerance to the shared util; this function only validates
 * the field shapes. Returns null on any structural failure.
 */
function parseHaikuPivotJson(raw: string): ParsedHaikuPivot | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const label = obj.label;
  const prefillPrompt = obj.prefillPrompt;
  const contextNeeded = obj.contextNeeded;

  if (typeof label !== 'string' || label.length === 0 || label.length > 200) return null;
  if (typeof prefillPrompt !== 'string' || prefillPrompt.length === 0) return null;
  if (!Array.isArray(contextNeeded) || !contextNeeded.every((c) => typeof c === 'string')) {
    return null;
  }

  // Per rule #26 — reject "deep analysis" verbose framings.
  if (/deep\s+analysis|deeply\s+analyze/i.test(label)) return null;

  return {
    label,
    prefillPrompt,
    contextNeeded: contextNeeded as string[],
  };
}
