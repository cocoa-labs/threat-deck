import {
  fetchMalwareBazaarSamples,
  fetchThreatfoxIndicators,
  fetchUrlhausIocs,
} from '@/lib/data/collectors/threat-iocs';
import { query } from '@/lib/db/client';
import { recordRun } from './cursor';
import type { IngestSummary } from './ingest-cves';

/**
 * `first_seen` / `last_seen` are `timestamp with time zone` in the live DB, which
 * rejects `''`. Coerce blank/unparseable date strings to null.
 */
function nullDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim();
  return t && !Number.isNaN(new Date(t).getTime()) ? t : null;
}

/**
 * IOC ingestion. Pulls indicators from the three abuse.ch collectors (URLhaus,
 * MalwareBazaar, ThreatFox) — each already maps the raw JSON to the camelCase
 * `IOC` type, falls back to demo data on failure, and never throws — then
 * UPSERTs each into `aegis_iocs` keyed on the UNIQUE `value` column.
 *
 * `related_cve_id` is a FK to `aegis_cves(cve_id)`; inserting an id we don't
 * have would FK-violate, so v1 deliberately passes `null` (no CVE linking yet).
 * `related_actor_id` is likewise left null in v1. On conflict we refresh the
 * mutable fields (`last_seen`, `confidence`, `source`, `tags`).
 */
export async function ingestIocs(): Promise<IngestSummary> {
  let upserted = 0;
  try {
    const [urlhaus, malwarebazaar, threatfox] = await Promise.all([
      fetchUrlhausIocs(100),
      fetchMalwareBazaarSamples(100),
      fetchThreatfoxIndicators(100),
    ]);
    const iocs = [...urlhaus, ...malwarebazaar, ...threatfox];

    for (const ioc of iocs) {
      if (!ioc.value) continue; // value is NOT NULL UNIQUE — skip empties.
      await query(
        `INSERT INTO aegis_iocs
           (ioc_type, value, first_seen, last_seen, source, confidence, tags, related_cve_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (value) DO UPDATE
           SET last_seen = EXCLUDED.last_seen, confidence = EXCLUDED.confidence,
               source = EXCLUDED.source, tags = EXCLUDED.tags`,
        [
          ioc.iocType,
          ioc.value,
          nullDate(ioc.firstSeen),
          nullDate(ioc.lastSeen),
          ioc.source ?? null,
          typeof ioc.confidence === 'number' ? ioc.confidence : null,
          ioc.tags ?? null,
          // v1: no CVE linking — passing an unknown related_cve_id would FK-violate.
          null,
        ],
      );
      upserted++;
    }
    await recordRun('iocs', { count: upserted, ok: true });
    return { source: 'iocs', upserted, ok: true };
  } catch (err) {
    await recordRun('iocs', {
      count: upserted,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return { source: 'iocs', upserted, ok: false, reason: 'error' };
  }
}
