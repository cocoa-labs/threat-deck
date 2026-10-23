import { fetchCertAdvisories } from '@/lib/data/collectors/breach-feed';
import { fetchGithubAdvisories } from '@/lib/data/collectors/github-advisories';
import { fetchVendorAdvisories } from '@/lib/data/collectors/vendor-patches';
import { query } from '@/lib/db/client';
import { recordRun } from './cursor';
import type { IngestSummary } from './ingest-cves';

/** `published_at` is `timestamp with time zone NOT NULL` — reject unparseable dates. */
function isValidDate(s: string | undefined | null): boolean {
  return !!s && !Number.isNaN(new Date(s).getTime());
}

/**
 * Advisory ingestion. Combines national-CERT advisories (`fetchCertAdvisories`),
 * vendor advisories (`fetchVendorAdvisories`), and GitHub Security Advisories
 * (`fetchGithubAdvisories`) — all three collectors map to the camelCase
 * `Advisory` type and never throw (CERT/vendor fall back to demo data; GHSA
 * falls back to `[]`) — then UPSERTs each into `aegis_advisories` keyed on the
 * UNIQUE `advisory_id` (the `ghsa_id` for GHSA rows).
 *
 * Two rows are skipped rather than inserted:
 *   - `advisoryId` null/empty — the UNIQUE constraint is nullable, so null ids
 *     would never conflict and would accumulate duplicates on every run.
 *   - `publishedAt` unparseable — `published_at` is `NOT NULL` timestamptz and
 *     can't accept null/garbage.
 */
export async function ingestAdvisories(): Promise<IngestSummary> {
  let upserted = 0;
  try {
    const [cert, vendor, ghsa] = await Promise.all([
      fetchCertAdvisories(undefined, 30),
      fetchVendorAdvisories(undefined, 30),
      fetchGithubAdvisories(50),
    ]);
    const advisories = [...cert, ...vendor, ...ghsa];

    for (const adv of advisories) {
      const advisoryId = adv.advisoryId?.trim();
      if (!advisoryId) continue; // nullable UNIQUE → null ids never dedupe.
      if (!isValidDate(adv.publishedAt)) continue; // NOT NULL timestamptz.

      await query(
        `INSERT INTO aegis_advisories
           (advisory_id, issuer, issuer_geography, published_at, severity, title, summary, affected_cves, affected_products, advisory_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (advisory_id) DO UPDATE
           SET issuer = EXCLUDED.issuer, issuer_geography = EXCLUDED.issuer_geography,
               published_at = EXCLUDED.published_at, severity = EXCLUDED.severity,
               title = EXCLUDED.title, summary = EXCLUDED.summary,
               affected_cves = EXCLUDED.affected_cves, affected_products = EXCLUDED.affected_products,
               advisory_url = EXCLUDED.advisory_url`,
        [
          advisoryId,
          adv.issuer,
          adv.issuerGeography ?? null,
          adv.publishedAt,
          adv.severity ?? null,
          adv.title ?? null,
          adv.summary ?? null,
          adv.affectedCves ?? null,
          adv.affectedProducts ?? null,
          adv.advisoryUrl ?? null,
        ],
      );
      upserted++;
    }
    await recordRun('advisories', { count: upserted, ok: true });
    return { source: 'advisories', upserted, ok: true };
  } catch (err) {
    await recordRun('advisories', {
      count: upserted,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    return { source: 'advisories', upserted, ok: false, reason: 'error' };
  }
}
