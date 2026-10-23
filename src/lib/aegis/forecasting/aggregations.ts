/**
 * Phase 11.A.4 — Time-series aggregation refresh.
 *
 * The Kalman-filter time-series module (Phase 11.C.8) needs daily counts
 * of KEV adds / incidents / breach disclosures / advisories / geo events
 * to fit its state-space model. Recomputing those COUNTs from the source
 * tables on every read would burn ~5 GROUP-BY-DATE queries per Kalman
 * fit per panel render — too expensive.
 *
 * Solution: a pre-computed `aegis_daily_metrics` table (one row per
 * calendar day). The cron route in src/app/api/aegis/forecast-aggregations
 * runs `refreshAggregations()` nightly at 03:00 UTC; the time-series
 * module reads from `aegis_daily_metrics` directly.
 *
 * Source date columns (all TEXT in the seed convention, parsed via CAST):
 *
 *   aegis_kev                    → added_to_kev_at
 *   aegis_incidents              → disclosed_at (date the incident first
 *                                  entered our threat picture; not when it
 *                                  STARTED — sometimes years prior)
 *   aegis_breach_disclosures     → disclosed_at
 *   aegis_advisories             → published_at
 *   aegis_geo_threat_events      → occurred_at
 *
 * Each refresh is an UPSERT keyed on `date` — re-running is idempotent.
 * Updated_at gets bumped on every row touch so downstream consumers can
 * see when each day's count was last computed.
 *
 * The refresh window is the last `windowDays` days (default 730 = ~2 yrs).
 * Historical days outside the window are not touched — once a day has
 * stable counts it stays stable. The window is just there to bound write
 * cost and to let the cron catch any back-dated rows that landed late.
 */

import { query } from '@/lib/db/client';

// ─── Public surface ──────────────────────────────────────────────────────────

export interface RefreshResult {
  /** Total rows touched (one per calendar day in the refresh window). */
  rowsTouched: number;
  /** Per-metric row counts for debugging. */
  perMetric: Record<MetricName, number>;
  /** ms wall-clock for this refresh. */
  ms: number;
}

export type MetricName = 'kev_adds' | 'incidents' | 'breaches' | 'advisories' | 'geo_events';

/**
 * Recompute `aegis_daily_metrics` for the trailing `windowDays` days.
 * Idempotent — re-running yields the same row set; no row is double-counted.
 */
