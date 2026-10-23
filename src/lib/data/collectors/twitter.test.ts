/**
 * Tests for the Phase 9.x placeholder-ID resolver in the Twitter collector.
 *
 * The resolver is the fix for the long-standing class of bugs where the
 * per-account fallback path (`/2/users/{id}/tweets`) was sending synthetic
 * `inf-…` IDs as Twitter user IDs to the X API, yielding 400 errors per
 * account per cycle.
 *
 * These tests mock `fetch` so we can exercise the resolver without an X
 * bearer token + verify the structural contract:
 *   1. Resolution happens at most once per process (idempotent)
 *   2. Real IDs are mapped from the batch response keyed by username
 *   3. Resolution failures leave placeholders unmapped (skip semantics)
 *   4. The non-placeholder accounts pass through untouched
 *
 * `isPlaceholderId` and `resolveAccountId` are not directly exported, so we
 * test the visible side effect through `fetchTwitterTimeline` end-to-end
 * with `fetch` mocked. The collector exposes `fetchTwitterTimeline`; we
 * trigger the fallback path by making the primary search return empty.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We need to reset module state between tests because the resolver tracks
// `placeholderResolutionAttempted` at module scope (idempotent-per-process).
const ORIGINAL_BEARER = process.env.TWITTER_BEARER_TOKEN;

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env.TWITTER_BEARER_TOKEN = 'test-bearer';
});

afterEach(() => {
  if (ORIGINAL_BEARER === undefined) {
    delete process.env.TWITTER_BEARER_TOKEN;
  } else {
    process.env.TWITTER_BEARER_TOKEN = ORIGINAL_BEARER;
  }
});

/**
 * Build a Response-shaped object compatible with what twitterFetch /
 * resolvePlaceholderIds parse. We don't use the real Response constructor
 * because Node test runtimes vary; a duck-typed object suffices.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe('placeholder ID resolution', () => {
  it('batch-resolves all placeholder accounts in a single /2/users/by call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('/tweets/search/recent')
        ? Promise.resolve(jsonResponse({ data: [] }))
        : fetchMock(url, init),
    );

    // Primary search returns empty → fallback path runs → resolver fires

    // The resolver's batch lookup — returns real IDs for 3 of our placeholders
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { id: '111', username: 'briankrebs' },
          { id: '222', username: 'TheHackersNews' },
          { id: '333', username: 'CISAgov' },
          // The rest of the placeholders intentionally absent — simulating
          // partial resolution success
        ],
      }),
    );
    // Per-account fetches that follow — return empty data so we just exercise
    // the URL construction (which is what we're verifying)
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const { fetchTwitterTimeline } = await import('./twitter');
    await fetchTwitterTimeline();

    // The 2nd fetch should be the resolver's batch lookup
    const resolverCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/users/by?usernames='),
    )?.[0] as string | undefined;
    expect(resolverCall).toBeDefined();
    expect(resolverCall).toContain('/users/by?usernames=');
    // Should include all our placeholder usernames in one batch call
    expect(resolverCall).toMatch(/briankrebs/);
    expect(resolverCall).toMatch(/TheHackersNews/);
    expect(resolverCall).toMatch(/CISAgov/);
    expect(resolverCall).toMatch(/elder_plinius/); // Phase 9.3 addition

    // After resolution, per-account paths should use REAL IDs for the
    // accounts that resolved, and SKIP the placeholders that didn't.
    // Check that no fetch URL contains 'inf-' (the synthetic prefix).
    const allUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    const callsWithPlaceholderInPath = allUrls.filter(
      (u) => /\/users\/inf-/.test(u), // path-segment match, not query
    );
    expect(callsWithPlaceholderInPath).toEqual([]);

    // The 3 resolved placeholders SHOULD now appear in per-account URLs with
    // their real IDs
    expect(allUrls.some((u) => u.includes('/users/111/tweets'))).toBe(true);
    expect(allUrls.some((u) => u.includes('/users/222/tweets'))).toBe(true);
    expect(allUrls.some((u) => u.includes('/users/333/tweets'))).toBe(true);
  });

  it('is idempotent — second collector call does not re-fetch /users/by', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('/tweets/search/recent')
        ? Promise.resolve(jsonResponse({ data: [] }))
        : fetchMock(url, init),
    );

    // First collection: primary empty → resolver fires → per-account fetches
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: '111', username: 'briankrebs' }] }),
    );
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const { fetchTwitterTimeline } = await import('./twitter');
    await fetchTwitterTimeline();
    const callsAfterFirst = fetchMock.mock.calls.length;
    const resolverCallsAfterFirst = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/users/by?usernames='),
    ).length;
    expect(resolverCallsAfterFirst).toBe(1);

    // Clear the rate-limiter + cache state so the next call actually hits the
    // collector path (otherwise we hit the in-memory cache and skip fetch).
    const { clearCache } = await import('../rate-limiter');
    await clearCache('twitter:');

    // Second collection: should reuse resolved IDs from the first run.
    await fetchTwitterTimeline();
    const resolverCallsAfterSecond = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('/users/by?usernames='),
    ).length;
    expect(resolverCallsAfterSecond).toBe(1); // still 1, not 2

    // Total fetch count grew (per-account fetches happened again), but the
    // resolver did NOT fire a second time
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('handles batch lookup failure by skipping placeholders (no 400s)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('/tweets/search/recent')
        ? Promise.resolve(jsonResponse({ data: [] }))
        : fetchMock(url, init),
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: 'auth failed' }, 401)); // resolver fails
    fetchMock.mockResolvedValue(jsonResponse({ data: [] })); // any subsequent fetch

    const { fetchTwitterTimeline } = await import('./twitter');
    await fetchTwitterTimeline();

    // No per-account fetch should contain 'inf-' in the path
    const allUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    const callsWithPlaceholderInPath = allUrls.filter((u) => /\/users\/inf-/.test(u));
    expect(callsWithPlaceholderInPath).toEqual([]);
  });

  it('still issues per-account fetches for non-placeholder accounts with real IDs', async () => {
    // Even when the resolver fails entirely, accounts with REAL IDs (markets,
    // osint, policy, crypto, ai domains) should continue to be fetched —
    // they don't need resolution.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url.includes('/tweets/search/recent')
        ? Promise.resolve(jsonResponse({ data: [] }))
        : fetchMock(url, init),
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: 'failed' }, 500)); // resolver fails
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    const { fetchTwitterTimeline } = await import('./twitter');
    await fetchTwitterTimeline();

    const allUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    // Sam Altman's real ID is 1605 — confirm it appears in a per-account URL
    expect(allUrls.some((u) => u.includes('/users/1605/tweets'))).toBe(true);
    // Another configured AI account with a numeric ID is preserved.
    expect(allUrls.some((u) => u.includes('/users/1573399256836309009/tweets'))).toBe(true);
  });
});
