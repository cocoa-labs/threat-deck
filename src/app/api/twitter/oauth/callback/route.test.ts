vi.mock('@/lib/auth', () => ({ auth: async () => ({ user: { email: 'operator@example.org' } }) }));

/**
 * Tests for GET /api/twitter/oauth/callback — validates that OAuth tokens are
 * only stored for the configured ExampleMonitor posting identity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockDecrypt = vi.fn();
const mockExchangeCodeForTokens = vi.fn();
const mockFetchAuthenticatedUser = vi.fn();
const mockUpsertToken = vi.fn();

vi.mock('@/lib/crypto/symmetric', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}));

vi.mock('@/lib/twitter/oauth', () => ({
  exchangeCodeForTokens: (...args: unknown[]) => mockExchangeCodeForTokens(...args),
  fetchAuthenticatedUser: (...args: unknown[]) => mockFetchAuthenticatedUser(...args),
  getConfiguredTwitterHandle: () =>
    String(process.env.TWITTER_OAUTH_HANDLE ?? 'ExampleMonitor')
      .trim()
      .replace(/^@/, '')
      .toLowerCase(),
  normalizeTwitterHandle: (handle: string) => handle.trim().replace(/^@/, '').toLowerCase(),
  upsertToken: (...args: unknown[]) => mockUpsertToken(...args),
}));

const { GET } = await import('./route');

const originalHandle = process.env.TWITTER_OAUTH_HANDLE;
const cookiePayload = {
  operatorEmail: 'operator@example.org',
  state: 'oauth-state',
  codeVerifier: 'pkce-verifier',
  redirectUri: 'http://localhost:3002/api/twitter/oauth/callback',
  issuedAt: Date.now(),
};
const tokenResult = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: '2026-05-27T00:00:00.000Z',
  scopes: ['tweet.write', 'tweet.read', 'users.read', 'offline.access'],
};

beforeEach(() => {
  process.env.TWITTER_OAUTH_HANDLE = 'ExampleMonitor';
  mockDecrypt.mockReset();
  mockExchangeCodeForTokens.mockReset();
  mockFetchAuthenticatedUser.mockReset();
  mockUpsertToken.mockReset();

  mockDecrypt.mockReturnValue(JSON.stringify({ ...cookiePayload, issuedAt: Date.now() }));
  mockExchangeCodeForTokens.mockResolvedValue(tokenResult);
  mockFetchAuthenticatedUser.mockResolvedValue({
    id: '1833957484685373440',
    name: 'ExampleMonitor',
    username: 'ExampleMonitor',
  });
  mockUpsertToken.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalHandle) {
    process.env.TWITTER_OAUTH_HANDLE = originalHandle;
  } else {
    delete process.env.TWITTER_OAUTH_HANDLE;
  }
  vi.clearAllMocks();
});

function mkReq(): Request {
  return new Request(
    'http://localhost:3002/api/twitter/oauth/callback?code=oauth-code&state=oauth-state',
    {
      method: 'GET',
      headers: {
        cookie: 'cocoa_twitter_oauth=encrypted-cookie',
      },
    },
  );
}

describe('GET /api/twitter/oauth/callback', () => {
  it('stores tokens when the authenticated X user matches ExampleMonitor', async () => {
    const res = await GET(mkReq());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3002/twitter-connected.html?status=ok',
    );
    expect(mockExchangeCodeForTokens).toHaveBeenCalledWith({
      code: 'oauth-code',
      codeVerifier: 'pkce-verifier',
      redirectUri: 'http://localhost:3002/api/twitter/oauth/callback',
    });
    expect(mockFetchAuthenticatedUser).toHaveBeenCalledWith('access-token');
    expect(mockUpsertToken).toHaveBeenCalledWith({
      provider: 'twitter',
      handle: 'ExampleMonitor',
      tokens: tokenResult,
    });
  });

  it('rejects and does not store tokens when OtherOperator authorized the app', async () => {
    mockFetchAuthenticatedUser.mockResolvedValue({
      id: '111',
      name: 'Other Operator',
      username: 'OtherOperator',
    });

    const res = await GET(mkReq());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3002/twitter-connected.html?status=error&reason=handle_mismatch_OtherOperator',
    );
    expect(mockUpsertToken).not.toHaveBeenCalled();
  });

  it('does not store tokens if the authorized X user cannot be verified', async () => {
    mockFetchAuthenticatedUser.mockRejectedValue(new Error('users/me failed'));

    const res = await GET(mkReq());

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3002/twitter-connected.html?status=error&reason=handle_lookup_failed',
    );
    expect(mockUpsertToken).not.toHaveBeenCalled();
  });
});
