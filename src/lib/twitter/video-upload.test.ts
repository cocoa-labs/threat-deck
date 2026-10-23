/**
 * Tests for uploadTweetVideoFromUrl — the X v2 chunked video upload
 * (INIT → APPEND → FINALIZE → STATUS poll). Mocks oauth + the dry-run guard and
 * stubs global fetch to drive the command sequence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetActiveToken = vi.fn();
const mockGetScopes = vi.fn();
const mockGetMissing = vi.fn();
const mockDryRun = vi.fn();

vi.mock('@/lib/twitter/oauth', () => ({
  getActiveToken: (...args: unknown[]) => mockGetActiveToken(...args),
  getActiveTokenScopes: (...args: unknown[]) => mockGetScopes(...args),
  getMissingTwitterScopes: (...args: unknown[]) => mockGetMissing(...args),
  MEDIA_UPLOAD_REQUIRED_SCOPES: ['media.write'],
}));

vi.mock('@/lib/twitter/write-client', () => ({
  getDefaultDryRun: () => mockDryRun(),
  extractTwitterError: (json: Record<string, unknown>) =>
    typeof json.detail === 'string' ? json.detail : null,
}));

const { uploadTweetVideoFromUrl } = await import('./video-upload');

const mockFetch = vi.fn();

function mp4(bytes = 2048): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'video/mp4' },
  });
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  mockGetActiveToken.mockResolvedValue('tok');
  mockGetScopes.mockResolvedValue(['media.write', 'tweet.write']);
  mockGetMissing.mockReturnValue([]);
  mockDryRun.mockReturnValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('uploadTweetVideoFromUrl', () => {
  it('rejects a non-https url', async () => {
    const r = await uploadTweetVideoFromUrl('http://insecure/clip.mp4');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_url');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('dry-runs without hitting the network', async () => {
    mockDryRun.mockReturnValue(true);
    const r = await uploadTweetVideoFromUrl('https://blob.test/clip.mp4');
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports a missing media.write scope', async () => {
    mockGetMissing.mockReturnValue(['media.write']);
    const r = await uploadTweetVideoFromUrl('https://blob.test/clip.mp4');
    expect(r).toMatchObject({ ok: false, error: 'missing_scope' });
  });

  it('maps a blob fetch failure to fetch_failed', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    const r = await uploadTweetVideoFromUrl('https://blob.test/clip.mp4');
    expect(r).toMatchObject({ ok: false, error: 'fetch_failed' });
  });

  it('rejects a non-video content-type', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(new Uint8Array(8), { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const r = await uploadTweetVideoFromUrl('https://blob.test/notvideo.png');
    expect(r).toMatchObject({ ok: false, error: 'unsupported_media' });
  });

  it('runs INIT → APPEND → FINALIZE on the v2 sub-path endpoints (JSON) and returns the media id', async () => {
    mockFetch
      .mockResolvedValueOnce(mp4(1000)) // blob fetch
      .mockResolvedValueOnce(json({ data: { id: 'media-1' } })) // INIT
      .mockResolvedValueOnce(json({})) // APPEND
      .mockResolvedValueOnce(
        json({ data: { id: 'media-1', processing_info: { state: 'succeeded' } } }),
      ); // FINALIZE

    const r = await uploadTweetVideoFromUrl('https://blob.test/clip.mp4');
    expect(r).toMatchObject({ ok: true, mediaId: 'media-1' });

    // INIT → POST /2/media/upload/initialize as application/json (NOT the base
    // endpoint with a multipart command body — that's what X 400'd on).
    const [initUrl, initInit] = mockFetch.mock.calls[1] ?? [];
    expect(String(initUrl)).toBe('https://api.x.com/2/media/upload/initialize');
    expect((initInit as RequestInit | undefined)?.headers).toMatchObject({
      'content-type': 'application/json',
    });
    expect(JSON.parse(String((initInit as RequestInit).body))).toMatchObject({
      media_category: 'tweet_video',
      media_type: 'video/mp4',
      total_bytes: 1000,
    });

    // APPEND → POST /2/media/upload/{id}/append as multipart/form-data with the
    // RAW binary chunk (NOT base64 JSON — that inflated the body past X's size
    // cap → HTTP 413).
    const [appendUrl, appendInit] = mockFetch.mock.calls[2] ?? [];
    expect(String(appendUrl)).toBe('https://api.x.com/2/media/upload/media-1/append');
    const appendBody = (appendInit as RequestInit).body;
    expect(appendBody).toBeInstanceOf(FormData);
    expect((appendBody as FormData).get('segment_index')).toBe('0');
    expect((appendBody as FormData).get('media')).toBeTruthy();

    // FINALIZE → POST /2/media/upload/{id}/finalize
    expect(String(mockFetch.mock.calls[3]?.[0])).toBe(
      'https://api.x.com/2/media/upload/media-1/finalize',
    );
  });

  it('polls STATUS until processing succeeds', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(mp4(1000)) // blob
      .mockResolvedValueOnce(json({ data: { id: 'm2' } })) // INIT
      .mockResolvedValueOnce(json({})) // APPEND
      .mockResolvedValueOnce(
        json({
          data: { id: 'm2', processing_info: { state: 'in_progress', check_after_secs: 1 } },
        }),
      ) // FINALIZE
      .mockResolvedValueOnce(json({ data: { processing_info: { state: 'succeeded' } } })); // STATUS

    const promise = uploadTweetVideoFromUrl('https://blob.test/clip.mp4');
    await vi.runAllTimersAsync();
    const r = await promise;
    expect(r).toMatchObject({ ok: true, mediaId: 'm2' });
    expect(String(mockFetch.mock.calls[4]?.[0])).toContain('command=STATUS');
  });

  it('maps a processing failure (codec) to processing_failed', async () => {
    mockFetch
      .mockResolvedValueOnce(mp4(1000))
      .mockResolvedValueOnce(json({ data: { id: 'm3' } }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        json({
          data: {
            id: 'm3',
            processing_info: { state: 'failed', error: { message: 'InvalidMedia' } },
          },
        }),
      );
    const r = await uploadTweetVideoFromUrl('https://blob.test/clip.mp4');
    expect(r).toMatchObject({ ok: false, error: 'processing_failed' });
    expect(r.detail).toContain('InvalidMedia');
  });
});
