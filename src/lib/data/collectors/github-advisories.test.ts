/**
 * Tests for the GitHub Security Advisories (GHSA) collector.
 *
 * `fetch` is stubbed via `vi.stubGlobal`; the rate-limiter is mocked
 * (`vi.doMock`) so the collector takes its happy path without touching Redis
 * or the in-memory limiter. We assert:
 *   - the GHSA → Advisory field mapping (incl. moderate → medium)
 *   - it returns [] (never throws) on a non-OK response
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Advisory } from '@/lib/types';

// A representative GHSA API payload: a critical item with a CVE + two affected
// packages, and a MODERATE item with no CVE (exercises moderate → medium and
// the empty affectedCves branch).
const SAMPLE_GHSA = [
  {
    ghsa_id: 'GHSA-aaaa-bbbb-cccc',
    cve_id: 'CVE-2026-12345',
    summary: 'Remote code execution in example-lib',
    description: 'A crafted input triggers RCE in example-lib before 2.1.0.',
    severity: 'critical',
    published_at: '2026-06-05T12:00:00Z',
    html_url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    vulnerabilities: [
      { package: { ecosystem: 'npm', name: 'example-lib' } },
      { package: { ecosystem: 'npm', name: 'example-lib-core' } },
      // dupe — must be deduped
      { package: { ecosystem: 'npm', name: 'example-lib' } },
    ],
  },
  {
    ghsa_id: 'GHSA-dddd-eeee-ffff',
    cve_id: null,
    summary: 'Prototype pollution in widget-utils',
    description: 'widget-utils mishandles __proto__ keys.',
    severity: 'moderate', // GHSA scale — must map to our `medium`
    published_at: '2026-06-04T09:30:00Z',
    html_url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff',
    vulnerabilities: [{ package: { ecosystem: 'npm', name: 'widget-utils' } }],
  },
];

function mockRateLimiterHappyPath() {
  vi.doMock('@/lib/data/rate-limiter', () => ({
    checkRateLimit: () => true,
    getCached: async () => null,
    setCache: async () => {},
    isBackedOff: () => false,
    setBackoff: () => {},
  }));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock('@/lib/data/rate-limiter');
  vi.unstubAllGlobals();
});

describe('fetchGithubAdvisories — mapping', () => {
  it('maps GHSA fields to the Advisory shape (incl. moderate → medium)', async () => {
    mockRateLimiterHappyPath();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => SAMPLE_GHSA,
      })),
    );

    const { fetchGithubAdvisories } = await import('./github-advisories');
    const advisories: Advisory[] = await fetchGithubAdvisories(50);

    expect(advisories).toHaveLength(2);

    // Newest-first: the critical item (2026-06-05) sorts ahead of the moderate.
    const critical = advisories[0];
    expect(critical?.advisoryId).toBe('GHSA-aaaa-bbbb-cccc'); // ghsa_id → advisoryId
    expect(critical?.issuer).toBe('vendor');
    expect(critical?.issuerGeography).toBe('global');
    expect(critical?.severity).toBe('critical');
    expect(critical?.title).toBe('Remote code execution in example-lib'); // summary → title
    expect(critical?.summary).toBe('A crafted input triggers RCE in example-lib before 2.1.0.'); // description → summary
    expect(critical?.affectedCves).toEqual(['CVE-2026-12345']); // cve_id → affectedCves
    // package names → affectedProducts (deduped)
    expect(critical?.affectedProducts).toEqual(['example-lib', 'example-lib-core']);
    expect(critical?.advisoryUrl).toBe('https://github.com/advisories/GHSA-aaaa-bbbb-cccc'); // html_url → advisoryUrl
    expect(critical?.publishedAt).toBe('2026-06-05T12:00:00Z');

    const moderate = advisories[1];
    expect(moderate?.advisoryId).toBe('GHSA-dddd-eeee-ffff');
    expect(moderate?.severity).toBe('medium'); // GHSA `moderate` → our `medium`
    expect(moderate?.affectedCves).toEqual([]); // null cve_id → []
    expect(moderate?.affectedProducts).toEqual(['widget-utils']);
  });

  it('truncates an over-long description to ~500 chars', async () => {
    mockRateLimiterHappyPath();
    const longDesc = 'x'.repeat(900);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [
          {
            ghsa_id: 'GHSA-long-desc-0001',
            cve_id: null,
            summary: 'Long description advisory',
            description: longDesc,
            severity: 'low',
            published_at: '2026-06-01T00:00:00Z',
            html_url: 'https://github.com/advisories/GHSA-long-desc-0001',
            vulnerabilities: [],
          },
        ],
      })),
    );

    const { fetchGithubAdvisories } = await import('./github-advisories');
    const advisories = await fetchGithubAdvisories(50);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.summary?.length).toBe(500);
  });
});

describe('fetchGithubAdvisories — fail-soft', () => {
  it('returns [] (never throws) on a non-OK response', async () => {
    mockRateLimiterHappyPath();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    );

    const { fetchGithubAdvisories } = await import('./github-advisories');
    await expect(fetchGithubAdvisories(50)).resolves.toEqual([]);
  });

  it('returns [] when fetch rejects', async () => {
    mockRateLimiterHappyPath();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const { fetchGithubAdvisories } = await import('./github-advisories');
    await expect(fetchGithubAdvisories(50)).resolves.toEqual([]);
  });
});
