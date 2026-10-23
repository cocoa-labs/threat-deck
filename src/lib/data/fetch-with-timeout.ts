import { safeFetch } from '@/lib/security/safe-fetch';
/**
 * `fetch` with a hard wall-clock bound.
 *
 * The cyber collectors (threat-iocs, cve-feed, breach-feed, twitter,
 * mitre-attack) called raw `fetch` with no timeout, so a stalled upstream —
 * abuse.ch, the X API, NVD, HIBP — held the request until undici's default
 * socket behaviour finally errored (observed at 10–18s in the dev logs). Every
 * one of those call sites already funnels a thrown fetch into a demo/`[]`
 * fallback, so bounding the request just makes the fallback reached promptly.
 *
 * Composes with a caller-supplied `signal` via `AbortSignal.any`, so an
 * upstream abort (request cancel) and the timeout both still fire.
 *
 * On timeout the returned promise rejects with a `TimeoutError` DOMException —
 * caught by the caller's existing try/catch, same as any other fetch failure.
 */

/** Default bound: aggressive enough to beat the 10–18s hangs, generous enough
 * for a slow-but-healthy best-effort feed. Sits between the codebase's existing
 * 5s (interactive) and 10s (financial-calendar) inline timeouts. */
export const DEFAULT_FETCH_TIMEOUT_MS = 8_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  maxBytes = 8 * 1024 * 1024,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return safeFetch(url, { ...init, signal }, maxBytes);
}
