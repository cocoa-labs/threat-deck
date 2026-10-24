import { NextResponse } from 'next/server';
import { ingestProvenance } from '@/lib/aegis/ingest/provenance';
import { query } from '@/lib/db/client';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * GET /api/aegis/cves
 *
 * Returns CVE pipeline data from `aegis_v_cve_summary` view (DB-backed).
 * Used by the CVEPipelinePanel for the deep-intel deck.
 *
 * Query params:
 *   - severity: critical | high | medium | low
 *   - is_kev: true | false
 *   - exploited_in_wild: true | false
 *   - search: substring against summary
 *   - limit: 1..100 (default 50)
 */

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=120, s-maxage=300, stale-while-revalidate=120',
  );
  return response;
}

function parseBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return undefined;
}

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const severityRaw = searchParams.get('severity')?.toLowerCase();
  const severity = severityRaw && VALID_SEVERITIES.has(severityRaw) ? severityRaw : undefined;
  const isKev = parseBool(searchParams.get('is_kev'));
  const exploited = parseBool(searchParams.get('exploited_in_wild'));
  const search = searchParams.get('search')?.trim();
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100);

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (severity) {
      conditions.push(`c.severity = $${paramIdx++}`);
      params.push(severity);
    }
    if (isKev !== undefined) {
      conditions.push(`c.is_kev = $${paramIdx++}`);
      params.push(isKev);
    }
    if (exploited !== undefined) {
      conditions.push(`c.exploited_in_wild = $${paramIdx++}`);
      params.push(exploited);
    }
    if (search) {
      conditions.push(`LOWER(c.summary) LIKE LOWER($${paramIdx++})`);
      params.push(`%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        c.cve_id, c.published_at, c.severity,
        c.cvss_v3_score, c.epss_score, c.epss_percentile,
        c.is_kev, c.kev_added_date,
        c.exploited_in_wild, c.poc_public,
        c.summary, c.nvd_source_url, c.tags,
        c.kev_due_date, c.kev_required_action, c.known_ransomware_use,
        c.remediation_count, c.first_patch_at, c.affected_product_count
      FROM aegis_v_cve_summary c
      ${whereClause}
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT ${limit}
    `;

    const result = await query<Record<string, unknown>>(sql, params);

    // Pull affected products for vendor/product display (first match per CVE).
    const cveIds = result.rows.map((r) => r.cve_id as string);
    let productsByCve: Record<string, { vendor?: string; product?: string }> = {};
    if (cveIds.length > 0) {
      const productsResult = await query<Record<string, unknown>>(
        `SELECT DISTINCT ON (cve_id) cve_id, vendor, product
         FROM aegis_affected_products
         WHERE cve_id = ANY($1::text[])
         ORDER BY cve_id, vendor NULLS LAST, product NULLS LAST`,
        [cveIds],
      );
      productsByCve = Object.fromEntries(
        productsResult.rows.map((p) => [
          p.cve_id as string,
          { vendor: p.vendor as string | undefined, product: p.product as string | undefined },
        ]),
      );
    }

    const provenance = await ingestProvenance('cves');
    const data = result.rows.map((r) => {
      const cveId = r.cve_id as string;
      const ap = productsByCve[cveId];
      return {
        _provenance: provenance,
        cveId,
        publishedAt: r.published_at,
        severity: r.severity,
        cvssV3Score: r.cvss_v3_score,
        epssScore: r.epss_score,
        epssPercentile: r.epss_percentile,
        isKev: r.is_kev,
        kevAddedDate: r.kev_added_date,
        kevDueDate: r.kev_due_date,
        kevRequiredAction: r.kev_required_action,
        knownRansomwareUse: r.known_ransomware_use,
        exploitedInWild: r.exploited_in_wild,
        pocPublic: r.poc_public,
        summary: r.summary,
        nvdSourceUrl: r.nvd_source_url,
        tags: r.tags,
        remediationCount: r.remediation_count,
        firstPatchAt: r.first_patch_at,
        affectedProductCount: r.affected_product_count,
        primaryVendor: ap?.vendor ?? null,
        primaryProduct: ap?.product ?? null,
        sourceUrl: `/api/aegis/cves/view?id=${cveId}`,
      };
    });

    return withCacheHeaders(
      NextResponse.json({
        data,
        count: data.length,
        provenance,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    console.error('[aegis/cves] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch AEGIS CVEs' },
      { status: 500 },
    );
  }
}

export const GET = withRoutePolicy('/api/aegis/cves', routeGETImplementation);
