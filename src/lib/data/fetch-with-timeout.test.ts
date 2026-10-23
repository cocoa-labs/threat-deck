import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from './fetch-with-timeout';

// A fetch stub that behaves like a hung socket: it never resolves on its own,
// only settling (rejecting) when its AbortSignal fires — so the timeout is what
// ends the request, exactly as in production.
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );
}

describe('fetchWithTimeout', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes an AbortSignal through to fetch', async () => {
    const spy = vi.fn(async (_url: string, init: RequestInit = {}) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response('ok');
    });
    vi.stubGlobal('fetch', spy);

    await fetchWithTimeout('https://example.test');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('rejects once the timeout elapses on a hung request', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    await expect(fetchWithTimeout('https://example.test', {}, 10)).rejects.toBeDefined();
  });

  it('still honours a caller-supplied abort signal', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = fetchWithTimeout('https://example.test', { signal: controller.signal }, 10_000);
    controller.abort(new Error('caller cancelled'));

    await expect(pending).rejects.toBeDefined();
  });
});
