import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/incidents
 *
 * Returns recent cyber incidents from `aegis_v_recent_incidents` view (90-day window).
 * Used by IncidentAssessmentPanel for the deep-intel deck.
 *
 * Query params:
 *   - industry: substring match
 *   - country: ISO country code
 *   - incident_type: ransomware | data_breach | credential_stuffing | supply_chain | ddos | wiper | zero_day | phishing | unknown
 *   - since: ISO date (filters disclosed_at >= since)
 *   - limit: 1..100 (default 50)
 */

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=900, stale-while-revalidate=300',
  );
  return response;
}

const VALID_INCIDENT_TYPES = new Set([
  'ransomware',
  'data_breach',
  'credential_stuffing',
  'supply_chain',
  'ddos',
  'wiper',
  'zero_day',
  'phishing',
  'unknown',
]);

async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const industry = searchParams.get('industry')?.trim();
  const country = searchParams.get('country')?.toUpperCase();
  const incidentTypeRaw = searchParams.get('incident_type')?.toLowerCase();
  const incidentType =
    incidentTypeRaw && VALID_INCIDENT_TYPES.has(incidentTypeRaw) ? incidentTypeRaw : undefined;
  const since = searchParams.get('since')?.trim();
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100);

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (industry) {
      conditions.push(`LOWER(industry) LIKE LOWER($${paramIdx++})`);
      params.push(`%${industry}%`);
    }
    if (country) {
      conditions.push(`UPPER(country) = $${paramIdx++}`);
      params.push(country);
    }
    if (incidentType) {
      conditions.push(`incident_type = $${paramIdx++}`);
      params.push(incidentType);
    }
    if (since) {
      conditions.push(`disclosed_at >= $${paramIdx++}`);
      params.push(since);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        id, incident_id, organization, org_domain, industry, country,
        disclosed_at, incident_type, initial_access_vector,
        records_compromised, estimated_loss_usd, summary,
        actor_name, actor_type, ttp_count
      FROM aegis_v_recent_incidents
      ${whereClause}
      ORDER BY disclosed_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    const result = await query<Record<string, unknown>>(sql, params);

    const data = result.rows.map((r) => ({
      id: r.id,
      incidentId: r.incident_id,
      organization: r.organization,
      orgDomain: r.org_domain,
      industry: r.industry,
      country: r.country,
      disclosedAt: r.disclosed_at,
      incidentType: r.incident_type,
      initialAccessVector: r.initial_access_vector,
      recordsCompromised: r.records_compromised,
      estimatedLossUsd: r.estimated_loss_usd,
      summary: r.summary,
      actorName: r.actor_name,
      actorType: r.actor_type,
      ttpCount: r.ttp_count,
      sourceUrl: `/api/aegis/incidents/view?id=${r.id}`,
    }));

    return withCacheHeaders(
      NextResponse.json({
        data,
        count: data.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.error('[aegis/incidents] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch AEGIS incidents' },
      { status: 500 },
    );
  }
}

export const GET = withRoutePolicy('/api/aegis/incidents', routeGETImplementation);
