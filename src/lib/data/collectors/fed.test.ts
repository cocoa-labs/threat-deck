/**
 * Tests for the FRED economic-data collector resilience behavior.
 *
 * Focus: a transient FRED outage must NOT hang the route (fail-fast), and the
 * collector must serve last-known-good REAL data flagged `stale` rather than
 * silently presenting synthetic demo numbers as live.
 *
 * We mock `@/lib/data/rate-limiter` (per the epss.test.ts pattern) so the cache
 * is fully controllable in-test (no Redis / shared memCache flakiness), and stub
 * global `fetch` per scenario. `fetchFedData` is imported dynamically AFTER the
 * mock is installed.
 *
 * Note: the real AbortSignal.timeout firing is covered by the manual dev curl
 * (verification step 3); here we model the abort as a rejected fetch, which
 * exercises the identical per-series catch → skip → fallback path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FedData } from '@/lib/types';

// Shape-only 32-char key (never a real FRED key) so the API-key guard passes.
const TEST_KEY = 'testkey00000000000000000000000000';

type FetchImpl = (...args: unknown[]) => Promise<unknown>;

function okResponse(observations: { date: string; value: string }[]) {
  return { ok: true, status: 200, json: async () => ({ observations }) };
}

async function loadFed(opts: {
  caches?: Record<string, unknown>;
  fetchImpl: FetchImpl;
  rateLimited?: boolean;
}): Promise<{
  fetchFedData: typeof import('./fed').fetchFedData;
  caches: Record<string, unknown>;
}> {
  const caches = opts.caches ?? {};
  vi.resetModules();
  vi.doMock('@/lib/data/rate-limiter', async () => {
    const actual =
      await vi.importActual<typeof import('@/lib/data/rate-limiter')>('@/lib/data/rate-limiter');
    return {
      ...actual,
      checkRateLimit: () => !opts.rateLimited,
      getCached: async (key: string) => caches[key] ?? null,
      setCache: async (key: string, value: unknown) => {
        caches[key] = value;
      },
    };
  });
  vi.stubGlobal('fetch', vi.fn(opts.fetchImpl));
  vi.stubEnv('FRED_API_KEY', TEST_KEY);
  const mod = await import('./fed');
  return { fetchFedData: mod.fetchFedData, caches };
}

afterEach(() => {
  vi.doUnmock('@/lib/data/rate-limiter');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchFedData — resilience', () => {
  it('serves live data (no stale flag) and snapshots last-known-good on success', async () => {
    const { fetchFedData, caches } = await loadFed({
      fetchImpl: async () =>
        okResponse([
          { date: '2026-03-01', value: '30000' },
          { date: '2025-12-01', value: '29000' },
        ]),
    });

    const result = await fetchFedData(['gdp']);

    expect(result.gdp?.value).toBe(30000);
    expect(result.stale).toBeFalsy();
    // A long-lived snapshot is persisted so a later outage can serve real data.
    expect(caches['fed:lastgood:v3']).toBeDefined();
    expect((caches['fed:lastgood:v3'] as FedData).gdp?.value).toBe(30000);
  });

  it('returns unavailable without inventing figures when FRED returns 502', async () => {
    const { fetchFedData } = await loadFed({
      fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }),
    });

    const result = await fetchFedData(['gdp']);

    expect(result.stale).toBe(true);
    expect(result._demo).toBeFalsy();
    expect(result.gdp).toBeUndefined();
  });

  it('fails fast (does not hang) when the FRED fetch aborts/rejects', async () => {
    const timeoutErr = Object.assign(new Error('The operation timed out'), {
      name: 'TimeoutError',
    });
    const { fetchFedData } = await loadFed({
      fetchImpl: async () => {
        throw timeoutErr;
      },
    });

    const result = await fetchFedData(['gdp']);

    expect(result.stale).toBe(true);
    expect(result._demo).toBeFalsy();
  });

  it('serves last-known-good REAL data flagged stale during an outage', async () => {
    const lastGood: FedData = { gdp: { value: 99_999, change: 1.2, date: '2026-01-01' } };
    const { fetchFedData } = await loadFed({
      caches: { 'fed:lastgood:v3': lastGood },
      fetchImpl: async () => ({ ok: false, status: 504, json: async () => ({}) }),
    });

    const result = await fetchFedData(['gdp']);

    expect(result.stale).toBe(true);
    expect(result._demo).toBeFalsy(); // real snapshot — not synthetic
    expect(result.gdp?.value).toBe(99_999);
  });

  it('returns the stale snapshot when rate-limited (no live call made)', async () => {
    const lastGood: FedData = { gdp: { value: 88_888, change: 0, date: '2026-02-01' } };
    const { fetchFedData } = await loadFed({
      caches: { 'fed:lastgood:v3': lastGood },
      fetchImpl: async () => {
        throw new Error('fetch must not be called when rate-limited');
      },
      rateLimited: true,
    });

    const result = await fetchFedData(['gdp']);

    expect(result.stale).toBe(true);
    expect(result.gdp?.value).toBe(88_888);
  });
});
