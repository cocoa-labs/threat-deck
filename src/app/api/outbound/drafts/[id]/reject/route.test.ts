/**
 * Tests for POST /api/outbound/drafts/[id]/reject.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const mockAuth = vi.fn();
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

const { POST } = await import('./route');

const TEST_MARKER = 'test:reject-9.1';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

async function seedDrafted(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_outbound_drafts
       (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
     VALUES ('twitter', 'breaking', 'anchor', 'reject-test', '{"tweets":[{"text":"x"}]}'::jsonb, 'drafted', $1)
     RETURNING id`,
    [TEST_MARKER],
  );
  return Number(rows[0]!.id);
}

function buildCtx(id: number) {
  return { params: { id: String(id) } };
}

beforeEach(() => {
  mockAuth.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('POST /api/outbound/drafts/[id]/reject', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValueOnce(null);
    const id = await seedDrafted();
    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: 'no' }),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a draft and persists the reason', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const id = await seedDrafted();
    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: 'off-voice' }),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, status: 'rejected' });

    const { rows } = await query<{ status: string; rejection_reason: string }>(
      `SELECT status, rejection_reason FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('rejected');
    expect(rows[0]!.rejection_reason).toBe('off-voice');
  });

  it('returns 400 when reason is missing', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const id = await seedDrafted();
    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/reject', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'reason_required' });
  });

  it('returns 400 when reason is whitespace only', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const id = await seedDrafted();
    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: '   ' }),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(400);
  });

  it('returns 409 when the draft is no longer pending', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const id = await seedDrafted();
    await query(`UPDATE aegis_outbound_drafts SET status = 'rejected' WHERE id = $1`, [id]);

    const res = await POST(
      new Request('http://localhost/api/outbound/drafts/x/reject', {
        method: 'POST',
        body: JSON.stringify({ reason: 'too late' }),
      }),
      buildCtx(id),
    );
    expect(res.status).toBe(409);
  });
});
