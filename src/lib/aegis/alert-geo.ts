/**
 * Alert → coordinates resolution.
 *
 * The hero breaking-alert overlay is geo-gated by design: it only fires for
 * alerts that resolve to a place on the map. Alerts that don't resolve are not
 * lost — they land on the ALERTS board and the agent toast like any other.
 *
 * Two passes, cheapest first:
 *   A. `aegis_geo_threat_events` — the live attack table already carries
 *      `cve_id` and `target_org_id`, so a KEV alert or a breach alert can join
 *      straight to a real observed event.
 *   B. `cyberGeotagText()` — the same keyword geotagger the globe uses for live
 *      RSS, run over the alert's headline + summary.
 *
 * Batched: one query for all CVE-typed alerts and one for all org-typed alerts,
 * rather than a round-trip per alert.
 */

import { query } from '@/lib/db/client';
import type { PipelineAlertRow } from '@/lib/db/queries/pipeline-alerts';
import { cyberGeotagText } from '@/lib/mapbox/cyber-geotag';

export interface AlertLocation {
  lat: number;
  lon: number;
  name?: string;
}

interface GeoRow {
  key: string;
  latitude: number;
  longitude: number;
  country: string | null;
  city: string | null;
}

/** How far back a geo event may be and still be considered "where this is happening". */
const GEO_WINDOW_DAYS = 30;

function label(row: GeoRow): string | undefined {
  return row.city ?? row.country ?? undefined;
}

async function lookupByCve(cveIds: string[]): Promise<Map<string, AlertLocation>> {
  const out = new Map<string, AlertLocation>();
  if (cveIds.length === 0) return out;

  try {
    const { rows } = await query<GeoRow>(
      `SELECT DISTINCT ON (cve_id)
              cve_id AS key, latitude, longitude, country, city
         FROM aegis_geo_threat_events
        WHERE cve_id = ANY($1)
          AND occurred_at::timestamptz >= NOW() - ($2 || ' days')::interval
        ORDER BY cve_id, occurred_at DESC`,
      [cveIds, String(GEO_WINDOW_DAYS)],
    );
    for (const row of rows) {
      out.set(row.key, { lat: row.latitude, lon: row.longitude, name: label(row) });
    }
  } catch (err) {
    console.error('[alert-geo] cve lookup failed:', err);
  }
  return out;
}

async function lookupByOrg(orgIds: string[]): Promise<Map<string, AlertLocation>> {
  const out = new Map<string, AlertLocation>();
  const numeric = orgIds.map((id) => Number(id)).filter((n) => Number.isInteger(n));
  if (numeric.length === 0) return out;

  try {
    const { rows } = await query<GeoRow>(
      `SELECT DISTINCT ON (target_org_id)
              target_org_id::text AS key, latitude, longitude, country, city
         FROM aegis_geo_threat_events
        WHERE target_org_id = ANY($1)
        ORDER BY target_org_id, occurred_at DESC`,
      [numeric],
    );
    for (const row of rows) {
      out.set(row.key, { lat: row.latitude, lon: row.longitude, name: label(row) });
    }
  } catch (err) {
    console.error('[alert-geo] org lookup failed:', err);
  }
  return out;
}

/** Pass B — keyword geotag over the alert's own text. */
function geotagFromText(row: PipelineAlertRow): AlertLocation | null {
  const text = `${row.headline ?? ''} ${row.summary ?? ''}`.trim();
  if (!text) return null;
  const hit = cyberGeotagText(text, 1)[0];
  return hit ? { lat: hit.lat, lon: hit.lon, name: hit.name } : null;
}

/**
 * Resolve coordinates for a batch of alerts. Returns a map keyed by
 * `String(alert.id)`; alerts absent from the map did not resolve, which is the
 * geo gate the hero overlay reads.
 */
export async function resolveAlertGeo(
  rows: PipelineAlertRow[],
): Promise<Map<string, AlertLocation>> {
  const resolved = new Map<string, AlertLocation>();
  if (rows.length === 0) return resolved;

  const cveIds = rows.filter((r) => r.entity_kind === 'cve').map((r) => r.entity_id);
  const orgIds = rows.filter((r) => r.entity_kind === 'breach').map((r) => r.entity_id);

  const [byCve, byOrg] = await Promise.all([lookupByCve(cveIds), lookupByOrg(orgIds)]);

  for (const row of rows) {
    const fromDb =
      row.entity_kind === 'cve'
        ? byCve.get(row.entity_id)
        : row.entity_kind === 'breach'
          ? byOrg.get(row.entity_id)
          : undefined;

    const location = fromDb ?? geotagFromText(row);
    if (location) resolved.set(String(row.id), location);
  }

  return resolved;
}
