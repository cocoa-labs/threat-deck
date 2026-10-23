/**
 * Live geo-threat event ingestion — populates `aegis_geo_threat_events`, the hot
 * table behind the globe + war-room attack map.
 *
 * Until Phase 1C this table was seed-only (6 static 2024 rows, no writer); the
 * globe showed live data only via client-side keyword-geotagging
 * (`use-cyber-geo-data.ts`). This collector makes the table real with two passes:
 *
 *   A. Actor → target ATTACK events — SQL over `aegis_threat_actor_targets` and
 *      `aegis_threat_actor_campaigns` JOINed to `aegis_threat_actors`. Each row
 *      stores the *target* geography as lat/lon plus the `actor_id`; the war-room
 *      lens resolves the *origin* from the actor's `attribution_country` to draw
 *      the source→target arc. No external API — works offline against the DB.
 *   B. CERT advisory DISCLOSURE events — reuses `fetchCertAdvisories` (itself
 *      rate-limited + fail-soft). `issuerGeography` → capital centroid.
 *
 * (Pass C — ThreatFox c2_observed by country — is deferred: the client geotagger
 *  already renders live IOC dots, and ThreatFox country parsing needs its own
 *  fetch path. Tracked for a 1C fast-follow.)
 *
 * Resilience matches `src/lib/data/collectors/epss.ts`: cache-throttle, DB upsert
 * with a stable dedup key (migration 018), audit rollup, never throws.
 * `occurred_at` is stamped at refresh time so the live 30-day window always shows
 * current actor activity; the ON CONFLICT upsert refreshes it in place rather
 * than duplicating rows.
 */

import { createHash } from 'node:crypto';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { fetchCertAdvisories } from '@/lib/data/collectors/breach-feed';
import { getCached, setCache } from '@/lib/data/rate-limiter';
import { query } from '@/lib/db/client';
import { geocodeLocation } from '@/lib/mapbox/geocode';
import type { CveSeverity } from '@/lib/types';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Just under the 30-min cron cadence so a fresh cron tick always does work. */
const REFRESH_TTL_SECONDS = 1740;

type GeoEventType = 'attack' | 'disclosure' | 'takedown' | 'c2_observed';

interface GeoCentroid {
  lat: number;
  lon: number;
  country: string;
}

/**
 * Curated centroids for the threat-relevant world. Keyed by ISO-2 code, common
 * name, and the CERT `issuerGeography` codes (us/uk/eu/jp/au/ca) so a single
 * resolver serves actor attribution (ISO-2, e.g. 'RU'), campaign/target
 * geographies (names or codes), and CERT advisories. Unknown keys fall back to
 * `geocodeLocation()`; anything still unresolved is skipped.
 */
