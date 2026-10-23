/**
 * Tests for GET /api/outbound/generated-media/[id].
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.fn();
const mockQuery = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/db/client', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const { GET } = await import('./route');

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
});

describe('GET /api/outbound/generated-media/[id]', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValueOnce(null);

    const res = await GET(new Request('http://localhost/api/outbound/generated-media/1'), ctx('1'));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid id', async () => {
    const res = await GET(
      new Request('http://localhost/api/outbound/generated-media/nope'),
      ctx('nope'),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'invalid id' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when the media row does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await GET(
      new Request('http://localhost/api/outbound/generated-media/99'),
      ctx('99'),
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'not found' });
  });

  it('returns pending, ready, or failed row state as JSON', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: '123',
          status: 'ready',
          blob_url: 'https://blob.example/outbound-visuals/123.png',
          error_message: null,
          cost_usd: '0.1650',
          generation_duration_ms: 12345,
          style_tag: 'crt_terminal',
          created_at: '2026-05-26 16:30:00+00',
        },
      ],
      rowCount: 1,
    });

    const res = await GET(
      new Request('http://localhost/api/outbound/generated-media/123'),
      ctx('123'),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      generatedMediaId: '123',
      status: 'ready',
      blobUrl: '/api/outbound/generated-media/123/content',
      errorMessage: null,
      costUsd: 0.165,
      generationDurationMs: 12345,
      styleTag: 'crt_terminal',
    });
  });

  it('returns JSON when a lookup error occurs', async () => {
    mockQuery.mockRejectedValueOnce(new Error('database unavailable'));

    const res = await GET(new Request('http://localhost/api/outbound/generated-media/3'), ctx('3'));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'generated_media_lookup_failed',
      detail: 'database unavailable',
    });
  });
});
