/**
 * AI-cyber relevance — keyword baseline tier.
 *
 * Pure, no dependencies. Given a NewsItem-shaped input, returns a deterministic
 * score in [0, 1] plus the best-matching subcategory and the evidence (which
 * terms fired). Designed to be the fast confidence tier that short-circuits
 * the more expensive Haiku tiebreaker (Phase 9.2) for clearly-yes and
 * clearly-no items.
 *
 * Scoring model:
 *
 *   1. Walk STRONG_TERMS. If any hit, lock to 0.90 with that category. These
 *      are unambiguous AI-cyber phrases (WormGPT, "prompt injection", MITRE
 *      ATLAS, OWASP LLM Top 10). A single hit is enough.
 *
 *   2. Walk per-subcategory term banks. Count distinct subcategories hit.
 *        2+ subcategories  →  0.85 (multi-signal confidence)
 *        1 subcategory     →  0.55 (gray zone — Haiku breaks the tie)
 *        0 subcategories   →  no positive signal
 *
 *   3. Walk NEGATIVE_TERMS (earnings, IPO, sports, etc).
 *        - If positive_score > 0: ignore negatives (positive wins).
 *        - If positive_score = 0 AND any negative hit: 0.05 (confident no).
 *        - Otherwise: 0.20 (cyber-only or AI-only mention without core signal).
 *
 * Calibration target: the gray zone (0.4-0.7) sees ~10-20% of all items;
 * Haiku adjudicates those at ~$0.005 each. The confident-yes (≥0.7) and
 * confident-no (≤0.3) bands skip Haiku entirely. See scorer.ts for the
 * orchestration.
 */

import type { AiCategory } from '@/lib/outbound/constants';

// ─── Term banks ──────────────────────────────────────────────────────────────

/**
 * Single-hit lock terms. Any one of these in title or summary means we're
 * looking at AI-cyber content with high confidence; no need to count
 * subcategory crossings. Each STRONG_TERM declares its canonical category
 * so we don't have to guess.
 */
const STRONG_TERMS: ReadonlyArray<{ pattern: RegExp; category: AiCategory }> = [
  // Offensive — named malicious LLMs and AI-attack tooling
  { pattern: /\bWormGPT\b/i, category: 'offensive' },
  { pattern: /\bFraudGPT\b/i, category: 'offensive' },
  { pattern: /\bGhostGPT\b/i, category: 'offensive' },
  { pattern: /\bDarkBARD\b/i, category: 'offensive' },
  { pattern: /\bAI[- ]powered\s+(?:phish|malware|attack|ransomware)/i, category: 'offensive' },
  { pattern: /\bautonomous\s+(?:AI[- ])?(?:attack|hacker|adversary)/i, category: 'offensive' },
  // Defensive — discipline-anchored phrases
  { pattern: /\bprompt\s+injection\b/i, category: 'defensive' },
  { pattern: /\bLLM\s+jailbreak/i, category: 'defensive' },
  { pattern: /\bAI\s+jailbreak/i, category: 'defensive' },
  { pattern: /\bsystem\s+prompt\s+(?:leak|extraction|disclosure)/i, category: 'defensive' },
  { pattern: /\bmodel\s+weight\s+(?:exfiltration|theft|leak)/i, category: 'defensive' },
  { pattern: /\bMITRE\s+ATLAS\b/i, category: 'defensive' },
  { pattern: /\bOWASP\s+LLM(?:\s+Top\s*10)?\b/i, category: 'defensive' },
  { pattern: /\bRAG\s+poisoning\b/i, category: 'defensive' },
  { pattern: /\btraining[- ]data\s+poisoning\b/i, category: 'defensive' },
  // Agentic-safety — names that only exist in this niche
  { pattern: /\bMCP\s+(?:server\s+exploit|injection|hijack)/i, category: 'agentic_safety' },
  { pattern: /\bagent(?:ic)?\s+sandbox\s+escape\b/i, category: 'agentic_safety' },
  { pattern: /\btool[- ]use\s+(?:abuse|hijack|exploit)/i, category: 'agentic_safety' },
];

