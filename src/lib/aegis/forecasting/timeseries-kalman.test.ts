/**
 * Tests for the Phase 11.C.8 state-space Kalman time-series forecaster.
 *
 * Pin down:
 *
 *   - upward-trending synthetic series → trend='rising', forecasts climb
 *   - downward-trending → trend='falling', forecasts descend
 *   - flat-with-noise → trend='flat'
 *   - CI bands widen with horizon (variance compounds k² in slope)
 *   - CI bracket pMid
 *   - too-few observations returns null
 *   - non-negative clamping holds (counts can't be negative)
 *   - forecast dates advance by exactly 1 day per step (no gaps, no skips)
 *   - forecast length equals requested horizon
 */

import { describe, expect, it } from 'vitest';
import { type DailyValue, forecastMetric, METRICS } from './timeseries-kalman';

// ─── Synthetic-series helpers ────────────────────────────────────────────────

function makeFlatSeries(days: number, baseline = 5): DailyValue[] {
  const start = new Date('2025-01-01T00:00:00Z');
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    // Tiny per-day noise so variance isn't 0
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 0.4;
    return { date: d.toISOString().slice(0, 10), value: Math.max(0, baseline + noise) };
  });
}

function makeTrendSeries(days: number, slope: number, baseline = 5): DailyValue[] {
  const start = new Date('2025-01-01T00:00:00Z');
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 0.4;
    return {
      date: d.toISOString().slice(0, 10),
      value: Math.max(0, baseline + slope * i + noise),
    };
  });
}

// ─── Output shape ───────────────────────────────────────────────────────────

describe('forecastMetric — output shape', () => {
  it('returns null for fewer than 5 observations', () => {
    const tiny = makeFlatSeries(4);
    expect(forecastMetric('kev_adds', tiny, 30)).toBeNull();
  });

  it('returns null for non-positive horizon', () => {
    const history = makeFlatSeries(60);
    expect(forecastMetric('kev_adds', history, 0)).toBeNull();
    expect(forecastMetric('kev_adds', history, -5)).toBeNull();
  });

  it('returns a forecast array of length === horizonDays', () => {
    const history = makeFlatSeries(60);
    const r = forecastMetric('kev_adds', history, 30)!;
    expect(r.forecast).toHaveLength(30);
  });

  it('returns the requested metric name and model version', () => {
    const history = makeFlatSeries(60);
    const r = forecastMetric('breaches', history, 7)!;
    expect(r.metric).toBe('breaches');
    expect(r.modelVersion).toBe('timeseries-kalman-v0_1');
  });
});

// ─── Forecast dates ─────────────────────────────────────────────────────────

describe('forecastMetric — date sequencing', () => {
  it('forecast dates advance by exactly 1 day per step', () => {
    const history = makeFlatSeries(60);
    const r = forecastMetric('kev_adds', history, 5)!;
    const dates = r.forecast.map((p) => new Date(`${p.date}T00:00:00Z`).getTime());
    for (let i = 1; i < dates.length; i++) {
      const deltaMs = dates[i]! - dates[i - 1]!;
      expect(deltaMs).toBe(86_400_000); // exactly 24 hours
    }
  });

  it('first forecast date is the day AFTER the last history date', () => {
    const history = makeFlatSeries(10);
    const r = forecastMetric('kev_adds', history, 3)!;
    const lastHist = history[history.length - 1]!.date;
    const firstForecast = r.forecast[0]!.date;
    const deltaMs =
      new Date(`${firstForecast}T00:00:00Z`).getTime() -
      new Date(`${lastHist}T00:00:00Z`).getTime();
    expect(deltaMs).toBe(86_400_000);
  });
});

// ─── CI bands ───────────────────────────────────────────────────────────────

describe('forecastMetric — confidence bands', () => {
  it('pLow ≤ pMid ≤ pHigh for every forecast point', () => {
    const history = makeFlatSeries(60);
    const r = forecastMetric('kev_adds', history, 30)!;
    for (const p of r.forecast) {
      expect(p.pLow).toBeLessThanOrEqual(p.pMid);
      expect(p.pMid).toBeLessThanOrEqual(p.pHigh);
    }
  });

  it('CI bands widen with horizon (variance grows as k²)', () => {
    const history = makeFlatSeries(60);
    const r = forecastMetric('kev_adds', history, 30)!;
    const firstWidth = r.forecast[0]!.pHigh - r.forecast[0]!.pLow;
    const lastWidth = r.forecast[29]!.pHigh - r.forecast[29]!.pLow;
    expect(lastWidth).toBeGreaterThan(firstWidth);
  });

  it('pLow is clamped to 0 (counts cannot be negative)', () => {
    const history = makeFlatSeries(60, 1); // baseline 1 → noise can push below 0
    const r = forecastMetric('kev_adds', history, 30)!;
    for (const p of r.forecast) {
      expect(p.pLow).toBeGreaterThanOrEqual(0);
    }
  });

  it('observationStdev is non-negative and finite', () => {
    const history = makeFlatSeries(60);
    const r = forecastMetric('kev_adds', history, 7)!;
    expect(r.observationStdev).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.observationStdev)).toBe(true);
  });
});

