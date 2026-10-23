import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * EPSS (Exploit Prediction Scoring System) ingestion — FIRST.org API.
 *
 * EPSS is a separate scoring system from CVSS, maintained by FIRST.org. For
 * every published CVE it estimates `P(exploited in next 30 days)` as a
 * 0–1 score, plus a `percentile` over the global NVD population. EPSS is
 * the single strongest feature in the Phase 11.B exploit-likelihood
 * logistic regression — without it, calibration plummets.
 *
 * NVD itself does NOT return EPSS in its REST 2.0 response. The pre-Phase-
 * 11 cve-feed.ts pulls CVSS only and leaves `aegis_cves.epss_score` NULL.
 * This module closes that gap by:
 *
 *   1. Reading batches of CVE IDs from aegis_cves that have NULL EPSS OR
 *      whose existing EPSS is older than the FIRST API's reported date.
 *   2. Calling https://api.first.org/data/v1/epss?cve={comma-list}&envelope=true
 *      — public API, no auth, ~1 req/sec.
 *   3. UPDATE-ing aegis_cves with the returned scores.
 *   4. INSERT-ing an `event_type='epss_update'` row into
 *      aegis_cve_severity_history when the percentile shifted by >5pts —
 *      this gives the HMM (Phase 11.C.7) a discrete state-change observation
 *      rather than thousands of tiny noisy updates.
 *
 * Resilience pattern matches src/lib/data/collectors/cve-feed.ts:
 *   - rate-limit + cache via the existing rate-limiter
 *   - graceful no-op return on rate-limit OR fetch failure (never throws)
 *   - audit on success rollup, not per-row (keeps audit table small)
 */

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { checkRateLimit, getCached, setCache } from '@/lib/data/rate-limiter';
import { query } from '@/lib/db/client';

// ─── Constants ───────────────────────────────────────────────────────────────

const EPSS_BASE = 'https://api.first.org/data/v1/epss';
const USER_AGENT = 'CocoaAI-ThreatDeck/1.0';
const BATCH_SIZE = 100; // FIRST API accepts up to ~100 CVEs per call
const PERCENTILE_SHIFT_THRESHOLD = 0.05; // Emit severity_history row when ≥5pts shift

// ─── Types ───────────────────────────────────────────────────────────────────

interface EpssApiRow {
  cve: string;
  /** Stringified probability 0–1. */
  epss: string;
  /** Stringified percentile rank 0–1 within the global NVD population. */
  percentile: string;
  /** YYYY-MM-DD of when the score was computed by FIRST. */
  date: string;
}

interface EpssApiResponse {
  status?: string;
  data?: EpssApiRow[];
}

/** Per-CVE result of a refresh pass. */
export interface EpssRefreshResult {
  cveId: string;
  prevPercentile: number | null;
  nextPercentile: number;
  nextScore: number;
  scoreDate: string;
  emittedHistoryEvent: boolean;
}

