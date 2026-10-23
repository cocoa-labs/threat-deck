/**
 * Tests for GET /api/twitter/status — token-safe connection probe for POST TO X.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.fn();
const mockQueryOne = vi.fn();
const mockGetActiveToken = vi.fn();
const mockGetActiveTokenScopes = vi.fn();
const mockGetDefaultDryRun = vi.fn();

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/db/client', () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
}));

vi.mock('@/lib/twitter/oauth', () => ({
  getActiveToken: (...args: unknown[]) => mockGetActiveToken(...args),
  getActiveTokenScopes: (...args: unknown[]) => mockGetActiveTokenScopes(...args),
  getConfiguredTwitterHandle: () => 'examplehandle',
  getMissingTwitterScopes: (grantedScopes: string[] | null | undefined) => {
    const granted = new Set(grantedScopes ?? []);
    return ['tweet.write', 'tweet.read', 'users.read', 'offline.access', 'media.write'].filter(
      (scope) => !granted.has(scope),
    );
  },
  REQUIRED_SCOPES: ['tweet.write', 'tweet.read', 'users.read', 'offline.access', 'media.write'],
}));

vi.mock('@/lib/twitter/write-client', () => ({
  getDefaultDryRun: (...args: unknown[]) => mockGetDefaultDryRun(...args),
}));

vi.mock('@/lib/security/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rate-limit')>(
    '@/lib/security/rate-limit',
  );
  return {
    ...actual,
    withRateLimit: (handler: (req: Request) => Promise<Response>) => handler,
  };
});

const { GET } = await import('./route');

beforeEach(() => {
  mockAuth.mockReset();
  mockQueryOne.mockReset();
  mockGetActiveToken.mockReset();
  mockGetActiveTokenScopes.mockReset();
  mockGetDefaultDryRun.mockReset();
  mockAuth.mockResolvedValue({ user: { email: 'operator@example.org' } });
  mockQueryOne.mockResolvedValue(null);
  mockGetActiveToken.mockResolvedValue(null);
  mockGetActiveTokenScopes.mockResolvedValue(null);
  mockGetDefaultDryRun.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

function mkReq(): Request {
  return new Request('http://localhost:3002/api/twitter/status', { method: 'GET' });
}

describe('GET /api/twitter/status', () => {
  it('returns 401 without a signed-in session', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(mkReq());

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockGetActiveToken).not.toHaveBeenCalled();
  });

  it('returns connected:false when no token row exists', async () => {
    const res = await GET(mkReq());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      connected: false,
      handle: null,
      dryRun: true,
      missingScopes: [],
    });
    expect(mockGetActiveToken).not.toHaveBeenCalled();
    expect(mockGetActiveTokenScopes).not.toHaveBeenCalled();
  });

  it('ignores token rows that do not match the ExampleMonitor posting handle', async () => {
    await GET(mkReq());

    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("provider = 'twitter'"), [
      'examplehandle',
    ]);
    expect(mockGetActiveToken).not.toHaveBeenCalled();
  });

  it('returns handle and dry-run state without exposing token material', async () => {
    mockQueryOne.mockResolvedValue({ handle: 'ExampleMonitor' });
    mockGetActiveToken.mockResolvedValue('secret-access-token');
    mockGetActiveTokenScopes.mockResolvedValue([
      'tweet.write',
      'tweet.read',
      'users.read',
      'offline.access',
      'media.write',
    ]);
    mockGetDefaultDryRun.mockReturnValue(false);

    const res = await GET(mkReq());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      connected: true,
      handle: 'ExampleMonitor',
      dryRun: false,
      missingScopes: [],
    });
    expect(JSON.stringify(json)).not.toContain('secret-access-token');
  });

  it('reports missing media.write for old connected tokens', async () => {
    mockQueryOne.mockResolvedValue({ handle: 'ExampleMonitor' });
    mockGetActiveToken.mockResolvedValue('secret-access-token');
    mockGetActiveTokenScopes.mockResolvedValue([
      'tweet.write',
      'tweet.read',
      'users.read',
      'offline.access',
    ]);
    mockGetDefaultDryRun.mockReturnValue(false);

    const res = await GET(mkReq());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      connected: true,
      handle: 'ExampleMonitor',
      dryRun: false,
      missingScopes: ['media.write'],
    });
  });
});
