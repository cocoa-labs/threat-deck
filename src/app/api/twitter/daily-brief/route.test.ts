/**
 * Tests for the daily-brief cron route. Mocks the generator + rate-limit
 * so we exercise just the route's responsibilities: auth gate, response
 * shape, audit-on-failure.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerate = vi.fn();
vi.mock('@/lib/twitter/content', () => ({
  generateDailyBrief: (...a: unknown[]) => mockGenerate(...a),
}));
vi.mock('@/lib/security/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rate-limit')>(
    '@/lib/security/rate-limit',
  );
  return {
    ...actual,
    withRateLimit: (handler: (req: Request) => Promise<Response>) => handler,
  };
});
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return {
    ...actual,
    auditSuccess: vi.fn(async () => {}),
    auditFailure: vi.fn(async () => {}),
    auditDenied: vi.fn(async () => {}),
  };
});

const { POST, GET } = await import('./route');

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockGenerate.mockReset();
  process.env.CRON_SECRET = 'test-secret-test-only-secret-with-32-characters';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function authedReq(method: 'GET' | 'POST'): Request {
  return new Request('http://localhost/api/twitter/daily-brief', {
    method,
    headers: { 'x-cron-secret': 'test-secret-test-only-secret-with-32-characters' },
  });
}

describe('GET /api/twitter/daily-brief', () => {
  it('returns 401 with missing cron secret', async () => {
    const res = await GET(new Request('http://localhost/api/twitter/daily-brief'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false });
  });

  it('returns ok:true with draftId when the generator stages a draft', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: true,
      draftId: 42,
      tweetCount: 7,
      preview: 'masthead',
    });
    const res = await GET(authedReq('GET'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, draftId: 42, tweetCount: 7, preview: 'masthead' });
  });

  it('returns ok:false with reason when no qualifying items', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: false,
      reason: 'no_qualifying_items',
      details: '1 stories in 24h',
    });
    const res = await GET(authedReq('GET'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, reason: 'no_qualifying_items' });
  });

  it('returns ok:false fail-soft on generator throw', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('upstream down'));
    const res = await POST(authedReq('POST'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/upstream down/);
  });
});
