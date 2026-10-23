/**
 * Tests for POST /api/outbound/generate-video.
 *
 * The route is thin: auth → validate/normalize the popover knobs → delegate to
 * startVideoGeneration → map the marker to an HTTP status. These lock that
 * contract (auth, duration clamping, aspect-ratio allowlist, spend-cap → 429).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.fn();
const mockStartVideo = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRefund = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/visual/video-generation-service', () => ({
  startVideoGeneration: (...args: unknown[]) => mockStartVideo(...args),
}));

vi.mock('@/lib/security/rate-limit', () => ({
  getClientIp: () => 'test-ip',
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  refundRateLimit: (...args: unknown[]) => mockRefund(...args),
  withRateLimit: <H extends (req: Request, ctx?: unknown) => Response | Promise<Response>>(
    handler: H,
  ): H => handler,
}));

const { POST } = await import('./route');

function mkReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/outbound/generate-video', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function firstArg(): Record<string, unknown> {
  return (mockStartVideo.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfterSeconds: 3600 });
  mockRefund.mockResolvedValue(undefined);
  mockStartVideo.mockResolvedValue({
    ok: true,
    __generated_media: true,
    mediaKind: 'video',
    generatedMediaId: '77',
    status: 'pending',
    pollUrl: '/api/outbound/generated-media/77',
    styleTag: 'seedance_vertical',
  });
});

describe('POST /api/outbound/generate-video', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(mkReq({ messageContent: 'hi' }));
    expect(res.status).toBe(401);
    expect(mockStartVideo).not.toHaveBeenCalled();
  });

  it('returns 400 when messageContent is missing', async () => {
    const res = await POST(mkReq({ durationSeconds: 8 }));
    expect(res.status).toBe(400);
    expect(mockStartVideo).not.toHaveBeenCalled();
  });

  it('returns 202 and forwards normalized knobs + actorEmail', async () => {
    const res = await POST(
      mkReq({
        messageContent: 'render me',
        aspectRatio: '9:16',
        durationSeconds: 8,
        genre: 'noir',
        entityKind: 'kev',
        entityId: 'CVE-1',
      }),
    );

    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      generatedMediaId: '77',
      status: 'pending',
      pollUrl: '/api/outbound/generated-media/77',
    });
    expect(mockStartVideo).toHaveBeenCalledOnce();
    expect(firstArg()).toMatchObject({
      content: 'render me',
      aspectRatio: '9:16',
      durationSeconds: 8,
      genre: 'noir',
      entityKind: 'kev',
      entityId: 'CVE-1',
      actorEmail: 'alice@example.org',
    });
  });

  it('clamps duration to 5-15 and falls an out-of-enum aspect ratio back to the default', async () => {
    await POST(mkReq({ messageContent: 'x', aspectRatio: '4:5', durationSeconds: 999 }));
    expect(firstArg().durationSeconds).toBe(15);
    // normalizeVideoParams substitutes the default rather than omitting the
    // value, so both entry points send the same explicit, valid enum.
    expect(firstArg().aspectRatio).toBe('9:16');

    mockStartVideo.mockClear();
    await POST(mkReq({ messageContent: 'x', durationSeconds: 2 }));
    expect(firstArg().durationSeconds).toBe(5);
  });

  it('carries the popover resolution through to the service', async () => {
    await POST(mkReq({ messageContent: 'x', resolution: '1080p', durationSeconds: 15 }));
    expect(firstArg()).toMatchObject({ resolution: '1080p', durationSeconds: 15 });
  });

  it('falls an out-of-enum resolution back to 720p rather than passing it to the CLI', async () => {
    await POST(mkReq({ messageContent: 'x', resolution: '8k' }));
    expect(firstArg().resolution).toBe('720p');
  });

  it('promotes mode to std when a high resolution is requested', async () => {
    await POST(mkReq({ messageContent: 'x', resolution: '1080p', mode: 'fast' }));
    // `fast` only supports 480p/720p — the API would reject this AFTER staging.
    expect(firstArg().mode).toBe('std');
    expect(firstArg().resolution).toBe('1080p');
  });

  it('gates on auth BEFORE the rate limiter so a stale tab cannot burn quota', async () => {
    mockAuth.mockResolvedValueOnce(null);
    await POST(mkReq({ messageContent: 'hi' }));
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it('returns 429 when the render quota is spent', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 900,
    });
    const res = await POST(mkReq({ messageContent: 'x' }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ error: 'rate_limit_exceeded' });
    expect(mockStartVideo).not.toHaveBeenCalled();
  });

  it('refunds the quota slot when no render actually started', async () => {
    // Five auth failures used to lock the feature for an hour despite zero
    // renders and zero credits spent.
    mockStartVideo.mockResolvedValueOnce({
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      error: 'auth_required',
      detail: 'signed out',
    });
    await POST(mkReq({ messageContent: 'x' }));
    expect(mockRefund).toHaveBeenCalledWith('generate-video:alice@example.org');
  });

  it('refunds the quota slot on a dedup hit', async () => {
    mockStartVideo.mockResolvedValueOnce({
      ok: true,
      __generated_media: true,
      mediaKind: 'video',
      generatedMediaId: '5',
      status: 'pending',
      pollUrl: '/api/outbound/generated-media/5',
      dedup: true,
    });
    await POST(mkReq({ messageContent: 'dup' }));
    expect(mockRefund).toHaveBeenCalled();
  });

  it('returns 200 when the marker is a dedup hit', async () => {
    mockStartVideo.mockResolvedValueOnce({
      ok: true,
      __generated_media: true,
      mediaKind: 'video',
      generatedMediaId: '5',
      status: 'pending',
      blobUrl: null,
      pollUrl: '/api/outbound/generated-media/5',
      dedup: true,
    });
    const res = await POST(mkReq({ messageContent: 'dup' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ dedup: true, generatedMediaId: '5' });
  });

  it('returns 429 when the spend cap is exceeded', async () => {
    mockStartVideo.mockResolvedValueOnce({
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      error: 'visual_spend_cap_exceeded',
      detail: 'Daily visual spend hard cap of $25 reached.',
    });
    const res = await POST(mkReq({ messageContent: 'pricey' }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: 'visual_spend_cap_exceeded',
    });
  });

  it('returns 500 on other generation errors', async () => {
    mockStartVideo.mockResolvedValueOnce({
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      error: 'missing_cli',
      detail: 'Higgsfield CLI is not installed or not on PATH.',
    });
    const res = await POST(mkReq({ messageContent: 'broken' }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'missing_cli' });
  });

  it('returns 500 when startVideoGeneration throws', async () => {
    mockStartVideo.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(mkReq({ messageContent: 'x' }));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'generate_video_failed' });
  });
});
