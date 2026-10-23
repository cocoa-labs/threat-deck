import { query } from '@/lib/db/client';
import { getCursor, recordRun } from './cursor';
import { fetchNvdWindow } from './nvd-client';
import { nvdToCveRow } from './nvd-map';

export interface IngestSummary {
  source: string;
  upserted: number;
  ok: boolean;
  reason?: string;
}

type CveRow = ReturnType<typeof nvdToCveRow>;

/**
 * UPSERT one CVE row into aegis_cves. The SQL is the verbatim statement from
 * scripts/backfill-nvd-history.ts — `RETURNING (xmax = 0) AS inserted` reports
 * `true` on a fresh INSERT and `false` on an ON CONFLICT UPDATE (xmax is 0 for
 * newly-inserted rows no transaction has yet modified).
 */
async function upsertCveRow(r: CveRow): Promise<boolean> {
  const { rows } = await query<{ inserted: boolean }>(
    `INSERT INTO aegis_cves
       (cve_id, published_at, last_modified_at, summary, cwe_id, cvss_v3_score, cvss_v3_vector, severity, nvd_source_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (cve_id) DO UPDATE
       SET last_modified_at = EXCLUDED.last_modified_at, summary = EXCLUDED.summary, cwe_id = EXCLUDED.cwe_id,
           cvss_v3_score = EXCLUDED.cvss_v3_score, cvss_v3_vector = EXCLUDED.cvss_v3_vector, severity = EXCLUDED.severity
     RETURNING (xmax = 0) AS inserted`,
    [
      r.cveId,
      r.publishedAt,
      r.lastModifiedAt,
      r.summary,
      r.cweId,
      r.score,
      r.vector,
      r.severity,
      r.sourceUrl,
    ],
  );
  return rows[0]?.inserted ?? false;
}

/** Internal export for unit tests (mirrors `_applyEpssRowForTests`). */
export const _upsertCveRowForTests = upsertCveRow;

/**
 * NVD delta ingestion. Window = [lastCursor ?? now-24h, now]. UPSERTs every CVE
 * lastModified in the window into aegis_cves, then advances the cursor to `now`
 * (endISO) on success. Never throws — records a failed run on error.
 */
export async function ingestCves(): Promise<IngestSummary> {
  const now = new Date();
  const cursor = await getCursor('cves');
  const startISO = cursor ?? new Date(now.getTime() - 24 * 3600_000).toISOString();
  const endISO = now.toISOString();
  let upserted = 0;
  try {
    const cves = await fetchNvdWindow(startISO, endISO);
    for (const item of cves) {
      await upsertCveRow(nvdToCveRow(item));
      upserted++;
    }
    await recordRun('cves', { cursor: endISO, count: upserted, ok: true });
    return { source: 'cves', upserted, ok: true };
  } catch (err) {
    await recordRun('cves', {
      count: upserted,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return { source: 'cves', upserted, ok: false, reason: 'error' };
  }
}
