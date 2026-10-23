/**
 * Tests for POST /api/outbound/x/stage — the unified "Post to X" button entry.
 * Mocks auth + rate-limit + the postToX handler so we exercise the route's
 * gating + delegation in isolation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.fn();
const mockPostToX = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/agent/outbound-tool-handlers', () => ({
  postToX: (...a: unknown[]) => mockPostToX(...a),
}));
vi.mock('@/lib/security/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rate-limit')>(
    '@/lib/security/rate-limit',
  );
  return { ...actual, withRateLimit: (h: (req: Request) => Promise<Response>) => h };
});

const { POST } = await import('./route');

function req(body: unknown): Request {
  return new Request('http://localhost/api/outbound/x/stage', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockPostToX.mockReset();
});

describe('POST /api/outbound/x/stage', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(req({ content: 'hi' }));
    expect(res.status).toBe(401);
    expect(mockPostToX).not.toHaveBeenCalled();
  });

  it('returns 400 when content is missing', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'op@example.org' } });
    const res = await POST(req({ shape: 'thread' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('content_required');
    expect(mockPostToX).not.toHaveBeenCalled();
  });

  it('composes + stages, passing the operator email + options through', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'op@example.org' } });
    mockPostToX.mockResolvedValueOnce({
      ok: true,
      posted: false,
      tweetIds: [],
      summary: 'Staged a 5-tweet X thread in the approval queue.',
    });

    const res = await POST(
      req({ content: 'the day', shape: 'thread', tweetCount: 5, attachMediaId: '50' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, summary: expect.stringContaining('Staged') });

    expect(mockPostToX).toHaveBeenCalledTimes(1);
    expect(mockPostToX.mock.calls[0]![0]).toMatchObject({
      content: 'the day',
      shape: 'thread',
      tweetCount: 5,
      attachMediaId: '50',
      operatorEmail: 'op@example.org',
    });
  });

  it('returns 400 + error when composition/staging fails', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'op@example.org' } });
    mockPostToX.mockResolvedValueOnce({
      ok: false,
      posted: false,
      tweetIds: [],
      summary: 'NOT STAGED — could not compose.',
      error: 'llm_failed',
    });
    const res = await POST(req({ content: 'x' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: 'llm_failed' });
  });
});
