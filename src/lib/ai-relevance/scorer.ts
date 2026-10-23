/**
 * AI-cyber relevance — orchestrator.
 *
 * The single function callers reach for: scoreItem(item). Walks the pipeline:
 *
 *     ┌────────────────┐
 *     │ Redis cache    │  ai_relevance:<sha256-32>  (TTL 7d)
 *     │ hit? → return  │
 *     └────────┬───────┘
 *              │ miss
 *     ┌────────▼──────────┐
 *     │ keyword baseline  │  pure, deterministic, ~0.5ms
 *     │ band: confident_*?│
 *     └────┬──────┬───────┘
 *          │ yes  │ no (gray / low)
 *          │      │
 *          │   ┌──▼─────────────┐
 *          │   │ rate budget?   │  10/min Haiku
 *          │   │ no → keyword   │  (fail-open with keyword score)
 *          │   │ yes ↓          │
 *          │   ├────────────────┤
 *          │   │ Haiku tiebreak │  ~250ms p95, $0.005/call
 *          │   │ null → keyword │
 *          │   └──────┬─────────┘
 *          │          │
 *     ┌────▼──────────▼───┐
 *     │ persist + cache   │  durable in PG + 7d Redis
 *     │ → return result   │
 *     └───────────────────┘
 *
 * Cost model: with the keyword tier short-circuiting confident-yes (≥0.7)
 * and confident-no (≤0.3), only the 0.4-0.7 gray-zone reaches Haiku. For
 * the ~14 AI-cyber + cyber RSS feeds + 21 Twitter handles the deck ingests,
 * we expect 60-100 unique gray-zone items/day at steady state. At $0.005/call
 * that's $0.30-0.50/day — well under the $3/day budget in the PRD.
 */

import { createHash } from 'node:crypto';
import { checkRateLimit, getCached, setCache } from '@/lib/data/rate-limiter';
import type { AiCategory, AiRelevanceModel } from '@/lib/outbound/constants';
import { scoreWithHaiku } from './haiku';
import { type KeywordScoreResult, scoreByKeywords } from './keywords';
import { upsertEnrichment } from './persist';

export interface ScoreInput {
  url: string;
  title: string;
  summary?: string;
}

export interface ScoreResult {
  url: string;
  /** Final relevance in [0, 1]. */
  aiRelevance: number;
  /** Closed-set category. 'unrelated' is the explicit "not AI-cyber" value. */
  aiCategory: AiCategory;
  /** Which tier of the pipeline produced this score. */
  modelUsed: AiRelevanceModel;
  /** ISO timestamp the score was generated. */
  scoredAt: string;
  /** Whether this came from the cache (otherwise: freshly computed). */
  fromCache: boolean;
  /** Why the score is what it is — keyword evidence and (optionally) Haiku rationale. */
  evidence: ScoreEvidence;
}

interface ScoreEvidence {
  keyword: {
    score: number;
    band: KeywordScoreResult['band'];
    category: AiCategory;
    matched: string[];
    negative: string[];
  };
  haiku?: {
    relevance: number;
    category: AiCategory;
    rationale: string;
  };
  /** Reason the orchestrator chose this tier — useful for monitoring. */
  decision:
    | 'cache'
    | 'keyword_confident_yes'
    | 'keyword_confident_no'
    | 'haiku'
    | 'haiku_skipped_rate_limit'
    | 'haiku_failed_fallback';
}

const CACHE_KEY_PREFIX = 'ai_relevance';

/**
 * Score a single news item end-to-end. Always returns a ScoreResult — never
 * throws. The keyword baseline is the safety net: even if Redis and Haiku
 * both fail, callers get a deterministic keyword-derived score.
 */
