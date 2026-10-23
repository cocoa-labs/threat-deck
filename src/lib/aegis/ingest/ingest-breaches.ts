import { fetchHibpBreaches } from '@/lib/data/collectors/breach-feed';
import { query } from '@/lib/db/client';
import { recordRun } from './cursor';
import type { IngestSummary } from './ingest-cves';

/** `disclosed_at` is `timestamp with time zone NOT NULL` — reject unparseable dates. */
function isValidDate(s: string | undefined | null): boolean {
  return !!s && !Number.isNaN(new Date(s).getTime());
}

/**
 * Breach-disclosure ingestion. Pulls from HIBP (`fetchHibpBreaches` maps to the
 * camelCase `BreachDisclosure` type, falls back to demo data, never throws) and
 * inserts into `aegis_breach_disclosures`.
 *
 * The table has **no UNIQUE constraint**, so there's no `ON CONFLICT`; instead we
 * dedup at the app level before each insert — by `source_url` when present, else
 * by `(disclosed_at, source)`. Rows whose `disclosedAt` is unparseable are
 * skipped (`disclosed_at` is `NOT NULL` timestamptz). `org_id` is left null in v1
 * (no org resolution yet).
 */
export async function ingestBreaches(): Promise<IngestSummary> {
  let upserted = 0;
  try {
    const breaches = await fetchHibpBreaches(100);

    for (const b of breaches) {
      if (!isValidDate(b.disclosedAt)) continue; // NOT NULL timestamptz.

      // App-level dedup (no UNIQUE constraint to lean on).
      let existing: { rowCount: number | null };
      if (b.sourceUrl) {
        existing = await query(`SELECT 1 FROM aegis_breach_disclosures WHERE source_url = $1`, [
          b.sourceUrl,
        ]);
      } else {
        existing = await query(
          `SELECT 1 FROM aegis_breach_disclosures WHERE disclosed_at = $1 AND source IS NOT DISTINCT FROM $2`,
          [b.disclosedAt, b.source ?? null],
        );
      }
      if ((existing.rowCount ?? 0) > 0) continue;

      await query(
        `INSERT INTO aegis_breach_disclosures
           (org_id, disclosed_at, source, source_url, breach_type, records_compromised, attestation_quality, related_cve_ids, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          // v1: no org resolution.
          null,
          b.disclosedAt,
          b.source ?? null,
          b.sourceUrl ?? null,
          b.breachType ?? null,
          typeof b.recordsCompromised === 'number' ? b.recordsCompromised : null,
          b.attestationQuality ?? null,
          b.relatedCveIds ?? null,
          b.notes ?? null,
        ],
      );
      upserted++;
    }
    await recordRun('breaches', { count: upserted, ok: true });
    return { source: 'breaches', upserted, ok: true };
  } catch (err) {
    await recordRun('breaches', {
      count: upserted,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return { source: 'breaches', upserted, ok: false, reason: 'error' };
  }
}
