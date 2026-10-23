/**
 * Tests for /api/data/advisories issuer routing and the severity filter.
 *
 * Two things are load-bearing here:
 *  - `issuer=cert` is what makes the CERT-only store slice possible. If it ever
 *    leaked a vendor row, `useAdvisoryData` would put vendor patches back into
 *    the advisories slice and the whole split would silently unwind.
 *  - the severity filter is applied AFTER the fetch, so it under-filled:
 *    `?severity=critical&limit=30` fetched 30 then filtered down to a handful.
 *
 * The collectors are mocked so this asserts routing, not upstream RSS.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Advisory } from '@/lib/types';

function advisory(overrides: Partial<Advisory>): Advisory {
  return {
    id: 1,
    issuer: 'cisa',
    publishedAt: '2026-07-22T12:00:00Z',
    severity: 'medium',
    ...overrides,
  } as Advisory;
}

const CERT_POOL: Advisory[] = Array.from({ length: 40 }, (_, i) =>
  advisory({
    advisoryId: `cisa-${i}`,
    issuer: 'cisa',
    title: `CERT advisory ${i}`,
    // Every 4th is critical — a naive fetch-then-filter under-fills badly.
    severity: i % 4 === 0 ? 'critical' : 'medium',
  }),
);
const VENDOR_POOL: Advisory[] = Array.from({ length: 40 }, (_, i) =>
  advisory({ advisoryId: `chrome-${i}`, issuer: 'vendor', title: `Vendor patch ${i}` }),
);

const fetchCertAdvisories = vi.fn(async (_issuer?: string, limit = 30) =>
  CERT_POOL.slice(0, limit),
);
const fetchVendorAdvisories = vi.fn(async (_vendor?: string, limit = 30) =>
  VENDOR_POOL.slice(0, limit),
);

vi.mock('@/lib/data/collectors/breach-feed', () => ({
  fetchCertAdvisories: (issuer?: string, limit?: number) => fetchCertAdvisories(issuer, limit),
  getSupportedCertIssuers: () => ['cisa', 'ncsc_uk', 'enisa', 'cert_eu', 'jpcert', 'acsc', 'cccs'],
}));
vi.mock('@/lib/data/collectors/vendor-patches', () => ({
  fetchVendorAdvisories: (vendor?: string, limit?: number) => fetchVendorAdvisories(vendor, limit),
  // The route consults this to tell a caller that `?issuer=microsoft` is a
  // vendor name, not an issuer.
  getSupportedVendors: () => ['microsoft', 'apple', 'ubuntu', 'redhat', 'chrome', 'mozilla'],
}));

const { GET } = await import('./route');

async function get(qs: string): Promise<{ data: Advisory[]; count: number }> {
  const res = await GET(new Request(`http://localhost:3002/api/data/advisories${qs}`));
  return (await res.json()) as { data: Advisory[]; count: number };
}

async function getRaw(qs: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await GET(new Request(`http://localhost:3002/api/data/advisories${qs}`));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  fetchCertAdvisories.mockClear();
  fetchVendorAdvisories.mockClear();
});

describe('issuer routing', () => {
  it('issuer=cert returns CERT only and never touches the vendor collector', async () => {
    const { data } = await get('?issuer=cert&limit=10');

    expect(data.every((a) => a.issuer !== 'vendor')).toBe(true);
    expect(fetchVendorAdvisories).not.toHaveBeenCalled();
    // Undefined issuer = ALL cert feeds, not one.
    expect(fetchCertAdvisories).toHaveBeenCalledWith(undefined, 10);
  });

  it('issuer=vendor returns vendor only and never touches the CERT collector', async () => {
    const { data } = await get('?issuer=vendor&limit=10');

    expect(data.every((a) => a.issuer === 'vendor')).toBe(true);
    expect(fetchCertAdvisories).not.toHaveBeenCalled();
  });

  it('a specific CERT issuer still routes to that one feed', async () => {
    await get('?issuer=jpcert&limit=5');
    expect(fetchCertAdvisories).toHaveBeenCalledWith('jpcert', 5);
    expect(fetchVendorAdvisories).not.toHaveBeenCalled();
  });

  it('no issuer merges both', async () => {
    const { data } = await get('?limit=20');
    expect(data.some((a) => a.issuer === 'vendor')).toBe(true);
    expect(data.some((a) => a.issuer !== 'vendor')).toBe(true);
  });

  // The fallthrough: an unrecognized issuer used to land in the merge branch,
  // so a caller who asked to narrow silently got MORE than they asked for.
  it('rejects a vendor NAME as an issuer and points at the right route', async () => {
    const { status, body } = await getRaw('?issuer=microsoft&limit=10');

    expect(status).toBe(400);
    expect(body.error).toBe('invalid_issuer');
    expect(body.hint).toContain('/api/data/patches?vendor=microsoft');
    // Nothing was fetched — it must not quietly serve the union.
    expect(fetchCertAdvisories).not.toHaveBeenCalled();
    expect(fetchVendorAdvisories).not.toHaveBeenCalled();
  });

  it('rejects any other unknown issuer and enumerates the valid ones', async () => {
    const { status, body } = await getRaw('?issuer=nonsense');

    expect(status).toBe(400);
    expect(body.error).toBe('invalid_issuer');
    expect(body.valid).toEqual(expect.arrayContaining(['cert', 'vendor', 'cisa', 'jpcert']));
  });

  it('does not cache a rejection', async () => {
    const res = await GET(new Request('http://localhost:3002/api/data/advisories?issuer=bogus'));
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});

describe('severity filter', () => {
  it('fills the requested limit instead of under-filling', async () => {
    // 40 CERT items, 10 of them critical. Fetch-then-filter at limit=5 used to
    // return whatever few criticals happened to be in the first 5 rows.
    const { data, count } = await get('?issuer=cert&severity=critical&limit=5');

    expect(count).toBe(5);
    expect(data.every((a) => a.severity === 'critical')).toBe(true);
  });

  it('over-fetches only when a severity filter is present', async () => {
    await get('?issuer=cert&limit=10');
    expect(fetchCertAdvisories).toHaveBeenLastCalledWith(undefined, 10);

    await get('?issuer=cert&severity=critical&limit=10');
    const lastLimit = fetchCertAdvisories.mock.calls.at(-1)?.[1] as number;
    expect(lastLimit).toBeGreaterThan(10);
  });

  it('rejects an invalid severity instead of silently returning every severity', async () => {
    const { status, body } = await getRaw('?issuer=cert&severity=apocalyptic&limit=5');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_severity');
    expect(body.valid).toContain('critical');
  });
});

describe('stable ids', () => {
  it('does not renumber the merged result positionally', async () => {
    const { data } = await get('?limit=20');
    const ids = data.map((a) => a.id);
    // The old code set these to 1..N in sort order.
    expect(ids).not.toEqual(ids.map((_, i) => i + 1));
  });
});