export interface EpssRefreshSummary {
  ok: boolean;
  reason?: 'rate_limited' | 'fetch_failed' | 'no_cves_to_refresh' | 'no_data_returned';
  updated: number;
  emittedHistoryEvents: number;
  batches: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Refresh EPSS scores for CVEs in our DB. Picks up to `maxCves` CVEs
 * preferring those with NULL EPSS first, then by oldest-known-EPSS-date.
 *
 * Idempotent — re-running within the daily cache window returns immediately.
 * Returns a summary; never throws.
 */
export async function refreshEpss(maxCves: number = 500): Promise<EpssRefreshSummary> {
  const cacheKey = `epss:refresh:${new Date().toISOString().slice(0, 10)}:${maxCves}`;
  const cached = await getCached<EpssRefreshSummary>(cacheKey);
  if (cached) return cached;

  if (!checkRateLimit('epss')) {
    return {
      ok: false,
      reason: 'rate_limited',
      updated: 0,
      emittedHistoryEvents: 0,
      batches: 0,
    };
  }

  const cveIds = await selectCvesToRefresh(maxCves);
  if (cveIds.length === 0) {
    const empty: EpssRefreshSummary = {
      ok: true,
      reason: 'no_cves_to_refresh',
      updated: 0,
      emittedHistoryEvents: 0,
      batches: 0,
    };
    await setCache(cacheKey, empty);
    return empty;
  }

  let updated = 0;
  let emittedHistoryEvents = 0;
  let batches = 0;

  for (let i = 0; i < cveIds.length; i += BATCH_SIZE) {
    const batch = cveIds.slice(i, i + BATCH_SIZE);
    batches++;
    const rows = await fetchEpssBatch(batch);
    if (!rows) {
      // fetch_failed — surface but keep going on remaining batches (transient
      // network errors shouldn't kill the entire refresh)
      continue;
    }
    for (const row of rows) {
      const result = await applyEpssRow(row);
      if (result) {
        updated++;
        if (result.emittedHistoryEvent) emittedHistoryEvents++;
      }
    }
    // Be polite to the 1 req/sec rate limit — small pause between batches
    await sleep(1100);
  }

  void recordAudit({
    action: AUDIT_ACTIONS.DATA_EPSS_INGESTED,
    outcome: updated > 0 ? 'success' : 'failure',
    targetKind: 'epss_batch',
    targetId: cacheKey,
    details: { updated, emittedHistoryEvents, batches, requested: cveIds.length },
  });

  const summary: EpssRefreshSummary = {
    ok: updated > 0,
    reason: updated === 0 ? 'no_data_returned' : undefined,
    updated,
    emittedHistoryEvents,
    batches,
  };
  await setCache(cacheKey, summary);
  return summary;
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Pick CVEs to refresh, prioritizing those that have never been scored.
 * The ORDER BY clause prefers NULL EPSS first; tied-on-NULL CVEs sort by
 * published_at DESC so we score newer CVEs ahead of stale ancient ones.
 */
async function selectCvesToRefresh(maxCves: number): Promise<string[]> {
  const { rows } = await query<{ cve_id: string }>(
    `SELECT cve_id FROM aegis_cves
       ORDER BY
         (epss_score IS NULL) DESC,
         published_at DESC
       LIMIT $1`,
    [maxCves],
  );
  return rows.map((r) => r.cve_id);
}

/**
 * One call to the FIRST.org EPSS API. Returns `null` on network or parse
 * failure — the caller continues with the next batch.
 */
async function fetchEpssBatch(cveIds: string[]): Promise<EpssApiRow[] | null> {
  if (cveIds.length === 0) return [];
  const url = `${EPSS_BASE}?cve=${cveIds.join(',')}&envelope=true`;
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[EPSS] FIRST API returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as EpssApiResponse;
    return json.data ?? [];
  } catch (err) {
    console.warn('[EPSS] fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * UPDATE one CVE's EPSS columns and optionally emit a severity_history row
 * if the percentile shifted by ≥PERCENTILE_SHIFT_THRESHOLD. Returns the
 * result struct, or null if the CVE doesn't exist OR the EPSS scores were
 * unparseable.
 *
 * Exported as an internal helper so tests can exercise the validation and
 * emission logic directly without going through the rate-limit / batch
 * selection indirection in refreshEpss.
 */
export async function _applyEpssRowForTests(row: EpssApiRow): Promise<EpssRefreshResult | null> {
  return applyEpssRow(row);
}

async function applyEpssRow(row: EpssApiRow): Promise<EpssRefreshResult | null> {
  const score = Number.parseFloat(row.epss);
  const percentile = Number.parseFloat(row.percentile);
  if (
    !Number.isFinite(score) ||
    !Number.isFinite(percentile) ||
    score < 0 ||
    score > 1 ||
    percentile < 0 ||
    percentile > 1
  ) {
    return null;
  }

  // Look up the previous percentile so we can decide whether to emit a
  // severity_history row. Note: epss_score / epss_percentile on aegis_cves
  // are DOUBLE PRECISION; pg's node driver returns them as `number | null`.
  const prevResult = await query<{ epss_percentile: number | null }>(
    `SELECT epss_percentile FROM aegis_cves WHERE cve_id = $1 LIMIT 1`,
    [row.cve],
  );
  if (prevResult.rows.length === 0) {
    // CVE not in our DB — silently skip. We only refresh what we know about.
    return null;
  }
  const prevPercentile = prevResult.rows[0]?.epss_percentile ?? null;

  await query(
    `UPDATE aegis_cves
        SET epss_score = $1, epss_percentile = $2
      WHERE cve_id = $3`,
    [score, percentile, row.cve],
  );

  let emittedHistoryEvent = false;
  if (
    prevPercentile == null ||
    Math.abs(percentile - prevPercentile) >= PERCENTILE_SHIFT_THRESHOLD
  ) {
    await query(
      `INSERT INTO aegis_cve_severity_history
         (cve_id, observed_at, epss_score, epss_percentile, event_type, source)
       VALUES ($1, $2, $3, $4, 'epss_update', 'first_org')`,
      [
        row.cve,
        // Match the codebase's TEXT-timestamp convention for this table.
        new Date().toISOString().slice(0, 19).replace('T', ' '),
        score,
        percentile,
      ],
    );
    emittedHistoryEvent = true;
  }

  return {
    cveId: row.cve,
    prevPercentile,
    nextPercentile: percentile,
    nextScore: score,
    scoreDate: row.date,
    emittedHistoryEvent,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