export async function refreshAggregations(windowDays = 730): Promise<RefreshResult> {
  const start = Date.now();
  const perMetric: Record<MetricName, number> = {
    kev_adds: 0,
    incidents: 0,
    breaches: 0,
    advisories: 0,
    geo_events: 0,
  };

  perMetric.kev_adds = await refreshMetric('kev_adds', windowDays);
  perMetric.incidents = await refreshMetric('incidents', windowDays);
  perMetric.breaches = await refreshMetric('breaches', windowDays);
  perMetric.advisories = await refreshMetric('advisories', windowDays);
  perMetric.geo_events = await refreshMetric('geo_events', windowDays);

  // Final pass — UPSERT a zero-count row for any calendar day in the
  // window that had no events at all in any metric. The Kalman filter
  // needs a continuous time series (no missing days) to fit properly;
  // gaps would confuse the slope component.
  const filledRows = await fillMissingDays(windowDays);

  // rowsTouched counts distinct dates in aegis_daily_metrics whose
  // updated_at falls within this refresh's wall-clock window.
  const elapsed = Date.now() - start;
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM aegis_daily_metrics
       WHERE updated_at >= NOW() - INTERVAL '1 second' * $1`,
    [Math.max(2, Math.ceil(elapsed / 1000) + 1)],
  );

  return {
    rowsTouched: Math.max(Number(rows[0]?.count ?? 0), filledRows),
    perMetric,
    ms: elapsed,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Refresh one metric column. Returns the number of (date) rows the UPSERT
 * affected. Generates ONE SQL statement per call — the inner SELECT builds
 * (date, count) pairs and the outer UPSERT writes them.
 */
async function refreshMetric(metric: MetricName, windowDays: number): Promise<number> {
  const sourceSql = buildSourceSql(metric, windowDays);
  const result = await query(
    `INSERT INTO aegis_daily_metrics (date, ${columnFor(metric)}, created_at, updated_at)
     SELECT day::date, count, NOW(), NOW()
       FROM (${sourceSql}) src
     ON CONFLICT (date) DO UPDATE
       SET ${columnFor(metric)} = EXCLUDED.${columnFor(metric)},
           updated_at = NOW()`,
  );
  return result.rowCount ?? 0;
}

function columnFor(metric: MetricName): string {
  switch (metric) {
    case 'kev_adds':
      return 'kev_adds';
    case 'incidents':
      return 'incidents';
    case 'breaches':
      return 'breaches';
    case 'advisories':
      return 'advisories';
    case 'geo_events':
      return 'geo_events';
  }
}

/**
 * Build the per-metric source SELECT. Each variant:
 *   - casts the source table's TIMESTAMPTZ column to ::date for grouping
 *   - filters to the last `windowDays`
 *   - groups by day and counts rows
 *
 * Pre-Phase-13 this used SUBSTRING(col FROM 1 FOR 10)::date because the
 * source columns were TEXT and we wanted to handle both 'YYYY-MM-DD' and
 * 'YYYY-MM-DD HH:MM:SS' formats. Migration 011 converted them to
 * TIMESTAMPTZ so a direct ::date cast is now correct + cheaper.
 *
 * windowDays is interpolated directly (not parameterized) because it's
 * a fixed integer — no injection surface. The metric switch is exhaustive
 * so the function always returns a valid query.
 */
function buildSourceSql(metric: MetricName, windowDays: number): string {
  const datePart = (column: string) => `${column}::date`;
  const sinceClause = `AND ${datePart('source_date')} >= CURRENT_DATE - INTERVAL '${windowDays} days'`;
  switch (metric) {
    case 'kev_adds':
      return `
        SELECT ${datePart('source_date')} AS day, COUNT(*) AS count
          FROM (SELECT added_to_kev_at AS source_date FROM aegis_kev WHERE added_to_kev_at IS NOT NULL) k
          WHERE 1=1 ${sinceClause}
          GROUP BY ${datePart('source_date')}
      `;
    case 'incidents':
      return `
        SELECT ${datePart('source_date')} AS day, COUNT(*) AS count
          FROM (SELECT disclosed_at AS source_date FROM aegis_incidents WHERE disclosed_at IS NOT NULL) i
          WHERE 1=1 ${sinceClause}
          GROUP BY ${datePart('source_date')}
      `;
    case 'breaches':
      return `
        SELECT ${datePart('source_date')} AS day, COUNT(*) AS count
          FROM (SELECT disclosed_at AS source_date FROM aegis_breach_disclosures WHERE disclosed_at IS NOT NULL) b
          WHERE 1=1 ${sinceClause}
          GROUP BY ${datePart('source_date')}
      `;
    case 'advisories':
      return `
        SELECT ${datePart('source_date')} AS day, COUNT(*) AS count
          FROM (SELECT published_at AS source_date FROM aegis_advisories WHERE published_at IS NOT NULL) a
          WHERE 1=1 ${sinceClause}
          GROUP BY ${datePart('source_date')}
      `;
    case 'geo_events':
      return `
        SELECT ${datePart('source_date')} AS day, COUNT(*) AS count
          FROM (SELECT occurred_at AS source_date FROM aegis_geo_threat_events WHERE occurred_at IS NOT NULL) g
          WHERE 1=1 ${sinceClause}
          GROUP BY ${datePart('source_date')}
      `;
  }
}

/**
 * UPSERT a zero-count row for every calendar day in the window that doesn't
 * already have an aegis_daily_metrics entry. The Kalman filter assumes a
 * continuous daily time series; missing days would inject NaN into the
 * state update step.
 *
 * Uses generate_series to enumerate dates server-side — no app-layer loop.
 */
async function fillMissingDays(windowDays: number): Promise<number> {
  const result = await query(
    `INSERT INTO aegis_daily_metrics (date, kev_adds, incidents, breaches, advisories, geo_events, created_at, updated_at)
     SELECT d::date, 0, 0, 0, 0, 0, NOW(), NOW()
       FROM generate_series(CURRENT_DATE - INTERVAL '1 day' * $1, CURRENT_DATE, INTERVAL '1 day') AS d
     ON CONFLICT (date) DO NOTHING`,
    [windowDays],
  );
  return result.rowCount ?? 0;
}
