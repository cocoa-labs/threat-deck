/**
 * Tests for the Phase 11.A.1 EPSS ingestion collector.
 *
 * Two layers of tests:
 *
 *   1. **Unit-style** via `_applyEpssRowForTests` — exercises the validation
 *      + UPDATE + severity_history emission logic on a SPECIFIC CVE without
 *      going through `selectCvesToRefresh` (which picks a non-deterministic
 *      CVE from the seed list).
 *
 *   2. **Integration** via `refreshEpss` — asserts the orchestration story:
 *      rate-limit denial, fetch failure handling, idempotency via cache.
 *      We do NOT assert specific row updates in this layer since the batch
 *      selector is shared with `selectCvesToRefresh`.
 *
 * DB cleanup runs before + after each test. Test marker: source='first_org'
 * on emitted severity_history rows + a guaranteed-NULL-EPSS reset on the
 * seeded CVE we exercise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

// SEED_CVE_NEVER_KEV is CVE-2024-26229. Confirmed live: is_kev=false, EPSS=NULL
// at seed time. It's the same CVE the migrations test suite uses for the
// top_likely_exploits view test.
const SEED_CVE_NEVER_KEV = 'CVE-2024-26229';

async function cleanup(): Promise<void> {
  await query(`UPDATE aegis_cves SET epss_score = NULL, epss_percentile = NULL WHERE cve_id = $1`, [
    SEED_CVE_NEVER_KEV,
  ]);
  await query(
    `DELETE FROM aegis_cve_severity_history
       WHERE source = 'first_org'
         AND event_type = 'epss_update'
         AND cve_id = $1`,
    [SEED_CVE_NEVER_KEV],
  );
}

beforeEach(cleanup);
afterEach(cleanup);

// ─── Unit-style: applyEpssRow direct ────────────────────────────────────────

describe('applyEpssRow — validation + emission', () => {
  it('returns a result, UPDATEs the row, and emits a history event on first observation', async () => {
    const { _applyEpssRowForTests } = await import('./epss');
    const result = await _applyEpssRowForTests({
      cve: SEED_CVE_NEVER_KEV,
      epss: '0.345',
      percentile: '0.876',
      date: '2026-05-25',
    });

    expect(result).not.toBeNull();
    expect(result?.nextScore).toBeCloseTo(0.345, 3);
    expect(result?.nextPercentile).toBeCloseTo(0.876, 3);
    expect(result?.prevPercentile).toBeNull(); // pre-test state via cleanup
    // NULL → any score counts as a "first observation" → history row emitted
    expect(result?.emittedHistoryEvent).toBe(true);

    // Verify the UPDATE landed
    const { rows } = await query<{ epss_score: number; epss_percentile: number }>(
      `SELECT epss_score, epss_percentile FROM aegis_cves WHERE cve_id = $1`,
      [SEED_CVE_NEVER_KEV],
    );
    expect(rows[0]?.epss_score).toBeCloseTo(0.345, 3);
    expect(rows[0]?.epss_percentile).toBeCloseTo(0.876, 3);

    // Verify the history row landed
    const { rows: history } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM aegis_cve_severity_history
         WHERE cve_id = $1 AND event_type = 'epss_update' AND source = 'first_org'`,
      [SEED_CVE_NEVER_KEV],
    );
    expect(Number(history[0]!.count)).toBe(1);
  });

  it('returns null + does NOT UPDATE for non-numeric score', async () => {
    const { _applyEpssRowForTests } = await import('./epss');
    const result = await _applyEpssRowForTests({
      cve: SEED_CVE_NEVER_KEV,
      epss: 'not-a-number',
      percentile: '0.5',
      date: '2026-05-25',
    });
    expect(result).toBeNull();

    // aegis_cves untouched
    const { rows } = await query<{ epss_score: number | null }>(
      `SELECT epss_score FROM aegis_cves WHERE cve_id = $1`,
      [SEED_CVE_NEVER_KEV],
    );
    expect(rows[0]?.epss_score).toBeNull();
  });

  it('returns null + does NOT UPDATE for out-of-range score (>1)', async () => {
    const { _applyEpssRowForTests } = await import('./epss');
    const result = await _applyEpssRowForTests({
      cve: SEED_CVE_NEVER_KEV,
      epss: '1.5',
      percentile: '0.5',
      date: '2026-05-25',
    });
    expect(result).toBeNull();
  });

  it('returns null + does NOT UPDATE for negative percentile', async () => {
    const { _applyEpssRowForTests } = await import('./epss');
    const result = await _applyEpssRowForTests({
      cve: SEED_CVE_NEVER_KEV,
      epss: '0.5',
      percentile: '-0.1',
      date: '2026-05-25',
    });
    expect(result).toBeNull();
  });

  it('returns null when the CVE is not in our DB', async () => {
    const { _applyEpssRowForTests } = await import('./epss');
    const result = await _applyEpssRowForTests({
      cve: 'CVE-9999-99999',
      epss: '0.5',
      percentile: '0.5',
      date: '2026-05-25',
    });
    expect(result).toBeNull();
  });

  it('UPDATEs but SKIPS history emission when percentile shift < 5pts', async () => {
    // Seed an initial percentile so the shift comparison has a baseline.
    await query(
      `UPDATE aegis_cves SET epss_score = 0.5, epss_percentile = 0.85 WHERE cve_id = $1`,
      [SEED_CVE_NEVER_KEV],
    );

    const { _applyEpssRowForTests } = await import('./epss');
    const result = await _applyEpssRowForTests({
      cve: SEED_CVE_NEVER_KEV,
      epss: '0.52',
      percentile: '0.87', // 0.02 shift — below 0.05 threshold
      date: '2026-05-25',
    });

    expect(result).not.toBeNull();
    expect(result?.emittedHistoryEvent).toBe(false);

    // UPDATE landed
    const { rows } = await query<{ epss_percentile: number }>(
      `SELECT epss_percentile FROM aegis_cves WHERE cve_id = $1`,
      [SEED_CVE_NEVER_KEV],
    );
    expect(rows[0]?.epss_percentile).toBeCloseTo(0.87, 3);

    // History row NOT emitted (sub-threshold shift)
    const { rows: history } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM aegis_cve_severity_history
         WHERE cve_id = $1 AND event_type = 'epss_update' AND source = 'first_org'`,
      [SEED_CVE_NEVER_KEV],
    );
    expect(Number(history[0]!.count)).toBe(0);
  });

  it('emits history event when percentile shift >= 5pts', async () => {
    await query(
      `UPDATE aegis_cves SET epss_score = 0.5, epss_percentile = 0.20 WHERE cve_id = $1`,
      [SEED_CVE_NEVER_KEV],
    );

    const { _applyEpssRowForTests } = await import('./epss');
    const result = await _applyEpssRowForTests({
      cve: SEED_CVE_NEVER_KEV,
      epss: '0.7',
      percentile: '0.85', // 0.65 shift — way above threshold
      date: '2026-05-25',
    });

    expect(result).not.toBeNull();
    expect(result?.emittedHistoryEvent).toBe(true);

    const { rows: history } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM aegis_cve_severity_history
         WHERE cve_id = $1 AND event_type = 'epss_update' AND source = 'first_org'`,
      [SEED_CVE_NEVER_KEV],
    );
    expect(Number(history[0]!.count)).toBe(1);
  });
});

// ─── Integration: refreshEpss orchestration ──────────────────────────────────

describe('refreshEpss — orchestration', () => {
  it('returns rate_limited reason when the budget is exhausted', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/rate-limiter', async () => {
      const actual =
        await vi.importActual<typeof import('@/lib/data/rate-limiter')>('@/lib/data/rate-limiter');
      return {
        ...actual,
        checkRateLimit: () => false,
        getCached: async () => null,
        setCache: async () => {},
      };
    });
    const { refreshEpss } = await import('./epss');
    const summary = await refreshEpss(10);
    expect(summary.ok).toBe(false);
    expect(summary.reason).toBe('rate_limited');
    expect(summary.updated).toBe(0);
    vi.doUnmock('@/lib/data/rate-limiter');
  });

  it('returns ok:false when the API returns non-OK across all batches', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/rate-limiter', async () => {
      const actual =
        await vi.importActual<typeof import('@/lib/data/rate-limiter')>('@/lib/data/rate-limiter');
      return {
        ...actual,
        checkRateLimit: () => true,
        getCached: async () => null,
        setCache: async () => {},
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      })),
    );
    const { refreshEpss } = await import('./epss');
    const summary = await refreshEpss(1);
    expect(summary.ok).toBe(false);
    expect(summary.updated).toBe(0);
    vi.doUnmock('@/lib/data/rate-limiter');
    vi.unstubAllGlobals();
  });

  it('short-circuits via cache on repeat calls within window (idempotent)', async () => {
    vi.resetModules();
    let cacheSlot: unknown = null;
    vi.doMock('@/lib/data/rate-limiter', async () => {
      const actual =
        await vi.importActual<typeof import('@/lib/data/rate-limiter')>('@/lib/data/rate-limiter');
      return {
        ...actual,
        checkRateLimit: () => false, // force rate_limited so updated=0 path is deterministic
        getCached: async () => cacheSlot,
        setCache: async (_k: string, v: unknown) => {
          cacheSlot = v;
        },
      };
    });
    const { refreshEpss } = await import('./epss');
    const first = await refreshEpss(1);
    expect(first.reason).toBe('rate_limited');
    // Cache wasn't set in the rate_limited branch — second call still hits
    // the rate-limit check. Now flip the cache to confirm the short-circuit.
    cacheSlot = { ok: true, updated: 7, emittedHistoryEvents: 2, batches: 1 };
    const second = await refreshEpss(1);
    expect(second.updated).toBe(7);
    expect(second.ok).toBe(true);
    vi.doUnmock('@/lib/data/rate-limiter');
  });
});
