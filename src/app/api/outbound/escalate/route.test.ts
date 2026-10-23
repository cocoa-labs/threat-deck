/**
 * Tests for the escalation sweep cron. Hits the real DB for the stale-
 * draft query (uses aegis_v_pending_drafts via the row helper) but mocks
 * sendEmail + outbound-log so we can assert dedup semantics without
 * needing Resend.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const mockSendEmail = vi.fn();
const mockLogOutbound = vi.fn();

vi.mock('@/lib/email/resend', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));
vi.mock('@/lib/email/outbound-log', () => ({
  logOutbound: (...a: unknown[]) => mockLogOutbound(...a),
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
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return {
    ...actual,
    auditSuccess: vi.fn(async () => {}),
    auditFailure: vi.fn(async () => {}),
    auditDenied: vi.fn(async () => {}),
  };
});

const { POST, GET } = await import('./route');

const TEST_MARKER = 'test:escalate-9.5';
const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_RECIPIENTS = process.env.ALERT_EMAIL_RECIPIENTS;

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

async function seedStaleCriticalDraft(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_outbound_drafts
       (channel, draft_type, agent_mode, headline, draft_payload, severity,
        ai_relevance, status, created_by, created_at)
     VALUES ('twitter', 'breaking', 'anchor', 'stale critical draft',
             '{"tweets":[{"text":"x"}]}'::jsonb, 'critical', 0.9, 'drafted', $1,
             NOW() - INTERVAL '3 hours')
     RETURNING id`,
    [TEST_MARKER],
  );
  return Number(rows[0]!.id);
}

beforeEach(() => {
  mockSendEmail.mockReset();
  mockLogOutbound.mockReset();
  process.env.CRON_SECRET = 'test-secret-test-only-secret-with-32-characters';
  process.env.ALERT_EMAIL_RECIPIENTS = 'reviewer@example.org';
  return cleanup();
});
afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_RECIPIENTS === undefined) delete process.env.ALERT_EMAIL_RECIPIENTS;
  else process.env.ALERT_EMAIL_RECIPIENTS = ORIGINAL_RECIPIENTS;
  return cleanup();
});

function authedReq(): Request {
  return new Request('http://localhost/api/outbound/escalate', {
    method: 'POST',
    headers: { 'x-cron-secret': 'test-secret-test-only-secret-with-32-characters' },
  });
}

describe('POST /api/outbound/escalate', () => {
  it('returns 401 with missing cron secret', async () => {
    const res = await POST(new Request('http://localhost/api/outbound/escalate'));
    expect(res.status).toBe(401);
  });

  it('returns ok:false when recipients env is empty', async () => {
    delete process.env.ALERT_EMAIL_RECIPIENTS;
    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: expect.stringMatching(/recipients/i) });
  });

  it('returns scanned=0 when no stale critical drafts exist', async () => {
    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, scanned: 0, escalated: 0 });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('escalates a stale critical draft on first sweep', async () => {
    await seedStaleCriticalDraft();
    mockLogOutbound.mockResolvedValueOnce({ inserted: true, logId: 1 });
    mockSendEmail.mockResolvedValueOnce({ ok: true, id: 'res-msg-1' });

    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.scanned).toBeGreaterThanOrEqual(1);
    expect(json.sent).toBeGreaterThanOrEqual(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('skips dedup on second sweep when outbound-log conflict fires', async () => {
    await seedStaleCriticalDraft();
    // Pre-existing dedup row — logOutbound returns inserted:false
    mockLogOutbound.mockResolvedValueOnce({ inserted: false, logId: null });

    const res = await GET(authedReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.sent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
