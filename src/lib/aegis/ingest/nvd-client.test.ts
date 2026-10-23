import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Keep the inter-page delay on the fast (key-present) branch — 600ms vs 6500ms.
// The mocked fetch ignores the header value, so a dummy key only affects pacing.
let restoreKey: string | undefined;
let keyWasSet = false;
beforeAll(() => {
  keyWasSet = 'NVD_API_KEY' in process.env;
  restoreKey = process.env.NVD_API_KEY;
  process.env.NVD_API_KEY = process.env.NVD_API_KEY ?? 'test';
});
afterAll(() => {
  if (keyWasSet) process.env.NVD_API_KEY = restoreKey;
  else delete process.env.NVD_API_KEY;
});

describe('fetchNvdWindow', () => {
  it('pages through results and returns all CVEs', async () => {
    vi.resetModules();
    const page = (startIndex: number, total: number, ids: string[]) => ({
      ok: true,
      status: 200,
      json: async () => ({
        resultsPerPage: ids.length,
        startIndex,
        totalResults: total,
        vulnerabilities: ids.map((id) => ({
          cve: {
            id,
            published: '2026-06-06T00:00:00.000',
            lastModified: '2026-06-06T00:00:00.000',
          },
        })),
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(0, 3, ['CVE-2026-1', 'CVE-2026-2']))
      .mockResolvedValueOnce(page(2, 3, ['CVE-2026-3']));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchNvdWindow } = await import('./nvd-client');
    const res = await fetchNvdWindow('2026-06-05T00:00:00.000Z', '2026-06-06T00:00:00.000Z');
    expect(res.map((c) => c.id)).toEqual(['CVE-2026-1', 'CVE-2026-2', 'CVE-2026-3']);
    vi.unstubAllGlobals();
  });
});