const GEO_CENTROIDS: Record<string, GeoCentroid> = {
  ru: { lat: 55.75, lon: 37.62, country: 'Russia' },
  russia: { lat: 55.75, lon: 37.62, country: 'Russia' },
  cn: { lat: 39.9, lon: 116.4, country: 'China' },
  china: { lat: 39.9, lon: 116.4, country: 'China' },
  kp: { lat: 39.03, lon: 125.75, country: 'North Korea' },
  'north korea': { lat: 39.03, lon: 125.75, country: 'North Korea' },
  ir: { lat: 35.7, lon: 51.42, country: 'Iran' },
  iran: { lat: 35.7, lon: 51.42, country: 'Iran' },
  us: { lat: 38.9, lon: -77.04, country: 'United States' },
  usa: { lat: 38.9, lon: -77.04, country: 'United States' },
  'united states': { lat: 38.9, lon: -77.04, country: 'United States' },
  ua: { lat: 50.45, lon: 30.52, country: 'Ukraine' },
  ukraine: { lat: 50.45, lon: 30.52, country: 'Ukraine' },
  gb: { lat: 51.51, lon: -0.13, country: 'United Kingdom' },
  uk: { lat: 51.51, lon: -0.13, country: 'United Kingdom' },
  'united kingdom': { lat: 51.51, lon: -0.13, country: 'United Kingdom' },
  eu: { lat: 50.85, lon: 4.35, country: 'European Union' },
  europe: { lat: 50.85, lon: 4.35, country: 'European Union' },
  jp: { lat: 35.68, lon: 139.69, country: 'Japan' },
  japan: { lat: 35.68, lon: 139.69, country: 'Japan' },
  au: { lat: -35.28, lon: 149.13, country: 'Australia' },
  australia: { lat: -35.28, lon: 149.13, country: 'Australia' },
  ca: { lat: 45.42, lon: -75.7, country: 'Canada' },
  canada: { lat: 45.42, lon: -75.7, country: 'Canada' },
  de: { lat: 52.52, lon: 13.4, country: 'Germany' },
  germany: { lat: 52.52, lon: 13.4, country: 'Germany' },
  fr: { lat: 48.86, lon: 2.35, country: 'France' },
  france: { lat: 48.86, lon: 2.35, country: 'France' },
  kr: { lat: 37.57, lon: 126.98, country: 'South Korea' },
  'south korea': { lat: 37.57, lon: 126.98, country: 'South Korea' },
  in: { lat: 28.61, lon: 77.21, country: 'India' },
  india: { lat: 28.61, lon: 77.21, country: 'India' },
  il: { lat: 31.78, lon: 35.22, country: 'Israel' },
  israel: { lat: 31.78, lon: 35.22, country: 'Israel' },
  br: { lat: -15.79, lon: -47.88, country: 'Brazil' },
  brazil: { lat: -15.79, lon: -47.88, country: 'Brazil' },
  vn: { lat: 21.03, lon: 105.85, country: 'Vietnam' },
  vietnam: { lat: 21.03, lon: 105.85, country: 'Vietnam' },
  pk: { lat: 33.69, lon: 73.06, country: 'Pakistan' },
  pakistan: { lat: 33.69, lon: 73.06, country: 'Pakistan' },
  tw: { lat: 25.03, lon: 121.57, country: 'Taiwan' },
  taiwan: { lat: 25.03, lon: 121.57, country: 'Taiwan' },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface GeoEventInsert {
  eventType: GeoEventType;
  lat: number;
  lon: number;
  country?: string;
  severity: string;
  actorId?: string;
  cveId?: string;
  occurredAt: string;
  summary?: string;
  source?: string;
  /** Stable logical identity — sha256'd into dedup_hash for the upsert. */
  dedupRef: string;
}

export interface GeoEventsRefreshSummary {
  ok: boolean;
  reason?: 'cached' | 'no_events';
  written: number;
  skipped: number;
  byType: Record<string, number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function resolveGeo(raw: string | null | undefined): GeoCentroid | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  const hit = GEO_CENTROIDS[key];
  if (hit) return hit;
  const geo = geocodeLocation(key);
  if (geo) return { lat: geo.lat, lon: geo.lon, country: raw.trim() };
  return null;
}

/** Match the codebase's TEXT-timestamp convention ('YYYY-MM-DD HH24:MI:SS'). */
function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function severityFromOutcome(outcome: string | null): string {
  switch (outcome) {
    case 'compromised':
      return 'critical';
    case 'partial':
      return 'high';
    case 'repelled':
      return 'medium';
    default:
      return 'high';
  }
}

function advisorySeverity(sev: CveSeverity | null | undefined): string {
  if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') return sev;
  return 'medium';
}

/**
 * INSERT one geo event, or refresh it in place on dedup_hash conflict. Returns
 * true when a row was written, false when the upsert failed (never throws — a
 * single bad row must not kill the refresh).
 */
async function upsertGeoEvent(e: GeoEventInsert): Promise<boolean> {
  const dedupHash = createHash('sha256').update(e.dedupRef).digest('hex');
  try {
    await query(
      `INSERT INTO aegis_geo_threat_events
         (event_type, latitude, longitude, country, severity, actor_id, cve_id,
          occurred_at, summary, source, dedup_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (dedup_hash) DO UPDATE SET
         occurred_at = EXCLUDED.occurred_at,
         severity = EXCLUDED.severity,
         summary = EXCLUDED.summary,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude`,
      [
        e.eventType,
        e.lat,
        e.lon,
        e.country ?? null,
        e.severity,
        e.actorId ?? null,
        e.cveId ?? null,
        e.occurredAt,
        e.summary ?? null,
        e.source ?? null,
        dedupHash,
      ],
    );
    return true;
  } catch (err) {
    console.warn('[geo-events] upsert failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

// ─── Passes ──────────────────────────────────────────────────────────────────

/** Pass A.1 — one ATTACK event per actor→target (org-level) with a resolvable geo. */
async function collectActorTargetEvents(stamp: string): Promise<GeoEventInsert[]> {
  const events: GeoEventInsert[] = [];
  const { rows } = await query<{
    actor_id: string;
    org_name: string | null;
    industry: string | null;
    geography: string | null;
    outcome: string | null;
    display_name: string;
  }>(
    `SELECT t.actor_id, t.org_name, t.industry, t.geography, t.outcome, a.display_name
       FROM aegis_threat_actor_targets t
       JOIN aegis_threat_actors a ON a.actor_id = t.actor_id
      WHERE t.geography IS NOT NULL`,
  );
  for (const r of rows) {
    const geo = resolveGeo(r.geography);
    if (!geo) continue;
    const target = r.org_name ?? r.industry ?? geo.country;
    events.push({
      eventType: 'attack',
      lat: geo.lat,
      lon: geo.lon,
      country: geo.country,
      severity: severityFromOutcome(r.outcome),
      actorId: r.actor_id,
      occurredAt: stamp,
      summary: `${r.display_name} → ${target}`,
      source: 'aegis:actor-target',
      dedupRef: `attack:target:${r.actor_id}:${r.org_name ?? r.geography}`,
    });
  }
  return events;
}

/** Pass A.2 — one ATTACK event per (campaign, target geography). */
async function collectActorCampaignEvents(stamp: string): Promise<GeoEventInsert[]> {
  const events: GeoEventInsert[] = [];
  const { rows } = await query<{
    id: number;
    actor_id: string;
    campaign_name: string;
    target_geographies: string[] | null;
    display_name: string;
  }>(
    `SELECT c.id, c.actor_id, c.campaign_name, c.target_geographies, a.display_name
       FROM aegis_threat_actor_campaigns c
       JOIN aegis_threat_actors a ON a.actor_id = c.actor_id
      WHERE c.target_geographies IS NOT NULL`,
  );
  for (const r of rows) {
    for (const geoName of r.target_geographies ?? []) {
      const geo = resolveGeo(geoName);
      if (!geo) continue;
      events.push({
        eventType: 'attack',
        lat: geo.lat,
        lon: geo.lon,
        country: geo.country,
        severity: 'high',
        actorId: r.actor_id,
        occurredAt: stamp,
        summary: `${r.display_name}: ${r.campaign_name} targeting ${geo.country}`,
        source: 'aegis:actor-campaign',
        dedupRef: `attack:campaign:${r.id}:${geoName}`,
      });
    }
  }
  return events;
}

/** Pass B — one DISCLOSURE event per CERT advisory with a resolvable issuer geo. */
async function collectCertDisclosureEvents(stamp: string): Promise<GeoEventInsert[]> {
  const events: GeoEventInsert[] = [];
  const advisories = await fetchCertAdvisories(undefined, 40);
  for (const adv of advisories) {
    const geo = resolveGeo(adv.issuerGeography);
    if (!geo) continue;
    events.push({
      eventType: 'disclosure',
      lat: geo.lat,
      lon: geo.lon,
      country: geo.country,
      severity: advisorySeverity(adv.severity),
      occurredAt: stamp,
      summary: adv.title ?? adv.summary ?? `${adv.issuer} advisory`,
      source: adv.advisoryUrl ?? `cert:${adv.issuer}`,
      dedupRef: `disclosure:${adv.advisoryId ?? adv.title ?? adv.advisoryUrl ?? `${adv.issuer}:${adv.publishedAt}`}`,
    });
  }
  return events;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Refresh the live geo-threat events table. Idempotent within the cache window
 * (re-running returns the cached summary). Never throws — returns a summary.
 */
export async function refreshGeoEvents(maxEvents = 300): Promise<GeoEventsRefreshSummary> {
  const cacheKey = 'geo-events:refresh:v1';
  const cached = await getCached<GeoEventsRefreshSummary>(cacheKey);
  if (cached) return { ...cached, reason: 'cached' };

  const stamp = nowStamp();
  const collected: GeoEventInsert[] = [];

  // Pass A — actor attacks (SQL only). Fail-soft per pass.
  try {
    collected.push(...(await collectActorTargetEvents(stamp)));
    collected.push(...(await collectActorCampaignEvents(stamp)));
  } catch (err) {
    console.warn('[geo-events] actor pass failed:', err instanceof Error ? err.message : err);
  }

  // Pass B — CERT disclosures (fetchCertAdvisories is internally rate-limited).
  try {
    collected.push(...(await collectCertDisclosureEvents(stamp)));
  } catch (err) {
    console.warn('[geo-events] cert pass failed:', err instanceof Error ? err.message : err);
  }

  const events = collected.slice(0, maxEvents);
  let written = 0;
  let skipped = 0;
  const byType: Record<string, number> = {};
  for (const e of events) {
    const ok = await upsertGeoEvent(e);
    if (ok) {
      written++;
      byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
    } else {
      skipped++;
    }
  }

  const summary: GeoEventsRefreshSummary = {
    ok: written > 0,
    reason: events.length === 0 ? 'no_events' : undefined,
    written,
    skipped,
    byType,
  };

  void recordAudit({
    action: AUDIT_ACTIONS.DATA_GEO_EVENTS_INGESTED,
    outcome: summary.ok ? 'success' : 'failure',
    targetKind: 'geo_events',
    targetId: cacheKey,
    details: { written, skipped, byType, collected: collected.length },
  });

  await setCache(cacheKey, summary, REFRESH_TTL_SECONDS);
  return summary;
}
