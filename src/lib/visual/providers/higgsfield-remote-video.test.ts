/**
 * Tests for HiggsfieldRemoteVideoProvider — the production transport that
 * forwards startVideo/getJob to the Fly render worker. Locks the HTTP contract
 * (URL, secret header, body) and the mapping of HTTP failures onto
 * HiggsfieldCliError codes so the service's error handling keeps working.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HiggsfieldCliError } from '@/lib/visual/providers/higgsfield-cli-video';
import { HiggsfieldRemoteVideoProvider } from '@/lib/visual/providers/higgsfield-remote-video';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function provider(): HiggsfieldRemoteVideoProvider {
  return new HiggsfieldRemoteVideoProvider('http://worker.test/', 'sekret');
}

describe('HiggsfieldRemoteVideoProvider', () => {
  it('throws disabled when no base URL is configured', () => {
    const make = () => new HiggsfieldRemoteVideoProvider('', 'x');
    expect(make).toThrow(HiggsfieldCliError);
    let err: unknown;
    try {
      make();
    } catch (e) {
      err = e;
    }
    expect((err as HiggsfieldCliError).code).toBe('disabled');
  });

  it('startVideo POSTs to the worker with the secret header and body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        jobId: 'job-1',
        status: 'queued',
        rawStatus: 'queued',
        resultUrl: null,
        raw: { x: 1 },
      }),
    );

    const job = await provider().startVideo({
      prompt: 'p',
      aspectRatio: '9:16',
      durationSeconds: 8,
    });

    expect(job).toEqual({
      jobId: 'job-1',
      status: 'queued',
      rawStatus: 'queued',
      resultUrl: null,
      raw: { x: 1 },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://worker.test/api/internal/video/start');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-internal-render-secret']).toBe('sekret');
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: 'p',
      aspectRatio: '9:16',
      durationSeconds: 8,
    });
  });

  it('getJob GETs the job endpoint and returns the result URL', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        jobId: 'job-2',
        status: 'ready',
        rawStatus: 'completed',
        resultUrl: 'https://cdn.test/x.mp4',
        raw: {},
      }),
    );

    const job = await provider().getJob('job-2');

    expect(job.status).toBe('ready');
    expect(job.resultUrl).toBe('https://cdn.test/x.mp4');
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://worker.test/api/internal/video/job/job-2');
    expect(init.method).toBe('GET');
  });

  // A rejected shared secret is a DEPLOY problem (INTERNAL_RENDER_SECRET
  // mismatch), not an expired Higgsfield credential. Reusing 'auth_required'
  // for both sent operators to re-authenticate the CLI for the wrong reason.
  it('maps 401 → worker_secret_rejected', async () => {
    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 401 }));
    await expect(provider().getJob('j')).rejects.toMatchObject({
      code: 'worker_secret_rejected',
      transport: 'remote_worker',
    });
  });

  it("forwards the worker's own error code so an expired credential on Fly reads as auth", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'auth_required' }), { status: 500 }),
    );
    await expect(provider().getJob('j')).rejects.toMatchObject({ code: 'auth_required' });
  });

  it('maps 503 → disabled', async () => {
    mockFetch.mockResolvedValueOnce(new Response('off', { status: 503 }));
    await expect(provider().getJob('j')).rejects.toMatchObject({ code: 'disabled' });
  });

  it('maps other non-2xx → cli_failed', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(provider().getJob('j')).rejects.toMatchObject({ code: 'cli_failed' });
  });

  it('maps non-JSON body → parse_failed', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(provider().getJob('j')).rejects.toMatchObject({ code: 'parse_failed' });
  });

  it('maps a payload without a jobId → parse_failed', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ status: 'queued' }));
    await expect(provider().getJob('j')).rejects.toMatchObject({ code: 'parse_failed' });
  });

  it('maps a fetch/network failure → worker_unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(provider().getJob('j')).rejects.toMatchObject({ code: 'worker_unreachable' });
  });
});
