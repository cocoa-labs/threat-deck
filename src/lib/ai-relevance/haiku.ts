import { budgetedAIFetch } from '@/lib/security/budget';
/**
 * AI-cyber relevance — Haiku tiebreaker tier.
 *
 * Called from scorer.ts only when the keyword baseline lands in the gray zone
 * (0.4-0.7). One Claude Haiku call per gray-zone item, ~$0.005/call. Fail-soft:
 * on any error (network, parse, rate-limit, malformed JSON), returns null and
 * the orchestrator falls back to the keyword score with the original band.
 *
 * Pattern mirrored from: src/app/api/data/captions/summarize/route.ts:76-89.
 * Same model identifier, same Anthropic SDK shape, similar JSON-discipline
 * approach but with stricter shape validation since we consume the result
 * structurally (relevance numeric, category from a closed enum).
 */

import Anthropic from '@anthropic-ai/sdk';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { AI_CATEGORIES, type AiCategory } from '@/lib/outbound/constants';
import { extractJsonObject } from '@/lib/utils/tolerant-json';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 200;
const TIMEOUT_MS = 8_000;

export interface HaikuScoreInput {
  url: string;
  title: string;
  summary?: string;
}

export interface HaikuScoreResult {
  /** Model-assigned relevance in [0, 1]. */
  relevance: number;
  /** Closed-set category — matches the SQL aegis_news_enrichments CHECK. */
  category: AiCategory;
  /** Short free-text justification (≤ 2 sentences). Stored for audit. */
  rationale: string;
  /** Raw model response, kept for debugging — never displayed to end users. */
  rawJson: string;
}

const SYSTEM_PROMPT = `You are an AI-cybersecurity relevance scorer for Cocoa AI Threat Deck, a specialized intelligence platform covering AI-cyber threats.

Score a news item's relevance to AI-cyber on a 0.0-1.0 scale and classify into one of these categories:

- vendor_incident: a breach, leak, or security incident at an AI vendor (OpenAI, Anthropic, Google Gemini, Microsoft Copilot) or AI-security vendor (Lakera, HiddenLayer, Protect AI, Robust Intelligence).
- defensive: defensive AI-cyber topics — prompt injection mitigations, LLM guardrails, jailbreak defenses, OWASP LLM Top 10, MITRE ATLAS framework, RAG poisoning research, AI red-teaming.
- offensive: offensive AI threats — WormGPT/FraudGPT/GhostGPT, AI-generated phishing, deepfakes (voice/video for fraud), autonomous AI attackers, agentic malware.
- agentic_safety: agentic-system safety — MCP server exploits, tool-use abuse, agent sandbox escapes, agentic workflow security incidents.
- unrelated: general cyber news without AI angle, generic AI product launches without security angle, unrelated content.

Scoring rubric (be strict — a story has to be genuinely AI-cyber to score ≥ 0.7):
- 0.85-1.0: directly about an AI-cyber threat, mitigation, or incident
- 0.55-0.85: AI security topic adjacent to a core category (e.g., MLOps risk analysis)
- 0.30-0.55: mentions AI and security but core topic is something else (e.g., a CVE in a non-AI product, mentioned alongside an AI vendor)
- 0.0-0.30: not AI-cyber relevant (general business news, non-AI cyber, etc.)

Respond with STRICT JSON only — no preamble, no code fences, no trailing prose. Schema:
{"relevance": <number in 0..1>, "category": "<one of: vendor_incident | defensive | offensive | agentic_safety | unrelated>", "rationale": "<≤2 sentences explaining the score>"}`;

/**
 * Score one item via Haiku. Returns null on ANY failure — the orchestrator
 * falls back to the keyword score in that case. Failures are audit-logged
 * with the `data.haiku_parse_failed` action so we can monitor drift.
 */
export async function scoreWithHaiku(item: HaikuScoreInput): Promise<HaikuScoreResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const userPrompt = buildUserPrompt(item);
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
    const parsed = parseHaikuJson(rawText);
    if (!parsed) {
      void recordAudit({
        action: AUDIT_ACTIONS.DATA_HAIKU_PARSE_FAILED,
        outcome: 'failure',
        targetKind: 'news_item',
        targetId: item.url,
        details: { rawText: rawText.slice(0, 500), title: item.title.slice(0, 200) },
      });
      return null;
    }

    return { ...parsed, rawJson: rawText };
  } catch (err) {
    clearTimeout(timeout);
    void recordAudit({
      action: AUDIT_ACTIONS.DATA_HAIKU_PARSE_FAILED,
      outcome: 'failure',
      targetKind: 'news_item',
      targetId: item.url,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function buildUserPrompt(item: HaikuScoreInput): string {
  const summary = item.summary?.trim() ?? '';
  return [
    `Title: ${item.title}`,
    summary ? `Summary: ${summary.slice(0, 1_200)}` : null,
    `URL: ${item.url}`,
  ]
    .filter(Boolean)
    .join('\n');
}

interface ParsedHaiku {
  relevance: number;
  category: AiCategory;
  rationale: string;
}

/**
 * Parse a Haiku JSON response into the typed shape. Delegates fence /
 * embedded-JSON tolerance to the shared `extractJsonObject` util; this
 * function's job is shape validation only.
 */
function parseHaikuJson(raw: string): ParsedHaiku | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  const relevance = obj.relevance;
  const category = obj.category;
  const rationale = obj.rationale;

  if (typeof relevance !== 'number' || Number.isNaN(relevance) || relevance < 0 || relevance > 1) {
    return null;
  }
  if (typeof category !== 'string' || !(AI_CATEGORIES as readonly string[]).includes(category)) {
    return null;
  }
  if (typeof rationale !== 'string' || rationale.length === 0) {
    return null;
  }

  return {
    relevance,
    category: category as AiCategory,
    rationale: rationale.slice(0, 500),
  };
}
