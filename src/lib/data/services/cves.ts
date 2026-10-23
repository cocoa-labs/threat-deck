import { NextResponse } from 'next/server';
import { fetchKevCatalog, fetchRecentCves } from '@/lib/data/collectors/cve-feed';
import type { CVE } from '@/lib/types';

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const severity = searchParams.get('severity') as 'critical' | 'high' | null;
  const isKev = parseBool(searchParams.get('is_kev'));
  const minCvssRaw = searchParams.get('min_cvss');
  const minCvss = minCvssRaw !== null ? Number(minCvssRaw) : undefined;
  const vendor = searchParams.get('vendor')?.toLowerCase();
  const limit = Number(searchParams.get('limit')) || 50;

  try {
    const minSeverityForFetch =
      severity === 'critical' || severity === 'high' ? severity : undefined;
    const [cves, kev] = await Promise.all([
      fetchRecentCves(limit, minSeverityForFetch),
      fetchKevCatalog(500),
    ]);

    // Enrich with KEV membership flag and dates.
    const kevById = new Map(kev.map((k) => [k.cveId, k]));
    const enriched: CVE[] = cves.map((c) => {
      const k = kevById.get(c.cveId);
      if (!k) return c;
      return {
        ...c,
        isKev: true,
        kevAddedDate: c.kevAddedDate ?? k.addedToKevAt,
        exploitedInWild: true,
      };
    });

    let filtered = enriched;
    if (severity) {
      filtered = filtered.filter((c) => c.severity === severity);
    }
    if (isKev === true) {
      filtered = filtered.filter((c) => c.isKev);
    } else if (isKev === false) {
      filtered = filtered.filter((c) => !c.isKev);
    }
    if (minCvss !== undefined && !Number.isNaN(minCvss)) {
      filtered = filtered.filter((c) => (c.cvssV3Score ?? 0) >= minCvss);
    }
    if (vendor) {
      // Best-effort vendor filter against summary and tags (vendor field is not in CVE shape).
      filtered = filtered.filter((c) => {
        const hay = `${c.summary} ${(c.tags ?? []).join(' ')}`.toLowerCase();
        return hay.includes(vendor);
      });
    }

    const trimmed = filtered.slice(0, limit);

    return withCacheHeaders(
      NextResponse.json({
        data: trimmed,
        count: trimmed.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch CVEs' },
      { status: 500 },
    );
  }
}
