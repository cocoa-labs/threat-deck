/**
 * Tests for the Phase 11.A.3 severity-history emitter.
 *
 * The emitter is a thin shared write helper called from (a) the NVD bulk
 * backfill script, (b) the activation.ts cve.kev_added trigger, and (c)
 * any future ingestion path. These tests pin down the validation +
 * insert + fail-soft behaviour so future call sites can trust the helper
 * to never throw and to reject bad inputs cleanly.
 *
 * Hits the live dev Postgres. Uses a transient source marker so cleanup
 * deletes only rows this suite created.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { emitSeverityEvent } from './severity-history-emitter';

const TEST_SOURCE = 'test:severity-history-emitter';
// SEED_CVE — confirmed live in seed via earlier psql check.
const SEED_CVE = 'CVE-2024-26229';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_cve_severity_history WHERE source = $1`, [TEST_SOURCE]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('emitSeverityEvent — happy path', () => {
  it('INSERTs a row with the expected columns when given valid input', async () => {
    const result = await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'kev_added',
      cvssScore: 9.8,
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(true);

    const { rows } = await query<{
      cve_id: string;
      event_type: string;
      cvss_score: number;
      source: string;
      observed_at: string;
    }>(
      `SELECT cve_id, event_type, cvss_score, source, observed_at
         FROM aegis_cve_severity_history
        WHERE source = $1`,
      [TEST_SOURCE],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cve_id).toBe(SEED_CVE);
    expect(rows[0]!.event_type).toBe('kev_added');
    expect(rows[0]!.cvss_score).toBe(9.8);
    expect(rows[0]!.source).toBe(TEST_SOURCE);
    // observed_at defaults to NOW(). Post-Phase-13 the column is
    // TIMESTAMPTZ so pg returns a JS Date; we assert it's recent.
    const observedDate = new Date(rows[0]!.observed_at);
    expect(Number.isFinite(observedDate.getTime())).toBe(true);
    expect(Math.abs(Date.now() - observedDate.getTime())).toBeLessThan(60_000);
  });

  it('accepts an explicit observedAt (ISO string)', async () => {
    const iso = '2024-03-29T12:34:56.789Z';
    const result = await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'published',
      observedAt: iso,
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(true);

    const { rows } = await query<{ observed_at: string | Date }>(
      `SELECT observed_at FROM aegis_cve_severity_history WHERE source = $1`,
      [TEST_SOURCE],
    );
    // TIMESTAMPTZ column → pg returns Date. The emitter formats
    // observedAt to seconds precision before insert, so we compare the
    // truncated-to-seconds value.
    const observedMs = new Date(rows[0]!.observed_at).getTime();
    expect(observedMs).toBe(Date.parse('2024-03-29T12:34:56Z'));
  });

  it('accepts an explicit observedAt (Date)', async () => {
    const date = new Date('2024-06-15T08:00:00Z');
    const result = await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'poc_published',
      observedAt: date,
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(true);

    const { rows } = await query<{ observed_at: string | Date }>(
      `SELECT observed_at FROM aegis_cve_severity_history WHERE source = $1`,
      [TEST_SOURCE],
    );
    const observedMs = new Date(rows[0]!.observed_at).getTime();
    expect(observedMs).toBe(Date.parse('2024-06-15T08:00:00Z'));
  });

  it('persists optional epss fields when provided', async () => {
    await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'epss_update',
      epssScore: 0.42,
      epssPercentile: 0.87,
      source: TEST_SOURCE,
    });

    const { rows } = await query<{ epss_score: number; epss_percentile: number }>(
      `SELECT epss_score, epss_percentile FROM aegis_cve_severity_history WHERE source = $1`,
      [TEST_SOURCE],
    );
    expect(rows[0]!.epss_score).toBeCloseTo(0.42, 3);
    expect(rows[0]!.epss_percentile).toBeCloseTo(0.87, 3);
  });
});

describe('emitSeverityEvent — validation', () => {
  it('rejects empty cveId', async () => {
    const result = await emitSeverityEvent({
      cveId: '',
      eventType: 'kev_added',
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_input');
  });

  it('rejects an unknown event_type', async () => {
    const result = await emitSeverityEvent({
      cveId: SEED_CVE,
      // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime invalid value to test guard
      eventType: 'bogus_event' as any,
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_input');
    expect(result.errorMessage).toContain('bogus_event');
  });

  it('rejects out-of-range cvssScore', async () => {
    const result = await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'severity_change_up',
      cvssScore: 11,
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_input');
  });

  it('rejects out-of-range epssScore', async () => {
    const result = await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'epss_update',
      epssScore: 1.5,
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_input');
  });

  it('rejects out-of-range epssPercentile (negative)', async () => {
    const result = await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'epss_update',
      epssPercentile: -0.1,
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_input');
  });
});

describe('emitSeverityEvent — fail-soft on DB errors', () => {
  it('returns ok:false with reason:db_error when FK target does not exist', async () => {
    const result = await emitSeverityEvent({
      cveId: 'CVE-9999-99999', // not in aegis_cves → FK violation
      eventType: 'kev_added',
      source: TEST_SOURCE,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('db_error');
    // FK violation message varies by pg version; just ensure SOMETHING is there
    expect(result.errorMessage).toBeTruthy();
  });
});

describe('emitSeverityEvent — idempotency contract', () => {
  it('allows multiple rows of the same event_type at different times (no UNIQUE)', async () => {
    // The schema deliberately has NO UNIQUE constraint across (cve_id,
    // event_type, observed_at) — multiple events of the same kind are
    // expected (e.g., multiple poc_published when separate POCs surface).
    // This test pins that down so a future migration that ADDs a unique
    // constraint breaks loudly here.
    await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'poc_published',
      observedAt: '2024-01-01T00:00:00Z',
      source: TEST_SOURCE,
    });
    await emitSeverityEvent({
      cveId: SEED_CVE,
      eventType: 'poc_published',
      observedAt: '2024-02-01T00:00:00Z',
      source: TEST_SOURCE,
    });

    const { rows } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM aegis_cve_severity_history WHERE source = $1`,
      [TEST_SOURCE],
    );
    expect(Number(rows[0]!.count)).toBe(2);
  });
});
