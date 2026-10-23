/**
 * Phase 11.B.6 — Bayesian Dirichlet-Categorical actor-target forecaster.
 *
 * Answers: "given threat actor X's historical targeting record, what's
 * the posterior probability they target sector S (or country C) in their
 * NEXT campaign?"
 *
 * Math (closed-form conjugate):
 *
 *   prior:     Dir(α_0, α_0, …, α_0)  — symmetric, α_0 = 1.0 (mildly informative)
 *   likelihood: each historical target observation is one sample from
 *               Categorical(p) where p ~ Dir(α)
 *   posterior: Dir(α_post) where
 *               α_s_post = α_0 + n_s + (RECENCY_WEIGHT - 1) × n_s_recent
 *
 *   For RECENCY_WEIGHT=2 and n_s_recent = events in last 90 days:
 *               α_s_post = α_0 + n_s + n_s_recent
 *               (= n_s_total + n_s_recent_bonus, since n_s already counts
 *                 recent events once — we ADD an extra count for recency.)
 *
 *   Posterior mean for sector s:  α_s_post / Σ_k α_k_post
 *   Posterior variance for s:     mean × (1 - mean) / (Σ_k α_k_post + 1)
 *   95% credible interval:        mean ± 1.96 × √variance, clamped to [0,1]
 *
 * Why Dirichlet-Categorical:
 *   - Closed-form (no MCMC / VI needed for v0.1)
 *   - Calibrated uncertainty: actors with sparse data get wide CIs;
 *     actors with deep history get tight ones — exactly what we want
 *     for "rank top-5 next-target sectors w/ confidence"
 *   - Recency weighting captures changing TTPs without throwing out old data
 *
 * Pure module — DB queries happen in the calling route; this just takes
 * raw count vectors and computes the posterior. That keeps inference
 * testable + lets the route do its own caching.
 *
 * Pattern reference: src/lib/aegis/forecasting/exploit-logistic.ts
 * (same percentile-result style, same defensive clamping).
 */

// ─── Public surface ──────────────────────────────────────────────────────────

export interface CategoryObservation {
  /** The category label (sector name or country code). */
  category: string;
  /** Total historical events targeting this category. */
  totalCount: number;
  /** How many of those events fell within the recency window (default 90d). */
  recentCount: number;
}

export interface PosteriorSummary {
  /** The category label. */
  category: string;
  /** Posterior mean probability — α_s_post / Σ α. */
  pMean: number;
  /** Lower bound of the 95% credible interval. */
  pLow: number;
  /** Upper bound of the 95% credible interval. */
  pHigh: number;
  /** Raw Dirichlet α_s_post (useful for debugging + caching). */
  alphaPost: number;
}

export interface DirichletForecast {
  /** Top-K categories by posterior mean, with credible intervals. */
  topCategories: PosteriorSummary[];
  /** Full posterior α vector — { [category]: α_post } — cache + audit. */
  posteriorAlpha: Record<string, number>;
  /** Σ α_post — the "effective sample size" of the posterior. */
  alphaSum: number;
  /** Number of distinct categories that had any historical evidence. */
  observedCategoryCount: number;
  modelVersion: string;
}

export interface BayesianConfig {
  /** Dirichlet prior concentration. 1.0 = uniform prior (mild). */
  prior?: number;
  /** Recency bonus multiplier. 2.0 = recent events count double total. */
  recencyWeight?: number;
  /** Top-K results to return. Default 5. */
  topK?: number;
}

const DEFAULTS: Required<BayesianConfig> = {
  prior: 1.0,
  recencyWeight: 2.0,
  topK: 5,
};

const Z_95 = 1.96;
export const MODEL_VERSION = 'actor-target-bayesian-v0_1';

// ─── forecastFromObservations ────────────────────────────────────────────────

/**
 * Compute the Dirichlet-Categorical posterior given the count vector.
 *
 * Caller responsibility: assemble `observations` by SQL-aggregating
 * aegis_threat_actor_targets / campaigns / incidents for one actor over
 * the desired window. Then pass here.
 *
 * Cost: O(N log N) where N = distinct categories — dominated by the
 * top-K sort. For typical actor history (~10-30 sectors / countries),
 * this is sub-millisecond.
 */
