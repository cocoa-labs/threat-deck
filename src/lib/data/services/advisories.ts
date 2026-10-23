import { NextResponse } from 'next/server';
import {
  type CertIssuer,
  fetchCertAdvisories,
  getSupportedCertIssuers,
} from '@/lib/data/collectors/breach-feed';
import { fetchVendorAdvisories, getSupportedVendors } from '@/lib/data/collectors/vendor-patches';
import type { Advisory, CveSeverity } from '@/lib/types';

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

const VALID_SEVERITIES: ReadonlySet<CveSeverity> = new Set(['critical', 'high', 'medium', 'low']);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const issuerParam = searchParams.get('issuer')?.toLowerCase();
  const severityParam = searchParams.get('severity')?.toLowerCase();
  const limit = Number(searchParams.get('limit')) || 30;

  const certSupported = new Set<string>(getSupportedCertIssuers());

  // ─── Reject unknown filter values ───
  //
  // Every unrecognized value used to fall through to the unfiltered branch, so
  // a caller who asked to narrow the results silently got MORE than they asked
  // for: `?issuer=microsoft` returned the CERT+vendor union, and
  // `?severity=nonsense` returned every severity. A filter that silently does
  // nothing is worse than one that errors — the caller has no way to tell.
  //
  // Absent params still mean "no filter", which is the correct default.
  const validIssuers = ['cert', 'vendor', ...certSupported];
  if (issuerParam && !validIssuers.includes(issuerParam)) {
    // `microsoft` et al are the likely mistake: they're vendors, and vendor
    // filtering lives on the sibling route.
    const isVendorName = (getSupportedVendors() as string[]).includes(issuerParam);
    return NextResponse.json(
      {
        error: 'invalid_issuer',
        issuer: issuerParam,
        valid: validIssuers,
        hint: isVendorName
          ? `"${issuerParam}" is a vendor, not an issuer. Use /api/data/patches?vendor=${issuerParam}, or issuer=vendor for all vendors.`
          : 'Use issuer=cert for all CERT bodies, issuer=vendor for all vendor patches, or a specific CERT issuer.',
      },
      { status: 400 },
    );
  }

  if (severityParam && !VALID_SEVERITIES.has(severityParam as CveSeverity)) {
    return NextResponse.json(
      {
        error: 'invalid_severity',
        severity: severityParam,
        valid: [...VALID_SEVERITIES],
      },
      { status: 400 },
    );
  }

  const severity = severityParam as CveSeverity | undefined;

  // A severity filter is applied AFTER the fetch, so asking for `limit` items
  // and then filtering silently under-fills — `?severity=critical&limit=30`
  // used to return a handful. Over-fetch so the filter has something to bite
  // on, then trim back to `limit`.
  const fetchLimit = severity ? Math.min(limit * 4, 200) : limit;

  try {
    let advisories: Advisory[] = [];

    if (issuerParam === 'vendor') {
      advisories = await fetchVendorAdvisories(undefined, fetchLimit);
    } else if (issuerParam === 'cert') {
      // Meta-value: ALL CERT feeds, no vendor patches. `getSupportedCertIssuers()`
      // returns cisa|ncsc_uk|enisa|cert_eu|jpcert|acsc|cccs, so 'cert' collides
      // with no real issuer — but this branch must precede the `certSupported`
      // check regardless. This is what `useAdvisoryData` requests, and it is the
      // reason the `advisories` store slice can be CERT-only by construction.
      advisories = await fetchCertAdvisories(undefined, fetchLimit);
    } else if (issuerParam && certSupported.has(issuerParam)) {
      advisories = await fetchCertAdvisories(issuerParam as CertIssuer, fetchLimit);
    } else {
      // No issuer param at all: combine CERT + vendor advisories. Unrecognized
      // values can no longer reach here — they 400 above.
      const perBucket = Math.max(10, Math.ceil(fetchLimit / 2));
      const [cert, vendor] = await Promise.all([
        fetchCertAdvisories(undefined, perBucket),
        fetchVendorAdvisories(undefined, perBucket),
      ]);
      advisories = [...cert, ...vendor];
      advisories.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
      // `id` is NOT reassigned here any more. It used to be renumbered
      // positionally (`a.id = i + 1`), which made it shift between polls — and
      // it is used as a React key downstream. The collectors now derive a
      // stable id from `advisoryId`.
    }

    if (severity) {
      advisories = advisories.filter((a) => a.severity === severity);
    }

    const trimmed = advisories.slice(0, limit);

    return withCacheHeaders(
      NextResponse.json({
        data: trimmed,
        count: trimmed.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch advisories' },
      { status: 500 },
    );
  }
}