// ─── Trend classification ───────────────────────────────────────────────────

describe('forecastMetric — trend classification', () => {
  it('classifies a clearly-rising series as "rising"', () => {
    // Strong upward trend: slope=0.5/day on baseline 2 → 50 by day 90
    const history = makeTrendSeries(90, 0.5, 2);
    const r = forecastMetric('kev_adds', history, 7)!;
    expect(r.trend).toBe('rising');
  });

  it('classifies a clearly-falling series as "falling"', () => {
    // Strong downward trend
    const history = makeTrendSeries(90, -0.5, 50);
    const r = forecastMetric('kev_adds', history, 7)!;
    expect(r.trend).toBe('falling');
  });

  it('classifies a flat-with-noise series as "flat"', () => {
    const history = makeFlatSeries(90, 10);
    const r = forecastMetric('kev_adds', history, 7)!;
    expect(r.trend).toBe('flat');
  });
});

// ─── Projection sanity ──────────────────────────────────────────────────────

describe('forecastMetric — projection direction follows trend', () => {
  it('rising series → pMid at end-of-horizon > pMid at start', () => {
    const history = makeTrendSeries(60, 0.3, 5);
    const r = forecastMetric('kev_adds', history, 30)!;
    expect(r.forecast[29]!.pMid).toBeGreaterThan(r.forecast[0]!.pMid);
  });

  it('falling series → pMid at end-of-horizon ≤ pMid at start', () => {
    const history = makeTrendSeries(60, -0.3, 30);
    const r = forecastMetric('kev_adds', history, 30)!;
    expect(r.forecast[29]!.pMid).toBeLessThanOrEqual(r.forecast[0]!.pMid);
  });

  it('flat series → pMid stays within a narrow band across the horizon', () => {
    const history = makeFlatSeries(60, 10);
    const r = forecastMetric('kev_adds', history, 30)!;
    const midValues = r.forecast.map((p) => p.pMid);
    const min = Math.min(...midValues);
    const max = Math.max(...midValues);
    // Width should be small relative to the baseline value (10)
    expect(max - min).toBeLessThan(2);
  });
});

// ─── Metric type check ─────────────────────────────────────────────────────

describe('METRICS const tuple', () => {
  it('exposes all 5 expected daily-metric names', () => {
    expect(METRICS).toEqual(['kev_adds', 'incidents', 'breaches', 'advisories', 'geo_events']);
  });
});

// ─── Defensive ─────────────────────────────────────────────────────────────

describe('forecastMetric — defensive', () => {
  it('accepts unsorted history (sorts internally)', () => {
    const history = makeFlatSeries(10);
    const reversed = [...history].reverse();
    const a = forecastMetric('kev_adds', history, 5)!;
    const b = forecastMetric('kev_adds', reversed, 5)!;
    // Output should be identical because internal sort restores order
    for (let i = 0; i < 5; i++) {
      expect(a.forecast[i]!.date).toBe(b.forecast[i]!.date);
      expect(a.forecast[i]!.pMid).toBeCloseTo(b.forecast[i]!.pMid, 6);
    }
  });

  it('clamps negative history values to 0', () => {
    const history: DailyValue[] = makeFlatSeries(10);
    // Inject negative anomaly
    history[5]!.value = -100;
    const r = forecastMetric('kev_adds', history, 7);
    expect(r).not.toBeNull();
    for (const p of r!.forecast) {
      expect(p.pMid).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles all-zero history without throwing', () => {
    const history: DailyValue[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, '0')}`,
      value: 0,
    }));
    const r = forecastMetric('kev_adds', history, 7)!;
    for (const p of r.forecast) {
      expect(p.pMid).toBe(0);
      expect(p.pLow).toBe(0);
      // pHigh may be > 0 due to noise model — that's fine
      expect(Number.isFinite(p.pHigh)).toBe(true);
    }
  });
});
