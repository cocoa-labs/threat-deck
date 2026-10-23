/**
 * Tests for the breaking-tweet route. Same pattern as daily-brief — mock
 * the generator + rate-limit + audit, verify auth + body validation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerate = vi.fn();
vi.mock('@/lib/twitter/content', () => ({
  generateBreakingTweet: (...a: unknown[]) => mockGenerate(...a),
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

const { POST } = await import('./route');

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockGenerate.mockReset();
  process.env.CRON_SECRET = 'test-secret-test-only-secret-with-32-characters';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function authedReq(body: object | string): Request {
  return new Request('http://localhost/api/twitter/breaking', {
    method: 'POST',
    headers: {
      'x-cron-secret': 'test-secret-test-only-secret-with-32-characters',
      'content-type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/twitter/breaking', () => {
  it('returns 401 with missing cron secret', async () => {
    const res = await POST(
      new Request('http://localhost/api/twitter/breaking', {
        method: 'POST',
        body: JSON.stringify({ sourceAlertId: 1 }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 with non-JSON body', async () => {
    const res = await POST(authedReq('not json'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'invalid_body' });
  });

  it('returns 400 with missing sourceAlertId', async () => {
    const res = await POST(authedReq({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'invalid_sourceAlertId' });
  });

  it('returns ok:true on successful generation', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: true,
      draftId: 99,
      tweetCount: 1,
      preview: '[CRITICAL] KEV add',
    });
    const res = await POST(authedReq({ sourceAlertId: 100 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, draftId: 99, tweetCount: 1 });
    expect(mockGenerate).toHaveBeenCalledWith({
      sourceAlertId: 100,
      createdBy: 'agent:breaking',
    });
  });

  it('returns ok:false with reason when generator declines', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: false,
      reason: 'no_qualifying_items',
      details: 'no alert id=100',
    });
    const res = await POST(authedReq({ sourceAlertId: 100 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, reason: 'no_qualifying_items' });
  });
});
