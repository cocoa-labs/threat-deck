import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const ADV_OK = 'TEST-ADV-0001';
const GHSA_OK = 'GHSA-test-aaaa-bbbb';

async function cleanup() {
  await query(`DELETE FROM aegis_advisories WHERE advisory_id = ANY($1)`, [[ADV_OK, GHSA_OK]]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('ingestAdvisories', () => {
  it('inserts a valid advisory, skips null advisoryId and invalid date', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/collectors/breach-feed', () => ({
      fetchCertAdvisories: async () => [
        {
          id: 1,
          advisoryId: ADV_OK,
          issuer: 'cisa',
          issuerGeography: 'us',
          publishedAt: '2026-06-06T00:00:00Z',
          severity: 'high',
          title: 'Test advisory',
          summary: 'A synthetic advisory for the ingest test.',
          affectedCves: ['CVE-2099-9999'],
          advisoryUrl: 'https://example.test/adv',
        },
        // null advisory_id → must be skipped (UNIQUE is nullable; would dupe)
        {
          id: 2,
          advisoryId: undefined,
          issuer: 'cisa',
          issuerGeography: 'us',
          publishedAt: '2026-06-06T00:00:00Z',
          title: 'No advisory id',
        },
      ],
    }));
    vi.doMock('@/lib/data/collectors/vendor-patches', () => ({
      fetchVendorAdvisories: async () => [
        // invalid publishedAt → must be skipped (NOT NULL timestamptz can't take it)
        {
          id: 3,
          advisoryId: 'TEST-ADV-BADDATE',
          issuer: 'vendor',
          publishedAt: 'not-a-date',
          title: 'Bad date advisory',
        },
      ],
    }));
    vi.doMock('@/lib/data/collectors/github-advisories', () => ({
      fetchGithubAdvisories: async () => [],
    }));
    const { ingestAdvisories } = await import('./ingest-advisories');

    const res = await ingestAdvisories();
    expect(res.ok).toBe(true);

    const ok = await query(`SELECT 1 FROM aegis_advisories WHERE advisory_id = $1`, [ADV_OK]);
    expect(ok.rowCount).toBe(1);

    const bad = await query(`SELECT 1 FROM aegis_advisories WHERE advisory_id = $1`, [
      'TEST-ADV-BADDATE',
    ]);
    expect(bad.rowCount).toBe(0);

    vi.doUnmock('@/lib/data/collectors/breach-feed');
    vi.doUnmock('@/lib/data/collectors/vendor-patches');
    vi.doUnmock('@/lib/data/collectors/github-advisories');
  });

  it('ingests a GHSA advisory into aegis_advisories (keyed on ghsa_id)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/collectors/breach-feed', () => ({
      fetchCertAdvisories: async () => [],
    }));
    vi.doMock('@/lib/data/collectors/vendor-patches', () => ({
      fetchVendorAdvisories: async () => [],
    }));
    vi.doMock('@/lib/data/collectors/github-advisories', () => ({
      fetchGithubAdvisories: async () => [
        {
          id: 0,
          advisoryId: GHSA_OK,
          issuer: 'vendor',
          issuerGeography: 'global',
          publishedAt: '2026-06-05T12:00:00Z',
          severity: 'medium', // from a GHSA `moderate` upstream
          title: 'Synthetic GHSA advisory for ingest test',
          summary: 'A synthetic GHSA row exercising the advisory ingest path.',
          affectedCves: ['CVE-2099-0001'],
          affectedProducts: ['example-lib', 'example-lib-core'],
          advisoryUrl: `https://github.com/advisories/${GHSA_OK}`,
        },
      ],
    }));
    const { ingestAdvisories } = await import('./ingest-advisories');

    const res = await ingestAdvisories();
    expect(res.ok).toBe(true);

    const { rows } = await query<{
      issuer: string;
      issuer_geography: string;
      severity: string;
      affected_cves: string[];
      affected_products: string[];
      advisory_url: string;
    }>(
      `SELECT issuer, issuer_geography, severity, affected_cves, affected_products, advisory_url
         FROM aegis_advisories WHERE advisory_id = $1`,
      [GHSA_OK],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.issuer).toBe('vendor');
    expect(rows[0]?.issuer_geography).toBe('global');
    expect(rows[0]?.severity).toBe('medium');
    expect(rows[0]?.affected_cves).toEqual(['CVE-2099-0001']);
    expect(rows[0]?.affected_products).toEqual(['example-lib', 'example-lib-core']);
    expect(rows[0]?.advisory_url).toBe(`https://github.com/advisories/${GHSA_OK}`);

    vi.doUnmock('@/lib/data/collectors/breach-feed');
    vi.doUnmock('@/lib/data/collectors/vendor-patches');
    vi.doUnmock('@/lib/data/collectors/github-advisories');
  });

  it('upserts by advisory_id on a second run (no dupe)', async () => {
    vi.resetModules();
    const mk = () => ({
      fetchCertAdvisories: async () => [
        {
          id: 1,
          advisoryId: ADV_OK,
          issuer: 'cisa',
          publishedAt: '2026-06-06T00:00:00Z',
          title: 'Test advisory',
        },
      ],
    });
    vi.doMock('@/lib/data/collectors/breach-feed', mk);
    vi.doMock('@/lib/data/collectors/vendor-patches', () => ({
      fetchVendorAdvisories: async () => [],
    }));
    vi.doMock('@/lib/data/collectors/github-advisories', () => ({
      fetchGithubAdvisories: async () => [],
    }));
    const { ingestAdvisories } = await import('./ingest-advisories');

    await ingestAdvisories();
    await ingestAdvisories();

    const r = await query<{ count: string }>(
      `SELECT count(*) AS count FROM aegis_advisories WHERE advisory_id = $1`,
      [ADV_OK],
    );
    expect(Number(r.rows[0]?.count)).toBe(1);

    vi.doUnmock('@/lib/data/collectors/breach-feed');
    vi.doUnmock('@/lib/data/collectors/vendor-patches');
    vi.doUnmock('@/lib/data/collectors/github-advisories');
  });
});
