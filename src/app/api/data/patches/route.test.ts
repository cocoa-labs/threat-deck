/**
 * Tests for /api/data/patches vendor filtering.
 *
 * Same defect class as the issuer fallthrough on /api/data/advisories: an
 * unrecognized vendor was coerced to `undefined`, which the collector reads as
 * "all vendors" — so a caller who asked to narrow got the full set back with no
 * signal that their filter had been discarded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Advisory } from '@/lib/types';

const VENDOR_POOL: Advisory[] = Array.from(
  { length: 10 },
  (_, i) =>
    ({
      id: i,
      advisoryId: `chrome-${i}`,
      issuer: 'vendor',
      publishedAt: '2026-07-22T12:00:00Z',
      severity: 'medium',
      title: `Vendor patch ${i}`,
    }) as Advisory,
);

const fetchVendorAdvisories = vi.fn(async (_vendor?: string, limit = 30) =>
  VENDOR_POOL.slice(0, limit),
);

vi.mock('@/lib/data/collectors/vendor-patches', () => ({
  fetchVendorAdvisories: (vendor?: string, limit?: number) => fetchVendorAdvisories(vendor, limit),
  getSupportedVendors: () => ['microsoft', 'apple', 'ubuntu', 'redhat', 'chrome', 'mozilla'],
}));

const { GET } = await import('./route');

async function get(qs: string) {
  const res = await GET(new Request(`http://localhost:3002/api/data/patches${qs}`));
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json()) as Record<string, unknown>,
  };
}

beforeEach(() => {
  fetchVendorAdvisories.mockClear();
});

describe('vendor filter', () => {
  it('passes a supported vendor straight through', async () => {
    const { status } = await get('?vendor=chrome&limit=5');
    expect(status).toBe(200);
    expect(fetchVendorAdvisories).toHaveBeenCalledWith('chrome', 5);
  });

  it('an absent vendor still means all vendors', async () => {
    const { status } = await get('?limit=5');
    expect(status).toBe(200);
    expect(fetchVendorAdvisories).toHaveBeenCalledWith(undefined, 5);
  });

  it('rejects an unknown vendor instead of silently returning every vendor', async () => {
    const { status, body } = await get('?vendor=nonsense&limit=5');

    expect(status).toBe(400);
    expect(body.error).toBe('invalid_vendor');
    expect(body.vendor).toBe('nonsense');
    expect(body.valid).toEqual(expect.arrayContaining(['chrome', 'ubuntu']));
    // The collector must not run — that was the silent-superset bug.
    expect(fetchVendorAdvisories).not.toHaveBeenCalled();
  });

  it('is case-insensitive on a valid vendor', async () => {
    const { status } = await get('?vendor=CHROME');
    expect(status).toBe(200);
    expect(fetchVendorAdvisories).toHaveBeenCalledWith('chrome', 30);
  });

  it('does not cache a rejection', async () => {
    const { headers } = await get('?vendor=nonsense');
    expect(headers.get('Cache-Control')).toBeNull();
  });
});
