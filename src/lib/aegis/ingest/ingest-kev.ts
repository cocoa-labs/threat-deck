import { fetchKevCatalog } from '@/lib/data/collectors/cve-feed';
import { dataProvenance } from '@/lib/data/provenance';
import { query } from '@/lib/db/client';
import { recordRun } from './cursor';
import type { IngestSummary } from './ingest-cves';

/** timestamptz columns reject ''. Coerce blank/missing date strings to null. */
function nullDate(s: string | undefined | null): string | null {
  return s?.trim() ? s : null;
}

/**
 * CISA KEV ingestion. Pulls the catalog (up to 500) via the existing collector
 * (which already maps the raw CISA JSON to the camelCase `KEV` type, falls back
 * to demo data on failure, and never throws), UPSERTs each entry into
 * `aegis_kev`, then flips `aegis_cves.is_kev`.
 *
 * The UPSERT SQL is the verbatim statement from
 * scripts/backfill-nvd-history.ts. `aegis_kev.cve_id` FKs to
 * `aegis_cves(cve_id)`, so a KEV for a CVE we don't have yet raises a
 * foreign-key error — caught per-row and soft-skipped (a later CVE ingest may
 * add the missing row). The orchestrator (Task 1.8) runs `ingestCves` first, so
 * most CVEs will already exist. Only non-FK errors propagate to fail the run.
 */
export async function ingestKev(): Promise<IngestSummary> {
  let upserted = 0;
  try {
    const kevs = await fetchKevCatalog(500);
    for (const k of kevs) {
      if (dataProvenance(k).state === 'demo') continue;
      try {
        await query(
          `INSERT INTO aegis_kev
             (cve_id, added_to_kev_at, due_date, required_action, vulnerability_name, vendor_project, product, short_description, known_ransomware_use)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (cve_id) DO UPDATE
             SET due_date = EXCLUDED.due_date, required_action = EXCLUDED.required_action,
                 vulnerability_name = EXCLUDED.vulnerability_name, vendor_project = EXCLUDED.vendor_project,
                 product = EXCLUDED.product, short_description = EXCLUDED.short_description,
                 known_ransomware_use = EXCLUDED.known_ransomware_use`,
          [
            k.cveId,
            nullDate(k.addedToKevAt),
            nullDate(k.dueDate),
            k.requiredAction ?? null,
            k.vulnerabilityName ?? null,
            k.vendorProject ?? null,
            k.product ?? null,
            k.shortDescription ?? null,
            k.knownRansomwareUse ?? null,
          ],
        );
        await query(
          `UPDATE aegis_cves SET is_kev = TRUE, kev_added_date = $1 WHERE cve_id = $2 AND (is_kev = FALSE OR kev_added_date IS NULL)`,
          [nullDate(k.addedToKevAt), k.cveId],
        );
        upserted++;
      } catch (err) {
        // FK violation = CVE not in our table yet; soft-skip (a later CVE ingest may add it)
        if (!(err instanceof Error && /foreign key/i.test(err.message))) throw err;
      }
    }
    await recordRun('kev', { count: upserted, ok: true });
    return { source: 'kev', upserted, ok: true };
  } catch (err) {
    await recordRun('kev', {
      count: upserted,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return { source: 'kev', upserted, ok: false, reason: 'error' };
  }
}
