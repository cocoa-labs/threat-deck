/**
 * Tests for GET /api/outbound/drafts.
 *
 * Mocks `auth` so we don't need a real NextAuth session in tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

// Mock auth + rate-limit. Rate limit just calls through.
const mockAuth = vi.fn();
vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

vi.mock('@/lib/security/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rate-limit')>(
    '@/lib/security/rate-limit',
  );
  return {
    ...actual,
    withRateLimit: (handler: (req: Request, ctx?: unknown) => Promise<Response>) => handler,
  };
});

const { GET } = await import('./route');

const TEST_MARKER = 'test:route-list-9.1';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

beforeEach(() => {
  mockAuth.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('GET /api/outbound/drafts', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET(new Request('http://localhost/api/outbound/drafts'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('returns drafts for an authenticated user', async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: 'alice@example.org' } });

    await query(
      `INSERT INTO aegis_outbound_drafts (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
       VALUES ('twitter', 'breaking', 'anchor', 'route-test-drafted', '{"tweets":[{"text":"x"}]}'::jsonb, 'drafted', $1)`,
      [TEST_MARKER],
    );

    const res = await GET(
      new Request('http://localhost/api/outbound/drafts?status=pending&limit=20'),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    const headlines = (json.drafts as { headline: string; createdBy: string }[])
      .filter((d) => d.createdBy === TEST_MARKER)
      .map((d) => d.headline);
    expect(headlines).toContain('route-test-drafted');
  });

  it('rejects invalid status param', async () => {
    mockAuth.mockResolvedValueOnce({ user: { email: 'alice@example.org' } });
    const res = await GET(new Request('http://localhost/api/outbound/drafts?status=bogus'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'invalid_status' });
  });
});