export async function scoreItem(item: ScoreInput): Promise<ScoreResult> {
  const cacheKey = makeCacheKey(item.url);

  // 1. Cache hit?
  const cached = await getCached<CachedScore>(cacheKey);
  if (cached) {
    return hydrateFromCache(cached);
  }

  // 2. Keyword baseline (pure, always available)
  const kw = scoreByKeywords(item);
  const keywordEvidence = flattenKeywordEvidence(kw);

  // 3. Confident bands skip Haiku entirely
  if (kw.band === 'confident_yes') {
    return finalize(
      item,
      kw.score,
      kw.category,
      'keywords',
      {
        keyword: keywordEvidence,
        decision: 'keyword_confident_yes',
      },
      cacheKey,
    );
  }
  if (kw.band === 'confident_no' || kw.band === 'low') {
    return finalize(
      item,
      kw.score,
      kw.category,
      'keywords',
      {
        keyword: keywordEvidence,
        decision: 'keyword_confident_no',
      },
      cacheKey,
    );
  }

  // 4. Gray zone — try Haiku if rate budget allows
  if (!checkRateLimit('ai_relevance_score')) {
    return finalize(
      item,
      kw.score,
      kw.category,
      'keywords',
      {
        keyword: keywordEvidence,
        decision: 'haiku_skipped_rate_limit',
      },
      cacheKey,
    );
  }

  const haiku = await scoreWithHaiku(item);
  if (!haiku) {
    return finalize(
      item,
      kw.score,
      kw.category,
      'keywords',
      {
        keyword: keywordEvidence,
        decision: 'haiku_failed_fallback',
      },
      cacheKey,
    );
  }

  return finalize(
    item,
    haiku.relevance,
    haiku.category,
    'haiku-4-5',
    {
      keyword: keywordEvidence,
      haiku: {
        relevance: haiku.relevance,
        category: haiku.category,
        rationale: haiku.rationale,
      },
      decision: 'haiku',
    },
    cacheKey,
  );
}

/**
 * Score many items concurrently. Items in the keyword confident-yes/no/low
 * bands are essentially free. Gray-zone items are throttled by the underlying
 * Haiku rate limit (10/min); excess gray-zone items fall back to keyword
 * scores gracefully.
 *
 * Concurrency cap = 8 to keep DB upsert pressure modest. Adjust if persist
 * latency becomes the bottleneck.
 */
export async function scoreItems(items: ScoreInput[]): Promise<ScoreResult[]> {
  const CONCURRENCY = 8;
  const results: ScoreResult[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await scoreItem(items[idx]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface CachedScore {
  url: string;
  aiRelevance: number;
  aiCategory: AiCategory;
  modelUsed: AiRelevanceModel;
  scoredAt: string;
  evidence: ScoreEvidence;
}

function makeCacheKey(url: string): string {
  // Hash the URL so Redis keys stay under their 512-byte limit and don't leak
  // potentially long article URLs into the cache namespace.
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 32);
  return `${CACHE_KEY_PREFIX}:${digest}`;
}

function hydrateFromCache(cached: CachedScore): ScoreResult {
  return {
    url: cached.url,
    aiRelevance: cached.aiRelevance,
    aiCategory: cached.aiCategory,
    modelUsed: cached.modelUsed,
    scoredAt: cached.scoredAt,
    fromCache: true,
    evidence: { ...cached.evidence, decision: 'cache' },
  };
}

function flattenKeywordEvidence(kw: KeywordScoreResult): ScoreEvidence['keyword'] {
  const matched = [...kw.evidence.strong, ...Object.values(kw.evidence.subcategory).flat()];
  return {
    score: kw.score,
    band: kw.band,
    category: kw.category,
    matched,
    negative: kw.evidence.negative,
  };
}

async function finalize(
  item: ScoreInput,
  aiRelevance: number,
  aiCategory: AiCategory,
  modelUsed: AiRelevanceModel,
  evidence: ScoreEvidence,
  cacheKey: string,
): Promise<ScoreResult> {
  const scoredAt = new Date().toISOString();

  const result: ScoreResult = {
    url: item.url,
    aiRelevance,
    aiCategory,
    modelUsed,
    scoredAt,
    fromCache: false,
    evidence,
  };

  // Persist (DB) + cache (Redis) in parallel. Both are fail-soft; neither
  // throws back to the caller.
  await Promise.all([
    upsertEnrichment({
      itemUrl: item.url,
      aiRelevance,
      aiCategory,
      modelUsed,
      scoredAt,
      evidenceJson: evidence as unknown as Record<string, unknown>,
    }),
    setCache(cacheKey, {
      url: item.url,
      aiRelevance,
      aiCategory,
      modelUsed,
      scoredAt,
      evidence,
    } satisfies CachedScore),
  ]);

  return result;
}
