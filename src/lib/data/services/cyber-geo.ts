/**
 * GET /api/data/cyber-geo
 *
 * Returns geo-tagged cyber events for globe/map rendering. Reads from the
 * `aegis_geo_threat_events` hot table (written by collectors) and enriches
 * each row via LEFT JOINs against `aegis_threat_actors`, `aegis_cves`, and
 * `aegis_compromised_orgs` so the hover card can render rich detail without
 * a second round-trip.
 *
 * Query params (all optional):
 *   ?since=ISO_OR_RELATIVE — events with occurred_at >= since (default: 30d ago)
 *   ?severity=critical|high|medium|low
 *   ?event_type=attack|disclosure|takedown|c2_observed
 *   ?limit=number — default 100, max 500
 *
 * Response: { data: CyberGlobeMarker[], count, timestamp, source }
 *
 * Cache: edge-cached 5 min, stale-while-revalidate 5 min. Fluid Compute /
 * Vercel Functions automatically respect these headers.
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import type {
  CyberCategory,
  CyberGlobeMarker,
  CyberStreamSource,
  IntelligenceCategory,
  KevStatus,
  Severity,
} from '@/lib/types';

interface GeoEventRow {
  id: number;
  event_type: string;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
  city: string | null;
  severity: string | null;
  occurred_at: string;
  summary: string | null;
  source: string | null;
  // Joins
  actor_id: string | null;
  actor_display_name: string | null;
  actor_aliases: string[] | null;
  actor_type: string | null;
  cve_id: string | null;
  cve_summary: string | null;
  cvss_v3_score: number | null;
  epss_score: number | null;
  epss_percentile: number | null;
  is_kev: boolean | null;
  exploited_in_wild: boolean | null;
  org_name: string | null;
  org_industry: string | null;
  org_country: string | null;
}

const VALID_SEVERITIES = new Set<Severity>(['critical', 'high', 'medium', 'low']);
const VALID_EVENT_TYPES = new Set(['attack', 'disclosure', 'takedown', 'c2_observed']);

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

function eventTypeToCyberCategory(
  eventType: string,
  hasActor: boolean,
  hasCve: boolean,
): CyberCategory {
  switch (eventType) {
    case 'disclosure':
      return 'breach';
    case 'attack':
      if (hasCve) return 'cve';
      if (hasActor) return 'threat_actor';
      return 'cve';
    case 'takedown':
      return 'threat_actor';
    case 'c2_observed':
      return 'ioc';
    default:
      return 'cve';
  }
}

function severityToIntelligenceCategory(
  cyberCategory: CyberCategory,
  severity: Severity,
): IntelligenceCategory {
  if (cyberCategory === 'cve') {
    if (severity === 'critical') return 'cve_critical';
    if (severity === 'high') return 'cve_high';
    return 'cve_medium';
  }
  if (cyberCategory === 'breach') return 'data_breach';
  if (cyberCategory === 'threat_actor') return 'apt_activity';
  if (cyberCategory === 'ai_incident') return 'ai_incident';
  if (cyberCategory === 'ai_safety') return 'ai_safety';
  if (cyberCategory === 'ioc') return 'apt_activity';
  return 'strategic';
}

function normalizeSeverity(raw: string | null): Severity {
  if (!raw) return 'medium';
  const v = raw.toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low' || v === 'info') {
    return v;
  }
  return 'medium';
}

function rowToMarker(row: GeoEventRow): CyberGlobeMarker {
  const severity = normalizeSeverity(row.severity);
  const hasActor = Boolean(row.actor_id);
  const hasCve = Boolean(row.cve_id);
  const cyberCategory = eventTypeToCyberCategory(row.event_type, hasActor, hasCve);
  const category = severityToIntelligenceCategory(cyberCategory, severity);

  const label =
    row.cve_id ??
    row.actor_display_name ??
    row.org_name ??
    row.city ??
    row.country ??
    `Event ${row.id}`;

  const kevStatus: KevStatus | undefined = row.is_kev ? 'kev_listed' : undefined;

  return {
    id: `aegis-geo-${row.id}`,
    lat: row.latitude,
    lon: row.longitude,
    severity,
    category,
    label,
    count: 1,
    source: 'osint', // GlobeMarker.source uses the legacy IntelligenceSource enum
    description: row.summary ?? undefined,
    timestamp: row.occurred_at,
    zoomTier: 'country',
    // Cyber-specific
    cyberCategory,
    streamSource: 'aegis_db' satisfies CyberStreamSource,
    locationPrecision: row.city ? 'city' : 'country',
    locationConfidence: row.city ? 0.95 : 0.85,
    cveId: row.cve_id ?? undefined,
    threatActorId: row.actor_id ?? undefined,
    cvssScore: row.cvss_v3_score ?? undefined,
    epssScore: row.epss_score ?? undefined,
    epssPercentile: row.epss_percentile ?? undefined,
    kevStatus,
    actorAliases: row.actor_aliases ?? undefined,
    victimOrg: row.org_name ?? undefined,
    victimIndustry: row.org_industry ?? undefined,
    nvdUrl: row.cve_id ? `https://nvd.nist.gov/vuln/detail/${row.cve_id}` : undefined,
    mitreUrl: row.actor_id
      ? `https://attack.mitre.org/groups/${row.actor_id.toUpperCase()}/`
      : undefined,
    referenceUrl: row.source ?? undefined,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const sinceParam = url.searchParams.get('since');
  const severityParam = url.searchParams.get('severity')?.toLowerCase();
  const eventTypeParam = url.searchParams.get('event_type')?.toLowerCase();
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, 500);

  // Default window: last 30 days
  const since = sinceParam ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const filters: string[] = ['g.occurred_at >= $1'];
  const params: unknown[] = [since];

  if (severityParam && VALID_SEVERITIES.has(severityParam as Severity)) {
    params.push(severityParam);
    filters.push(`g.severity = $${params.length}`);
  }

  if (eventTypeParam && VALID_EVENT_TYPES.has(eventTypeParam)) {
    params.push(eventTypeParam);
    filters.push(`g.event_type = $${params.length}`);
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;

  const sql = `
    SELECT
      g.id,
      g.event_type,
      g.latitude,
      g.longitude,
      g.country,
      g.region,
      g.city,
      g.severity,
      g.occurred_at,
      g.summary,
      g.source,
      g.actor_id,
      a.display_name      AS actor_display_name,
      a.aliases           AS actor_aliases,
      a.actor_type        AS actor_type,
      g.cve_id,
      c.summary           AS cve_summary,
      c.cvss_v3_score,
      c.epss_score,
      c.epss_percentile,
      c.is_kev,
      c.exploited_in_wild,
      o.org_name,
      o.industry          AS org_industry,
      o.country           AS org_country
    FROM aegis_geo_threat_events g
    LEFT JOIN aegis_threat_actors  a ON a.actor_id = g.actor_id
    LEFT JOIN aegis_cves            c ON c.cve_id   = g.cve_id
    LEFT JOIN aegis_compromised_orgs o ON o.id      = g.target_org_id
    WHERE ${filters.join(' AND ')}
    ORDER BY g.occurred_at DESC
    LIMIT ${limitPlaceholder}
  `;

  try {
    const { rows } = await query<GeoEventRow>(sql, params);
    const markers = rows.map(rowToMarker);

    return withCacheHeaders(
      NextResponse.json({
        data: markers,
        count: markers.length,
        timestamp: new Date().toISOString(),
        source: 'aegis_geo_threat_events',
      }),
    );
  } catch (err) {
    // Fail gracefully — return an empty marker set rather than 500. The globe
    // continues to render static seed + RSS streams, matching the
    // "never throw from collectors" rule from CLAUDE.md.
    const message = err instanceof Error ? err.message : 'cyber-geo query failed';
    console.error('[cyber-geo] query error:', message);
    return withCacheHeaders(
      NextResponse.json({
        data: [],
        count: 0,
        timestamp: new Date().toISOString(),
        source: 'aegis_geo_threat_events',
        error: message,
      }),
    );
  }
}
