/**
 * Tests for the Phase 11.A.4 time-series aggregation refresh.
 *
 * The refresh function runs nightly via cron — its job is to keep
 * `aegis_daily_metrics` in sync with the source tables (aegis_kev,
 * aegis_incidents, aegis_breach_disclosures, aegis_advisories,
 * aegis_geo_threat_events). These tests pin down:
 *
 *   - one pass UPSERTs the daily counts correctly
 *   - re-running is idempotent (same counts, no duplication)
 *   - days with zero events get a filled row (continuous time series)
 *   - the per-metric counts in the result match what was UPSERTed
 *
 * Cleanup: refreshAggregations writes to aegis_daily_metrics for every
 * day in the trailing window. Tests clean up by deleting rows for any
 * far-future test date we inserted into a source table, then trusting
 * the refresh to leave the rest alone.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { refreshAggregations } from './aggregations';

// Test inserts target a future date well outside the seed window so we
// don't collide with real seeded events.
const TEST_DATE = '2099-01-15';

async function cleanup(): Promise<void> {
  // Remove any test rows from source tables. Pre-Phase-13 these columns
  // were TEXT and we used `LIKE '2099-%'`; migration 011 converted them
  // to TIMESTAMPTZ, so we range-filter on the calendar year now.
  const TEST_YEAR_START = '2099-01-01';
  const TEST_YEAR_END = '2100-01-01';
  await query(`DELETE FROM aegis_kev WHERE added_to_kev_at >= $1 AND added_to_kev_at < $2`, [
    TEST_YEAR_START,
    TEST_YEAR_END,
  ]);
  await query(`DELETE FROM aegis_incidents WHERE disclosed_at >= $1 AND disclosed_at < $2`, [
    TEST_YEAR_START,
    TEST_YEAR_END,
  ]);
  await query(
    `DELETE FROM aegis_breach_disclosures WHERE disclosed_at >= $1 AND disclosed_at < $2`,
    [TEST_YEAR_START, TEST_YEAR_END],
  );
  await query(`DELETE FROM aegis_advisories WHERE published_at >= $1 AND published_at < $2`, [
    TEST_YEAR_START,
    TEST_YEAR_END,
  ]);
  await query(`DELETE FROM aegis_geo_threat_events WHERE occurred_at >= $1 AND occurred_at < $2`, [
    TEST_YEAR_START,
    TEST_YEAR_END,
  ]);
  // Remove daily_metrics rows for the test date (zero-fill or otherwise).
  await query(`DELETE FROM aegis_daily_metrics WHERE date = $1`, [TEST_DATE]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('refreshAggregations — counts source rows correctly', () => {
  it('counts KEV adds for the test date', async () => {
    // Seed 2 KEV rows on the test date. Use a unique CVE id namespace so we
    // don't clash with seed data. CVE IDs are TEXT — anything goes.
    // First we need an aegis_cves row to satisfy the FK.
    await query(
      `INSERT INTO aegis_cves (cve_id, published_at)
       VALUES ('CVE-TEST-AGG-1', '2099-01-01')
       ON CONFLICT (cve_id) DO NOTHING`,
    );
    await query(
      `INSERT INTO aegis_cves (cve_id, published_at)
       VALUES ('CVE-TEST-AGG-2', '2099-01-01')
       ON CONFLICT (cve_id) DO NOTHING`,
    );
    await query(
      `INSERT INTO aegis_kev (cve_id, added_to_kev_at)
       VALUES ('CVE-TEST-AGG-1', $1)`,
      [`${TEST_DATE} 10:00:00`],
    );
    await query(
      `INSERT INTO aegis_kev (cve_id, added_to_kev_at)
       VALUES ('CVE-TEST-AGG-2', $1)`,
      [`${TEST_DATE} 14:00:00`],
    );

    // Use a window that includes our future date. CURRENT_DATE - 730d to
    // CURRENT_DATE doesn't include 2099 — we need a much wider window OR
    // use an explicit override. Since refreshAggregations takes windowDays,
    // we pass an explicit very-large number that reaches into 2099.
    // 2099-01-15 is ~75 years in the future. CURRENT_DATE is 2026-05-25.
    // So we need windowDays = (2099 - 2026)*365 ~= 26695 days from CURRENT_DATE.
    // BUT — the source SQL filters by `>= CURRENT_DATE - windowDays`, so a
    // FUTURE date is always >= than that filter (TRUE). So any windowDays
    // value works. Use 365 (default-ish).
    //
    // Wait — the filter is `>= CURRENT_DATE - INTERVAL '730 days'`. For a
    // 2099 date, this is trivially true (2099-01-15 >= 2024-anything). So
    // the filter passes. Good.
    await refreshAggregations(730);

    const { rows } = await query<{ kev_adds: number }>(
      `SELECT kev_adds FROM aegis_daily_metrics WHERE date = $1`,
      [TEST_DATE],
    );
    expect(rows[0]?.kev_adds).toBe(2);

    // Cleanup the FK-linked CVE rows.
    await query(`DELETE FROM aegis_cves WHERE cve_id LIKE 'CVE-TEST-AGG-%'`);
  });

  it('counts breach disclosures for the test date', async () => {
    await query(
      `INSERT INTO aegis_breach_disclosures (disclosed_at)
       VALUES ($1)`,
      [`${TEST_DATE} 09:00:00`],
    );
    await query(
      `INSERT INTO aegis_breach_disclosures (disclosed_at)
       VALUES ($1)`,
      [TEST_DATE],
    );
    await query(
      `INSERT INTO aegis_breach_disclosures (disclosed_at)
       VALUES ($1)`,
      [`${TEST_DATE} 23:59:00`],
    );

    await refreshAggregations(730);
    const { rows } = await query<{ breaches: number }>(
      `SELECT breaches FROM aegis_daily_metrics WHERE date = $1`,
      [TEST_DATE],
    );
    expect(rows[0]?.breaches).toBe(3);
  });

  it('counts advisories for the test date', async () => {
    // aegis_advisories has NOT NULL on (issuer, published_at) — supply both.
    await query(
      `INSERT INTO aegis_advisories (issuer, published_at)
       VALUES ('test:agg', $1)`,
      [`${TEST_DATE} 12:00:00`],
    );
    await refreshAggregations(730);
    const { rows } = await query<{ advisories: number }>(
      `SELECT advisories FROM aegis_daily_metrics WHERE date = $1`,
      [TEST_DATE],
    );
    expect(rows[0]?.advisories).toBe(1);
  });

  it('counts geo threat events for the test date', async () => {
    // aegis_geo_threat_events requires (event_type, latitude, longitude, occurred_at).
    await query(
      `INSERT INTO aegis_geo_threat_events (event_type, latitude, longitude, occurred_at)
       VALUES ('test:agg', 0, 0, $1)`,
      [TEST_DATE],
    );
    await refreshAggregations(730);
    const { rows } = await query<{ geo_events: number }>(
      `SELECT geo_events FROM aegis_daily_metrics WHERE date = $1`,
      [TEST_DATE],
    );
    expect(rows[0]?.geo_events).toBe(1);
  });
});

describe('refreshAggregations — idempotency + zero-fill', () => {
  it('is idempotent — re-running produces the same counts', async () => {
    await query(
      `INSERT INTO aegis_breach_disclosures (disclosed_at)
       VALUES ($1), ($1)`,
      [`${TEST_DATE} 09:00:00`],
    );

    await refreshAggregations(730);
    const { rows: first } = await query<{ breaches: number }>(
      `SELECT breaches FROM aegis_daily_metrics WHERE date = $1`,
      [TEST_DATE],
    );
    expect(first[0]?.breaches).toBe(2);

    await refreshAggregations(730);
    const { rows: second } = await query<{ breaches: number }>(
      `SELECT breaches FROM aegis_daily_metrics WHERE date = $1`,
      [TEST_DATE],
    );
    // Same count — UPSERT replaced the row, didn't double it.
    expect(second[0]?.breaches).toBe(2);
  });

  it('zero-fills CURRENT_DATE if no source events exist on it', async () => {
    // With cleanup() emptying our test-date rows, refreshing should produce
    // a CURRENT_DATE row with all-zero counts (zero-fill ensures the
    // time series is continuous for Kalman).
    await refreshAggregations(730);
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await query<{
      kev_adds: number;
      incidents: number;
      breaches: number;
      advisories: number;
      geo_events: number;
    }>(
      `SELECT kev_adds, incidents, breaches, advisories, geo_events
         FROM aegis_daily_metrics WHERE date = $1`,
      [today],
    );
    expect(rows[0]).toBeDefined();
    // At minimum the zero-fill ran. The actual values reflect any seeded
    // events for today (likely all zero in dev) — we just want a row.
    expect(rows[0]!.kev_adds).toBeGreaterThanOrEqual(0);
  });

  it('returns a populated perMetric report', async () => {
    await query(`INSERT INTO aegis_advisories (issuer, published_at) VALUES ('test:agg', $1)`, [
      `${TEST_DATE} 12:00:00`,
    ]);
    const result = await refreshAggregations(730);
    expect(result.perMetric).toBeDefined();
    expect(result.perMetric.advisories).toBeGreaterThanOrEqual(1);
    expect(result.ms).toBeGreaterThan(0);
  });
});
