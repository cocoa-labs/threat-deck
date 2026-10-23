/**
 * Tests for the token keep-alive (proactiveRefreshToken) — the durability path
 * that keeps the X OAuth token fresh so posting stays connected indefinitely.
 * DB + crypto + the X token endpoint (fetch) are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockQueryOne = vi.fn();
const mockQuery = vi.fn();

vi.mock('@/lib/db/client', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: (...a: unknown[]) => mockQuery(...a),
}));
vi.mock('@/lib/crypto/symmetric', () => ({
  decrypt: () => 'plain-refresh-token',
  encrypt: (s: string) => `enc(${s})`,
}));

const { proactiveRefreshToken, getActiveToken } = await import('./oauth');

function tokenRow(expiresAt: string) {
  return {
    id: 1,
    provider: 'twitter',
    handle: 'ExampleMonitor',
    access_token_encrypted: 'enc-access',
    refresh_token_encrypted: 'enc-refresh',
    expires_at: expiresAt,
    scopes: ['tweet.write', 'offline.access'],
  };
}

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 7200,
      scope: 'tweet.write offline.access',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  process.env.TWITTER_OAUTH_CLIENT_ID = 'cid';
  process.env.TWITTER_OAUTH_CLIENT_SECRET = 'csecret';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proactiveRefreshToken (token keep-alive)', () => {
  it('returns no_token when no row exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await proactiveRefreshToken();
    expect(r).toMatchObject({ ok: false, reason: 'no_token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no-ops when the token is still comfortably fresh (no network call)', async () => {
    const farFuture = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    mockQueryOne.mockResolvedValueOnce(tokenRow(farFuture));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await proactiveRefreshToken();
    expect(r).toMatchObject({ ok: true, refreshed: false, reason: 'fresh' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes + persists the rotated token when expiring soon', async () => {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString(); // 10m left < 90m window
    mockQueryOne.mockResolvedValueOnce(tokenRow(soon));
    const fetchMock = vi.fn(async () => tokenResponse());
    vi.stubGlobal('fetch', fetchMock);

    const r = await proactiveRefreshToken();
    expect(r).toMatchObject({ ok: true, refreshed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalled(); // the rotated refresh token was persisted
  });

  it('single-flights concurrent refreshes — only one network call', async () => {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    mockQueryOne.mockResolvedValue(tokenRow(soon));
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      await new Promise((res) => setTimeout(res, 20));
      return tokenResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([proactiveRefreshToken(), proactiveRefreshToken()]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(calls).toBe(1); // the rotating refresh token is consumed exactly once
  });
});

describe('getActiveToken({ forceRefresh }) — reactive recovery', () => {
  it('rotates the token even when the cached expires_at still looks fresh', async () => {
    // A token X has invalidated mid-life still reads as "fresh" locally. The
    // post path must be able to demand a refresh anyway.
    const farFuture = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    mockQueryOne.mockResolvedValueOnce(tokenRow(farFuture));
    const fetchMock = vi.fn(async () => tokenResponse());
    vi.stubGlobal('fetch', fetchMock);

    const token = await getActiveToken({ forceRefresh: true });

    expect(token).toBe('new-access'); // the rotated access token, not the cached one
    expect(fetchMock).toHaveBeenCalledTimes(1); // forced a network refresh despite fresh expiry
  });

  it('does NOT refresh a comfortably-fresh token in the default (non-forced) path', async () => {
    const farFuture = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    mockQueryOne.mockResolvedValueOnce(tokenRow(farFuture));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const token = await getActiveToken();

    expect(token).toBeTruthy(); // the cached (decrypted) access token
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
