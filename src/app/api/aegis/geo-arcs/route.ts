import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/aegis/geo-arcs — source→target attack arcs for the war-room lens.
 *
 * Phase 1D. Joins live ATTACK events (aegis_geo_threat_events) to their actor,
 * resolving the *origin* from the actor's attribution_country and the *target*
 * from the event coordinates, and returns GlobeArc[] ready for the existing
 * Mapbox (MapArcLayer) + R3F globe (GlobeArcs) arc render pipeline.
 *
 * Read-only, fail-soft (empty arc set on error — the globe still renders).
 */

import { NextResponse } from 'next/server';
import { resolveGeo } from '@/lib/data/collectors/geo-events';
import { query } from '@/lib/db/client';
import type { GlobeArc } from '@/lib/types';

const ARC_SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff0040',
  high: '#ff4444',
  medium: '#ffaa00',
  low: '#00ff41',
};

interface ArcRow {
  id: number;
  target_lat: number;
  target_lon: number;
  severity: string | null;
  actor_id: string;
  target_country: string | null;
  display_name: string;
  attribution_country: string | null;
}

async function routeGETImplementation(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 60, 200);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const sql = `
    SELECT g.id, g.latitude AS target_lat, g.longitude AS target_lon, g.severity,
           g.actor_id, g.country AS target_country,
           a.display_name, a.attribution_country
      FROM aegis_geo_threat_events g
      JOIN aegis_threat_actors a ON a.actor_id = g.actor_id
     WHERE g.event_type = 'attack' AND g.actor_id IS NOT NULL AND g.occurred_at >= $1
     ORDER BY g.occurred_at DESC
     LIMIT $2`;

  try {
    const { rows } = await query<ArcRow>(sql, [since, limit]);
    const arcs: GlobeArc[] = [];
    for (const r of rows) {
      const origin = resolveGeo(r.attribution_country);
      if (!origin) continue;
      // Skip degenerate arcs where the actor's home == the target.
      if (
        Math.abs(origin.lat - r.target_lat) < 0.01 &&
        Math.abs(origin.lon - r.target_lon) < 0.01
      ) {
        continue;
      }
      arcs.push({
        id: `warroom-${r.id}`,
        fromLat: origin.lat,
        fromLon: origin.lon,
        toLat: r.target_lat,
        toLon: r.target_lon,
        color: ARC_SEVERITY_COLOR[(r.severity ?? 'high').toLowerCase()] ?? '#ff4444',
        label: `${r.display_name} → ${r.target_country ?? 'target'}`,
      });
    }
    return NextResponse.json({
      data: arcs,
      count: arcs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'geo-arcs query failed';
    console.error('[geo-arcs] query error:', message);
    return NextResponse.json({
      data: [],
      count: 0,
      timestamp: new Date().toISOString(),
      error: message,
    });
  }
}

export const GET = withRoutePolicy('/api/aegis/geo-arcs', routeGETImplementation);
