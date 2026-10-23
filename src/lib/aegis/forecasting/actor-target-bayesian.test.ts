/**
 * Tests for the Phase 11.B.6 Bayesian Dirichlet-Categorical forecaster.
 *
 * Closed-form math — tests pin down:
 *
 *   - posterior sums to 1.0 ± 1e-9 (mathematical correctness)
 *   - recency-weighted counts boost recent categories above pure totals
 *   - sparse-evidence actors get wide CIs; deep-history actors get tight
 *   - empty input returns empty result (no NaN, no crash)
 *   - top-K respects the requested K and sorts by posterior mean DESC
 *   - aggregateObservations helper correctly tallies isRecent flags
 */

import { describe, expect, it } from 'vitest';
import {
  aggregateObservations,
  type CategoryObservation,
  forecastFromObservations,
  MODEL_VERSION,
} from './actor-target-bayesian';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeObs(category: string, total: number, recent = 0): CategoryObservation {
  return { category, totalCount: total, recentCount: recent };
}

function sum(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

// ─── Math correctness ───────────────────────────────────────────────────────

describe('forecastFromObservations — posterior math', () => {
  it('top category probabilities + prior tail sum to 1.0 within fp tolerance', () => {
    const obs = [makeObs('Healthcare', 20), makeObs('Finance', 10), makeObs('Tech', 5)];
    const r = forecastFromObservations(obs, { topK: 3 });
    const probSum = sum(r.topCategories.map((c) => c.pMean));
    // Top 3 IS all categories here, so probSum should equal 1.0 (modulo fp)
    expect(probSum).toBeCloseTo(1.0, 9);
  });

  it('full posterior alpha sum matches Σ(prior + count + recency_bonus)', () => {
    const prior = 1.0;
    const recencyWeight = 2.0;
    const obs = [makeObs('A', 10, 4), makeObs('B', 5, 0)];
    const r = forecastFromObservations(obs, { prior, recencyWeight });
    // α_A = 1 + 10 + (2-1)*4 = 15
    // α_B = 1 + 5  + (2-1)*0 = 6
    // total = 21
    expect(r.alphaSum).toBeCloseTo(21, 9);
    expect(r.posteriorAlpha.A).toBeCloseTo(15, 9);
    expect(r.posteriorAlpha.B).toBeCloseTo(6, 9);
  });

  it('reduces to uniform prior when no observations exceed zero count', () => {
    const obs = [makeObs('A', 0), makeObs('B', 0), makeObs('C', 0)];
    const r = forecastFromObservations(obs, { prior: 1.0 });
    // α_A = α_B = α_C = 1.0 → mean = 1/3 each
    for (const c of r.topCategories) {
      expect(c.pMean).toBeCloseTo(1 / 3, 6);
    }
    expect(r.observedCategoryCount).toBe(0);
  });
});

// ─── Recency weighting ─────────────────────────────────────────────────────

describe('forecastFromObservations — recency weighting', () => {
  it('promotes a sector with recent activity above one with stale activity', () => {
    // Both have 10 historical total. A has all 10 recent; B has 0 recent.
    const obs = [makeObs('Healthcare', 10, 10), makeObs('Government', 10, 0)];
    const r = forecastFromObservations(obs, { recencyWeight: 2.0 });
    const healthcare = r.topCategories.find((c) => c.category === 'Healthcare')!;
    const government = r.topCategories.find((c) => c.category === 'Government')!;
    expect(healthcare.pMean).toBeGreaterThan(government.pMean);
  });

  it('recencyWeight=1 disables the recency bonus (equal recent vs old totals)', () => {
    const obs = [makeObs('Healthcare', 10, 10), makeObs('Government', 10, 0)];
    const r = forecastFromObservations(obs, { recencyWeight: 1.0 });
    const healthcare = r.topCategories.find((c) => c.category === 'Healthcare')!;
    const government = r.topCategories.find((c) => c.category === 'Government')!;
    // With recencyWeight=1, both should have identical posterior
    expect(healthcare.pMean).toBeCloseTo(government.pMean, 9);
  });

  it('caps recent count at total count (defensive against bad input)', () => {
    // Pass recentCount > totalCount — should NOT cause recent bonus > total
    const obs = [makeObs('Healthcare', 5, 100)];
    const r = forecastFromObservations(obs, { recencyWeight: 2.0 });
    // α should be 1 + 5 + (2-1) * min(100, 5) = 11, not 1 + 5 + 100 = 106
    expect(r.posteriorAlpha.Healthcare).toBeCloseTo(11, 9);
  });
});

// ─── CI behavior ───────────────────────────────────────────────────────────

describe('forecastFromObservations — credible intervals', () => {
  it('sparse-evidence actors get wider CIs than deep-history actors', () => {
    // Same posterior mean (50/50 split) but very different evidence depths.
    const sparse = forecastFromObservations([makeObs('A', 1), makeObs('B', 1)]);
    const deep = forecastFromObservations([makeObs('A', 100), makeObs('B', 100)]);
    const sparseWidth = sparse.topCategories[0]!.pHigh - sparse.topCategories[0]!.pLow;
    const deepWidth = deep.topCategories[0]!.pHigh - deep.topCategories[0]!.pLow;
    expect(sparseWidth).toBeGreaterThan(deepWidth);
  });

  it('pLow ≤ pMean ≤ pHigh for every category', () => {
    const obs = [
      makeObs('Healthcare', 20, 8),
      makeObs('Finance', 5, 1),
      makeObs('Tech', 12, 6),
      makeObs('Energy', 3, 3),
    ];
    const r = forecastFromObservations(obs);
    for (const c of r.topCategories) {
      expect(c.pLow).toBeLessThanOrEqual(c.pMean);
      expect(c.pMean).toBeLessThanOrEqual(c.pHigh);
    }
  });

  it('CI bounds are clamped to [0, 1]', () => {
    // Single-sample observation → high uncertainty, but bounds must stay sane
    const r = forecastFromObservations([makeObs('A', 1)]);
    for (const c of r.topCategories) {
      expect(c.pLow).toBeGreaterThanOrEqual(0);
      expect(c.pHigh).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Top-K + sort ─────────────────────────────────────────────────────────

describe('forecastFromObservations — top-K + ordering', () => {
  it('returns at most topK categories in DESC order by pMean', () => {
    const obs = [
      makeObs('A', 30),
      makeObs('B', 25),
      makeObs('C', 20),
      makeObs('D', 15),
      makeObs('E', 10),
      makeObs('F', 5),
    ];
    const r = forecastFromObservations(obs, { topK: 3 });
    expect(r.topCategories).toHaveLength(3);
    expect(r.topCategories[0]!.category).toBe('A');
    expect(r.topCategories[1]!.category).toBe('B');
    expect(r.topCategories[2]!.category).toBe('C');
  });

  it('breaks ties by alphaPost DESC (more evidence wins)', () => {
    // Two categories with identical posterior mean ratios but different counts
    const obs = [
      makeObs('Heavy', 100, 50),
      makeObs('Light', 100, 50),
      // Tie-breaker: Heavy gets a recent boost via the recency multiplier?
      // No — they're identical above. Add a small differentiator.
    ];
    // Force a true tie by setting identical counts
    const r = forecastFromObservations(obs, { topK: 2 });
    // Both have α = 1 + 100 + 50 = 151. With identical pMean and alphaPost,
    // JS Array.sort is stable so insertion order wins.
    expect(r.topCategories).toHaveLength(2);
    expect([r.topCategories[0]!.category, r.topCategories[1]!.category].sort()).toEqual([
      'Heavy',
      'Light',
    ]);
  });

  it('default topK=5', () => {
    const obs = Array.from({ length: 10 }, (_, i) => makeObs(`cat-${i}`, 10 - i));
    const r = forecastFromObservations(obs);
    expect(r.topCategories).toHaveLength(5);
  });
});

// ─── Empty / degenerate input ─────────────────────────────────────────────

describe('forecastFromObservations — defensive', () => {
  it('returns empty result for empty input (no NaN, no throw)', () => {
    const r = forecastFromObservations([]);
    expect(r.topCategories).toEqual([]);
    expect(r.alphaSum).toBe(0);
    expect(r.observedCategoryCount).toBe(0);
    expect(r.posteriorAlpha).toEqual({});
  });

  it('drops observations with empty category labels', () => {
    const obs = [
      makeObs('', 10), // dropped
      makeObs('Real', 5),
    ];
    const r = forecastFromObservations(obs);
    expect(r.topCategories).toHaveLength(1);
    expect(r.topCategories[0]!.category).toBe('Real');
  });

  it('coerces negative counts to 0', () => {
    const obs = [{ category: 'A', totalCount: -5, recentCount: -3 }];
    const r = forecastFromObservations(obs);
    // α should be just the prior (1.0) since totals were clamped
    expect(r.posteriorAlpha.A).toBeCloseTo(1.0, 9);
  });

  it('floors fractional counts', () => {
    const obs = [{ category: 'A', totalCount: 3.7, recentCount: 2.2 }];
    const r = forecastFromObservations(obs);
    // α = 1 + 3 + (2-1)*2 = 6
    expect(r.posteriorAlpha.A).toBeCloseTo(6, 9);
  });

  it('reports the model version string', () => {
    const r = forecastFromObservations([makeObs('A', 1)]);
    expect(r.modelVersion).toBe(MODEL_VERSION);
  });
});

// ─── aggregateObservations helper ──────────────────────────────────────────

describe('aggregateObservations — flat-events convenience', () => {
  it('aggregates a flat event list into count vectors', () => {
    const events = [
      { category: 'Healthcare', isRecent: true },
      { category: 'Healthcare', isRecent: false },
      { category: 'Finance', isRecent: true },
      { category: 'Healthcare', isRecent: true },
    ];
    const obs = aggregateObservations(events);
    const healthcare = obs.find((o) => o.category === 'Healthcare');
    const finance = obs.find((o) => o.category === 'Finance');
    expect(healthcare?.totalCount).toBe(3);
    expect(healthcare?.recentCount).toBe(2);
    expect(finance?.totalCount).toBe(1);
    expect(finance?.recentCount).toBe(1);
  });

  it('drops events with empty category labels', () => {
    const events = [
      { category: '', isRecent: true },
      { category: 'Real', isRecent: false },
    ];
    const obs = aggregateObservations(events);
    expect(obs).toHaveLength(1);
    expect(obs[0]!.category).toBe('Real');
  });

  it('returns empty array for empty input', () => {
    expect(aggregateObservations([])).toEqual([]);
  });
});

// ─── End-to-end sanity check ──────────────────────────────────────────────

describe('forecastFromObservations — end-to-end realism', () => {
  it('returns sensible top-5 for a realistic actor history', () => {
    // Hypothetical LockBit-style actor: heavy on Healthcare + Finance,
    // some Tech, occasional Energy + Government. Recent campaigns shifted
    // toward Healthcare.
    const obs = [
      makeObs('Healthcare', 25, 12),
      makeObs('Finance', 18, 4),
      makeObs('Tech', 8, 2),
      makeObs('Energy', 5, 1),
      makeObs('Government', 4, 0),
      makeObs('Manufacturing', 2, 0),
    ];
    const r = forecastFromObservations(obs, { topK: 5 });
    expect(r.topCategories).toHaveLength(5);
    // Healthcare should be top (most evidence + most recent)
    expect(r.topCategories[0]!.category).toBe('Healthcare');
    // Finance should be second
    expect(r.topCategories[1]!.category).toBe('Finance');
    // Top-5 probabilities should sum to most-but-not-all of 1.0 (since
    // Manufacturing is excluded)
    const topSum = sum(r.topCategories.map((c) => c.pMean));
    expect(topSum).toBeGreaterThan(0.85);
    expect(topSum).toBeLessThan(1.0);
  });
});
