/**
 * Tests for POST /api/outbound/drafts/[id]/approve. Mocks auth +
 * rate-limit + WS broadcast; uses the real DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const mockAuth = vi.fn();
const mockPostTweet = vi.fn();

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('@/lib/security/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rate-limit')>(
    '@/lib/security/rate-limit',
  );
  return {
    ...actual,
    withRateLimit: (handler: (req: Request, ctx?: unknown) => Promise<Response>) => handler,
  };
});
vi.mock('@/lib/ws/server', () => ({ broadcast: vi.fn() }));
vi.mock('@/lib/twitter/write-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/twitter/write-client')>(
    '@/lib/twitter/write-client',
  );
  return { ...actual, postTweet: (...a: unknown[]) => mockPostTweet(...a) };
});

const { POST } = await import('./route');

const reviewedPayload = { tweets: [{ text: 'hi #AICyber' }], canonicalHashtag: '#AICyber' };
const TEST_MARKER = 'test:approve-9.1';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
  await query(
    `DELETE FROM aegis_outbound_log WHERE entity_kind = 'draft' AND entity_id IN
       (SELECT id::text FROM aegis_outbound_drafts WHERE created_by = $1)`,
    [TEST_MARKER],
  );
}

async function seedDrafted(headline = 'approve-test'): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_outbound_drafts
       (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
     VALUES ('twitter', 'breaking', 'anchor', $1, '{"tweets":[{"text":"hi #AICyber"}],"canonicalHashtag":"#AICyber"}'::jsonb, 'drafted', $2)
     RETURNING id`,
    [headline, TEST_MARKER],
  );
  return Number(rows[0]!.id);
}

function buildCtx(id: number) {
  return { params: { id: String(id) } };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockPostTweet.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('POST /api/outbound/drafts/[id]/approve', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const id = await seedDrafted();
    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/approve', { method: 'POST', body: '{}' }),
      buildCtx(id),
    );
    expect(res.status).toBe(401);
  });

  it('approves + publishes in one click (default publish=true)', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    mockPostTweet.mockResolvedValueOnce({ ok: true, tweetId: 'dry-1', dryRun: true });
    const id = await seedDrafted();

    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/approve', {
        method: 'POST',
        body: JSON.stringify({ reviewedPayload }),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('published');
    expect(json.tweetIds).toEqual(['dry-1']);

    const { rows } = await query<{ status: string }>(
      `SELECT status FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('published');
  });

  it('approves only when publish=false', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const id = await seedDrafted();
    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/approve', {
        method: 'POST',
        body: JSON.stringify({ publish: false, reviewedPayload }),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe('approved');
    expect(mockPostTweet).not.toHaveBeenCalled();
  });

  it('returns 409 when the draft is no longer pending', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const id = await seedDrafted();
    // Pre-publish out from under the route
    await query(`UPDATE aegis_outbound_drafts SET status = 'published' WHERE id = $1`, [id]);

    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/approve', {
        method: 'POST',
        body: JSON.stringify({ reviewedPayload }),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'not_pending' });
  });

  it('returns 400 on invalid id', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/abc/approve', {
        method: 'POST',
        body: JSON.stringify({ reviewedPayload }),
      }),
      { params: { id: 'abc' } },
    );
    expect(res.status).toBe(400);
  });
});

it('requires the reviewed content before approving or publishing', async () => {
  mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
  const id = await seedDrafted();
  const response = await POST(
    new Request('http://localhost/api/outbound/drafts/x/approve', { method: 'POST', body: '{}' }),
    buildCtx(id),
  );
  expect(response.status).toBe(400);
  expect(mockPostTweet).not.toHaveBeenCalled();
});
