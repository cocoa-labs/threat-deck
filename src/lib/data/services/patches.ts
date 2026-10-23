import type { NextResponse } from 'next/server';
import {
  fetchVendorAdvisories,
  getSupportedVendors,
  type VendorKey,
} from '@/lib/data/collectors/vendor-patches';
import { feedResponse } from '@/lib/data/feed-response';

function withCacheHeaders(response: NextResponse): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, max-age=300, s-maxage=600, stale-while-revalidate=300',
  );
  return response;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vendorParam = searchParams.get('vendor')?.toLowerCase();
  const limit = Number(searchParams.get('limit')) || 30;

  const supported = new Set<string>(getSupportedVendors());

  // Same class of bug as the issuer fallthrough on /api/data/advisories: an
  // unrecognized vendor used to be coerced to `undefined`, which means "all
  // vendors" — so a caller who asked to narrow got the full set back with no
  // way to tell. An absent param still means all vendors, which is correct.
  if (vendorParam && !supported.has(vendorParam)) {
    return feedResponse(
      { error: 'invalid_vendor', vendor: vendorParam, valid: getSupportedVendors() },
      { status: 400 },
    );
  }
  const vendor = vendorParam as VendorKey | undefined;

  try {
    const data = await fetchVendorAdvisories(vendor, limit);
    return withCacheHeaders(
      feedResponse({
        data,
        count: data.length,
        timestamp: new Date().toISOString(),
      }),
    );
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch vendor patches' },
      { status: 500 },
    );
  }
}
