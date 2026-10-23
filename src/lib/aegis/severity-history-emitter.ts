/**
 * Phase 11.A.3 — CVE severity-history event emitter.
 *
 * `aegis_cve_severity_history` is the observation stream the HMM (Phase
 * 11.C.7) reads to infer lifecycle state. Pre-Phase-11 the table existed
 * but no production code path wrote to it. The Phase 11.A.1 EPSS collector
 * was the first writer (event_type='epss_update' for >=5pt percentile
 * shifts); this module is the second — a shared helper any future write
 * path can call to log a discrete lifecycle event.
 *
 * Today there is exactly ONE call site outside the EPSS collector: the
 * `cve.kev_added` post-processing in src/lib/agent/activation.ts. That
 * trigger is the live signal that a CVE just transitioned into the KEV.
 *
 * The NVD bulk historical backfill (Phase 11.A.2, scripts/backfill-nvd-
 * history.ts) calls this helper too — once per discrete event detected in
 * the dumps. After backfill the table has years of training data; from
 * then on the live triggers (this emitter from activation.ts + the EPSS
 * collector + future ingestion paths) keep it self-maintaining.
 *
 * Event types — keep this set in sync with the HMM observation vocabulary
 * in src/lib/aegis/forecasting/cve-lifecycle-hmm.ts:
 *
 *   published            — first NVD publish detected
 *   poc_published        — public proof-of-concept code surfaced
 *   epss_update          — EPSS percentile shifted >=5pts (emitted by epss.ts)
 *   kev_added            — CISA added the CVE to KEV
 *   ioc_published        — abuse.ch / IOC feed linked an indicator to this CVE
 *   exploited_in_wild    — incident report references this CVE
 *   patched              — vendor remediation released (links via aegis_remediations)
 *   severity_change_up   — CVSS revised upward
 *   severity_change_down — CVSS revised downward
 *
 * Adding a new event_type means: (1) add it to the union below, (2) update
 * the HMM emission vocabulary, (3) re-train the HMM (the v0_1 model file
 * won't have a column for an unseen emission).
 */

import { query } from '@/lib/db/client';

// ─── Public surface ──────────────────────────────────────────────────────────

export type SeverityEventType =
  | 'published'
  | 'poc_published'
  | 'epss_update'
  | 'kev_added'
  | 'ioc_published'
  | 'exploited_in_wild'
  | 'patched'
  | 'severity_change_up'
  | 'severity_change_down';

export interface SeverityEventInput {
  cveId: string;
  eventType: SeverityEventType;
  /**
   * When the event was observed. Either an ISO timestamp string or a Date.
   * If omitted, defaults to NOW(). The table stores TEXT in
   * `YYYY-MM-DD HH:MM:SS` format — we convert via formatObservedAt().
   */
  observedAt?: string | Date;
  cvssScore?: number;
  epssScore?: number;
  epssPercentile?: number;
  /**
   * Identifier of the system that detected the event. Free-text by design
   * — 'nvd_backfill' / 'cisa_kev_poll' / 'activation.kev_added' / 'abuse_ch'.
   * Helpful for debugging which path inserted a given row.
   */
  source: string;
}

export interface EmitResult {
  ok: boolean;
  reason?: 'invalid_input' | 'db_error';
  errorMessage?: string;
}

/**
 * INSERT one row into aegis_cve_severity_history. Validates inputs +
 * fail-soft on DB error so callers never have to wrap in try/catch.
 *
 * Idempotency: the table has no UNIQUE constraint across (cve_id,
 * event_type, observed_at) — by design, a CVE can have multiple events of
 * the same type at different times (e.g., multiple poc_published events
 * if separate POCs surface). Callers that want at-most-once semantics
 * should check existence before calling.
 */
export async function emitSeverityEvent(input: SeverityEventInput): Promise<EmitResult> {
  // Validation — defensive because TS types alone don't enforce runtime shape
  // when the caller threads dynamic values through.
  if (!input.cveId || typeof input.cveId !== 'string') {
    return { ok: false, reason: 'invalid_input', errorMessage: 'cveId required' };
  }
  if (!isValidEventType(input.eventType)) {
    return {
      ok: false,
      reason: 'invalid_input',
      errorMessage: `unknown event_type: ${input.eventType}`,
    };
  }
  if (input.cvssScore != null && (input.cvssScore < 0 || input.cvssScore > 10)) {
    return { ok: false, reason: 'invalid_input', errorMessage: 'cvssScore out of [0,10]' };
  }
  if (input.epssScore != null && (input.epssScore < 0 || input.epssScore > 1)) {
    return { ok: false, reason: 'invalid_input', errorMessage: 'epssScore out of [0,1]' };
  }
  if (input.epssPercentile != null && (input.epssPercentile < 0 || input.epssPercentile > 1)) {
    return { ok: false, reason: 'invalid_input', errorMessage: 'epssPercentile out of [0,1]' };
  }

  const observedAt = formatObservedAt(input.observedAt);

  try {
    await query(
      `INSERT INTO aegis_cve_severity_history
         (cve_id, observed_at, cvss_score, epss_score, epss_percentile, event_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.cveId,
        observedAt,
        input.cvssScore ?? null,
        input.epssScore ?? null,
        input.epssPercentile ?? null,
        input.eventType,
        input.source,
      ],
    );
    return { ok: true };
  } catch (err) {
    // Fail-soft. The cve_id FK might fail if we're emitting for a CVE we
    // don't have a row for yet — common during the NVD backfill before the
    // aegis_cves UPSERT completes. Caller can choose to retry or skip.
    return {
      ok: false,
      reason: 'db_error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

const VALID_EVENT_TYPES: ReadonlySet<SeverityEventType> = new Set([
  'published',
  'poc_published',
  'epss_update',
  'kev_added',
  'ioc_published',
  'exploited_in_wild',
  'patched',
  'severity_change_up',
  'severity_change_down',
]);

function isValidEventType(value: unknown): value is SeverityEventType {
  return typeof value === 'string' && VALID_EVENT_TYPES.has(value as SeverityEventType);
}

/**
 * Format observedAt to the codebase's TEXT-timestamp convention
 * (`YYYY-MM-DD HH:MM:SS`). Accepts ISO strings, Date objects, or undefined
 * (defaults to NOW).
 */
function formatObservedAt(value: string | Date | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    // Bad input → fall back to NOW rather than insert a garbage timestamp.
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