export function forecastFromObservations(
  observations: readonly CategoryObservation[],
  config?: BayesianConfig,
): DirichletForecast {
  const cfg = { ...DEFAULTS, ...(config ?? {}) };
  // Validate inputs defensively. Negative counts would corrupt the
  // posterior; coerce to 0.
  const cleaned = observations
    .filter((o) => o.category && o.category.length > 0)
    .map((o) => ({
      category: o.category,
      totalCount: Math.max(0, Math.floor(o.totalCount)),
      recentCount: Math.max(0, Math.floor(o.recentCount)),
    }));

  // Build the posterior α vector. Recency bonus is (recencyWeight - 1) ×
  // recentCount on top of the totalCount, so RECENCY_WEIGHT=1 gives no
  // bonus and RECENCY_WEIGHT=2 doubles recent events relative to old ones.
  const alphaPost: Record<string, number> = {};
  let alphaSum = 0;
  let observedCategoryCount = 0;
  for (const obs of cleaned) {
    const bonus = (cfg.recencyWeight - 1) * Math.min(obs.recentCount, obs.totalCount);
    const alpha = cfg.prior + obs.totalCount + bonus;
    alphaPost[obs.category] = alpha;
    alphaSum += alpha;
    if (obs.totalCount > 0) observedCategoryCount++;
  }

  // Edge case: no observations at all. Return empty result with the prior
  // alpha sum (0 since we have no categories) and an empty top list. The
  // caller should treat this as "no forecast available" rather than
  // surfacing a uniform-over-nothing answer.
  if (cleaned.length === 0) {
    return {
      topCategories: [],
      posteriorAlpha: {},
      alphaSum: 0,
      observedCategoryCount: 0,
      modelVersion: MODEL_VERSION,
    };
  }

  // Per-category posterior summary.
  const summaries: PosteriorSummary[] = [];
  // Variance denominator: Σα + 1 (standard Dirichlet result).
  const denom = alphaSum + 1;
  for (const [category, alpha] of Object.entries(alphaPost)) {
    const pMean = alpha / alphaSum;
    const variance = (pMean * (1 - pMean)) / denom;
    const half = Z_95 * Math.sqrt(Math.max(0, variance));
    summaries.push({
      category,
      pMean,
      pLow: clamp01(pMean - half),
      pHigh: clamp01(pMean + half),
      alphaPost: alpha,
    });
  }

  // Sort by posterior mean DESC; ties broken by alphaPost DESC so the
  // category with more evidence wins. Stable sort means deterministic
  // output for callers + tests.
  summaries.sort((a, b) => {
    if (b.pMean !== a.pMean) return b.pMean - a.pMean;
    return b.alphaPost - a.alphaPost;
  });

  return {
    topCategories: summaries.slice(0, cfg.topK),
    posteriorAlpha: alphaPost,
    alphaSum,
    observedCategoryCount,
    modelVersion: MODEL_VERSION,
  };
}

// ─── Helpers for consumers ───────────────────────────────────────────────────

/**
 * Convenience: turn a flat list of (category, isRecent) observations into
 * the CategoryObservation count format the forecaster expects. Useful for
 * routes that pull raw rows from the DB and want to feed them in directly.
 *
 * Caller decides what "isRecent" means by pre-filtering rows; this helper
 * doesn't compute the window cutoff — that's a SQL concern.
 */
export function aggregateObservations(
  events: readonly { category: string; isRecent: boolean }[],
): CategoryObservation[] {
  const map = new Map<string, { total: number; recent: number }>();
  for (const e of events) {
    if (!e.category) continue;
    const entry = map.get(e.category) ?? { total: 0, recent: 0 };
    entry.total++;
    if (e.isRecent) entry.recent++;
    map.set(e.category, entry);
  }
  return Array.from(map.entries()).map(([category, { total, recent }]) => ({
    category,
    totalCount: total,
    recentCount: recent,
  }));
}

// ─── Internals ───────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