/**
 * Subcategory term banks. Each list defines softer signals — phrases that
 * suggest a category but might also appear in unrelated contexts. Confidence
 * comes from CROSSING multiple categories or stacking with a STRONG_TERM.
 */
const VENDOR_INCIDENT_TERMS: readonly RegExp[] = [
  // AI/LLM vendor name + breach/leak/compromise verb
  /\b(?:OpenAI|Anthropic|Cohere|Mistral|xAI|Hugging\s*Face)\b[^.]{0,80}\b(?:breach|leak|incident|compromise|exposed|disclosure|data\s+exposure|security\s+incident)\b/i,
  /\b(?:GitHub\s+Copilot|Microsoft\s+Copilot|Google\s+Gemini|Anthropic\s+Claude|ChatGPT)\b[^.]{0,80}\b(?:vulnerability|CVE-|exploit|flaw)\b/i,
  // AI-security vendor news (always relevant to our niche)
  /\b(?:Lakera|HiddenLayer|Protect\s*AI|Robust\s+Intelligence|CalypsoAI|Mindgard)\b/i,
];

const DEFENSIVE_TERMS: readonly RegExp[] = [
  /\bguardrail(?:s)?\b/i,
  /\bcontent\s+filter\b/i,
  /\bLLM\s+(?:firewall|gateway|defense|protection)\b/i,
  /\bAI\s+red\s*team(?:ing)?\b/i,
  /\badversarial\s+(?:example|attack|robustness)\b/i,
  /\bAI\s+(?:safety|alignment)\s+(?:incident|risk|failure)\b/i,
  /\bAI\s+Incident\s+Database\b/i,
];

const OFFENSIVE_TERMS: readonly RegExp[] = [
  /\bAI[- ]generated\s+(?:phish|malware|exploit|deepfake)/i,
  /\bdeepfake\s+(?:voice|audio|video|fraud|scam)\b/i,
  /\bvoice\s+clone(?:d|ing)?\s+(?:scam|fraud|attack)/i,
  /\bagentic\s+(?:malware|attacker|threat)\b/i,
  /\bLLM[- ]assisted\s+(?:attack|exploit|phish)/i,
];

const AGENTIC_SAFETY_TERMS: readonly RegExp[] = [
  /\bagent(?:ic)?\s+(?:misuse|risk|incident|exploit)\b/i,
  /\bMCP\s+(?:server|tool|client|protocol)\b/i,
  /\bagent\s+(?:rug[- ]pull|prompt[- ]hijack)\b/i,
  /\bautomated\s+(?:tool|agent)\s+(?:abuse|misuse)\b/i,
];

/**
 * Negative-signal terms. If the item has ZERO positive signals AND any of
 * these fire, we're confident the item is NOT AI-cyber. Negatives never
 * override positives — only adjudicate the zero-positive case.
 */
const NEGATIVE_TERMS: readonly RegExp[] = [
  /\bquarterly\s+earnings\b/i,
  /\bIPO\b/i,
  /\bstock\s+(?:price|split|buyback)\b/i,
  /\bmarket\s+cap\s+(?:of|reached|crossed)\b/i,
  /\b(?:NBA|NFL|MLB|Premier\s+League)\b/i,
  /\bmovie\s+(?:trailer|premiere|release)\b/i,
  /\bbox\s+office\b/i,
  /\bcelebrity\s+(?:gossip|wedding|divorce)\b/i,
];

// ─── Public surface ──────────────────────────────────────────────────────────

export interface KeywordScoreResult {
  /** Final score in [0, 1] for this tier. */
  score: number;
  /** Best-matching subcategory, or 'unrelated' if no positives fired. */
  category: AiCategory;
  /** Where on the confidence spectrum the score sits — used by scorer.ts to route. */
  band: 'confident_no' | 'low' | 'gray' | 'confident_yes';
  evidence: {
    /** Strong-term hits with their patterns (source verbatim). */
    strong: string[];
    /** Subcategory bank hits — patterns that matched, grouped per category. */
    subcategory: Partial<Record<AiCategory, string[]>>;
    /** Negative-term hits (informational; only affect score in zero-positive case). */
    negative: string[];
  };
}

