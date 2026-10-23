/**
 * Tests for the Phase 11.A.4 forecast-aggregations cron route.
 *
 * Mocks `refreshEpss` and `refreshAggregations` so we exercise the
 * route's own concerns (auth gate, response shape, error capture) in
 * isolation from the underlying refresh logic — those modules have
 * their own test suites.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRefreshEpss = vi.fn();
const mockRefreshAggregations = vi.fn();

vi.mock('@/lib/data/collectors/epss', () => ({
  refreshEpss: (...a: unknown[]) => mockRefreshEpss(...a),
}));
vi.mock('@/lib/aegis/forecasting/aggregations', () => ({
  refreshAggregations: (...a: unknown[]) => mockRefreshAggregations(...a),
}));

const { POST, GET } = await import('./route');

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockRefreshEpss.mockReset();
  mockRefreshAggregations.mockReset();
  process.env.CRON_SECRET = 'test-cron-secret-test-only-secret-with-32-characters';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  }
});

function authedReq(method: 'GET' | 'POST'): Request {
  return new Request('http://localhost/api/aegis/forecast-aggregations', {
    method,
    headers: { 'x-cron-secret': 'test-cron-secret-test-only-secret-with-32-characters' },
  });
}

describe('GET /api/aegis/forecast-aggregations — auth', () => {
  it('returns 401 with missing cron secret', async () => {
    const res = await GET(new Request('http://localhost/api/aegis/forecast-aggregations'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.errors).toBeDefined();
  });

  it('returns 401 with wrong cron secret', async () => {
    const res = await GET(
      new Request('http://localhost/api/aegis/forecast-aggregations', {
        headers: { 'x-cron-secret': 'wrong' },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/aegis/forecast-aggregations — happy', () => {
  it('runs both passes and reports ok:true on success', async () => {
    mockRefreshEpss.mockResolvedValueOnce({
      ok: true,
      updated: 5,
      emittedHistoryEvents: 2,
      batches: 1,
    });
    mockRefreshAggregations.mockResolvedValueOnce({
      rowsTouched: 730,
      perMetric: { kev_adds: 6, incidents: 4, breaches: 6, advisories: 1, geo_events: 6 },
      ms: 1234,
    });

    const res = await POST(authedReq('POST'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.epss.updated).toBe(5);
    expect(json.aggregations.rowsTouched).toBe(730);
    expect(json.errors).toEqual([]);
  });

  it('still runs aggregations when EPSS throws', async () => {
    mockRefreshEpss.mockRejectedValueOnce(new Error('epss network down'));
    mockRefreshAggregations.mockResolvedValueOnce({
      rowsTouched: 100,
      perMetric: { kev_adds: 0, incidents: 0, breaches: 0, advisories: 0, geo_events: 0 },
      ms: 50,
    });

    const res = await POST(authedReq('POST'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false); // ok=false because EPSS threw
    expect(json.epss).toMatchObject({ ok: false });
    expect(json.aggregations.rowsTouched).toBe(100); // aggregations still ran
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0]).toMatch(/epss/);
  });

  it('reports ok:false when aggregations throws', async () => {
    mockRefreshEpss.mockResolvedValueOnce({
      ok: true,
      updated: 0,
      batches: 0,
      emittedHistoryEvents: 0,
    });
    mockRefreshAggregations.mockRejectedValueOnce(new Error('SQL crash'));

    const res = await POST(authedReq('POST'));
    expect(res.status).toBe(200); // fail-soft — never 500 from a cron route
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.errors[0]).toMatch(/aggregations/);
  });

  it('accepts rate-limited EPSS as a non-error state', async () => {
    mockRefreshEpss.mockResolvedValueOnce({
      ok: false,
      reason: 'rate_limited',
      updated: 0,
      batches: 0,
      emittedHistoryEvents: 0,
    });
    mockRefreshAggregations.mockResolvedValueOnce({
      rowsTouched: 100,
      perMetric: { kev_adds: 0, incidents: 0, breaches: 0, advisories: 0, geo_events: 0 },
      ms: 50,
    });

    const res = await POST(authedReq('POST'));
    const json = await res.json();
    // ok=true because rate_limited isn't an error; aggregations ran
    expect(json.ok).toBe(true);
    expect(json.epss.reason).toBe('rate_limited');
    expect(json.errors).toEqual([]);
  });
});

describe('GET /api/aegis/forecast-aggregations — same as POST', () => {
  it('GET handler runs the refresh too (Vercel Cron sends GET)', async () => {
    mockRefreshEpss.mockResolvedValueOnce({
      ok: true,
      updated: 0,
      batches: 0,
      emittedHistoryEvents: 0,
    });
    mockRefreshAggregations.mockResolvedValueOnce({
      rowsTouched: 1,
      perMetric: { kev_adds: 0, incidents: 0, breaches: 0, advisories: 0, geo_events: 0 },
      ms: 10,
    });

    const res = await GET(authedReq('GET'));
    expect(res.status).toBe(200);
    expect(mockRefreshEpss).toHaveBeenCalledTimes(1);
    expect(mockRefreshAggregations).toHaveBeenCalledTimes(1);
  });
});