const SUBCATEGORY_BANKS: ReadonlyArray<{ category: AiCategory; patterns: readonly RegExp[] }> = [
  { category: 'vendor_incident', patterns: VENDOR_INCIDENT_TERMS },
  { category: 'defensive', patterns: DEFENSIVE_TERMS },
  { category: 'offensive', patterns: OFFENSIVE_TERMS },
  { category: 'agentic_safety', patterns: AGENTIC_SAFETY_TERMS },
];

/**
 * Score a news item against the AI-cyber keyword model. Pure function — no
 * I/O, no side effects, deterministic for a given input.
 */
export function scoreByKeywords(item: { title: string; summary?: string }): KeywordScoreResult {
  const haystack = `${item.title}\n${item.summary ?? ''}`;

  // 1. Strong-term sweep
  const strongHits: { pattern: string; category: AiCategory }[] = [];
  for (const { pattern, category } of STRONG_TERMS) {
    const match = pattern.exec(haystack);
    if (match) strongHits.push({ pattern: match[0], category });
  }

  // 2. Subcategory bank sweep
  const subcategoryHits: Partial<Record<AiCategory, string[]>> = {};
  for (const bank of SUBCATEGORY_BANKS) {
    for (const pattern of bank.patterns) {
      const match = pattern.exec(haystack);
      if (match) {
        const list = subcategoryHits[bank.category] ?? [];
        list.push(match[0]);
        subcategoryHits[bank.category] = list;
      }
    }
  }

  // 3. Negative sweep (only matters when zero positive signals)
  const negativeHits: string[] = [];
  for (const pattern of NEGATIVE_TERMS) {
    const match = pattern.exec(haystack);
    if (match) negativeHits.push(match[0]);
  }

  const distinctSubcategories = Object.keys(subcategoryHits) as AiCategory[];
  const evidence = {
    strong: strongHits.map((h) => h.pattern),
    subcategory: subcategoryHits,
    negative: negativeHits,
  };

  // Decision tree
  if (strongHits.length > 0) {
    return {
      score: 0.9,
      category: pickDominantCategory(strongHits[0]!.category, distinctSubcategories),
      band: 'confident_yes',
      evidence,
    };
  }

  if (distinctSubcategories.length >= 2) {
    return {
      score: 0.85,
      category: pickHighestVolumeCategory(subcategoryHits),
      band: 'confident_yes',
      evidence,
    };
  }

  if (distinctSubcategories.length === 1) {
    const only = distinctSubcategories[0]!;
    return {
      score: 0.55,
      category: only,
      band: 'gray',
      evidence,
    };
  }

  // Zero positive signals
  if (negativeHits.length > 0) {
    return {
      score: 0.05,
      category: 'unrelated',
      band: 'confident_no',
      evidence,
    };
  }

  return {
    score: 0.2,
    category: 'unrelated',
    band: 'low',
    evidence,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * When a STRONG_TERM fires, that term declares its canonical category.
 * But if subcategory hits ALSO fired in another category, we cross-check
 * and keep the dominant one (most distinct hits) — useful when an item is
 * primarily "vendor incident" but also brushes "defensive."
 */
function pickDominantCategory(
  strongCategory: AiCategory,
  subcategoryCategories: AiCategory[],
): AiCategory {
  if (subcategoryCategories.length === 0) return strongCategory;
  // Prefer the strong category unless subcategories agree on something different
  if (subcategoryCategories.includes(strongCategory)) return strongCategory;
  // First subcategory wins — STRONG_TERMS are unambiguous so this is rare
  return strongCategory;
}

/**
 * When multiple subcategories fire, pick the one with the most patterns
 * matched (a richer signal). Ties break by declaration order.
 */
function pickHighestVolumeCategory(hits: Partial<Record<AiCategory, string[]>>): AiCategory {
  let bestCategory: AiCategory = 'unrelated';
  let bestCount = 0;
  // Iterate in SUBCATEGORY_BANKS declaration order so ties resolve consistently.
  for (const bank of SUBCATEGORY_BANKS) {
    const count = hits[bank.category]?.length ?? 0;
    if (count > bestCount) {
      bestCount = count;
      bestCategory = bank.category;
    }
  }
  return bestCategory;
}
