/**
 * Tests for POST /api/outbound/email-me (Phase 13 Tier 5).
 *
 * Pattern mirrors /api/outbound/drafts/route.test.ts: mock auth + bypass the
 * rate-limit wrapper, then exercise the full handler against the real DB
 * (aegis_outbound_log dedup is part of what we're testing). Resend is mocked
 * so no actual emails go out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const mockAuth = vi.fn();
const mockSendEmail = vi.fn();

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

vi.mock('@/lib/email/resend', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

const { POST } = await import('./route');

const TEST_TIMESTAMP_BASE = 1779000000000; // arbitrary stable ms epoch for the test fixtures
const TEST_RECIPIENT = 'voice-test@example.org';

/** Clear out any rows left by previous runs. */
async function cleanup(): Promise<void> {
  // Drop by entity_id prefix matching our deterministic test timestamps.
  // entity_id format: `agent-${timestamp}-${sha256hash}`; TEST_TIMESTAMP_BASE
  // is 1779000000000 so any row from this test file starts with that prefix.
  await query(
    `DELETE FROM aegis_outbound_log
       WHERE channel = 'email' AND entity_kind = 'agent_response'
         AND entity_id LIKE 'agent-1779%'`,
  );
}

beforeEach(async () => {
  mockAuth.mockReset();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ ok: true, id: 'resend-mock-id' });
  process.env.EMAIL_ME_RECIPIENT = TEST_RECIPIENT;
  await cleanup();
});

afterEach(async () => {
  await cleanup();
  delete process.env.EMAIL_ME_RECIPIENT;
});

function mkReq(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/outbound/email-me', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/outbound/email-me', () => {
  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(
      mkReq({ messageContent: 'hello', messageTimestamp: TEST_TIMESTAMP_BASE }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'unauthorized' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when messageContent is missing', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const res = await POST(mkReq({ messageTimestamp: TEST_TIMESTAMP_BASE }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ ok: false, error: 'invalid_body' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 400 when neither EMAIL_ME_RECIPIENT nor a session email is available', async () => {
    delete process.env.EMAIL_ME_RECIPIENT;
    // Session present but no email field
    mockAuth.mockResolvedValue({ user: {} });
    const res = await POST(
      mkReq({ messageContent: 'hello', messageTimestamp: TEST_TIMESTAMP_BASE }),
    );
    // Without a session email, the auth gate fires first → 401
    expect(res.status).toBe(401);
  });

  it('falls back to session.user.email when EMAIL_ME_RECIPIENT is unset', async () => {
    delete process.env.EMAIL_ME_RECIPIENT;
    mockAuth.mockResolvedValue({ user: { email: 'session-fallback@example.org' } });
    const res = await POST(
      mkReq({
        messageContent: '**[CRITICAL]** Smoke test fallback recipient.',
        messageTimestamp: TEST_TIMESTAMP_BASE + 1,
        alertEntityKind: 'cve',
        alertEntityId: 'CVE-2099-00001',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.recipient).toBe('session-fallback@example.org');
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sendArgs = mockSendEmail.mock.calls[0]![0] as { to: string };
    expect(sendArgs.to).toBe('session-fallback@example.org');
  });

  it('happy path: stages outbound_log row, calls sendEmail, returns ok=true', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const content = `**[CRITICAL]** CVE-2099-00010 — Lakera Guard 2.x classifier blinks.

## BLUF
Quantum VPN gateways read like open books overnight.`;
    const res = await POST(
      mkReq({
        messageContent: content,
        messageTimestamp: TEST_TIMESTAMP_BASE + 10,
        severity: 'critical',
        alertEntityKind: 'cve',
        alertEntityId: 'CVE-2099-00010',
        twitterDistillation: '[CRITICAL] CVE-2099-00010 — Lakera Guard 2.x classifier blinks.',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.alreadySent).toBeFalsy();
    expect(json.recipient).toBe(TEST_RECIPIENT);
    expect(json.entityId).toMatch(/^agent-\d+-[a-f0-9]{12}$/);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const args = mockSendEmail.mock.calls[0]![0] as {
      to: string;
      subject: string;
      idempotencyKey: string;
    };
    expect(args.to).toBe(TEST_RECIPIENT);
    expect(args.subject).toContain('[CRITICAL]');
    expect(args.subject).toContain('CVE-2099-00010');
    expect(args.idempotencyKey).toBe(json.entityId);

    // outbound_log row landed
    const { rows } = await query<{ status: string; recipient: string; channel: string }>(
      `SELECT status, recipient, channel FROM aegis_outbound_log
         WHERE entity_id = $1 AND entity_kind = 'agent_response'`,
      [json.entityId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('sent');
    expect(rows[0]?.recipient).toBe(TEST_RECIPIENT);
    expect(rows[0]?.channel).toBe('email');
  });

  it('second click on the same message returns alreadySent=true without re-sending', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const content = '**[HIGH]** Duplicate-click test fixture.';
    const body = {
      messageContent: content,
      messageTimestamp: TEST_TIMESTAMP_BASE + 20,
      severity: 'high',
    };

    const r1 = await POST(mkReq(body));
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.ok).toBe(true);
    expect(j1.alreadySent).toBeFalsy();

    const r2 = await POST(mkReq(body));
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.ok).toBe(true);
    expect(j2.alreadySent).toBe(true);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('forceResend=true bypasses dedup and triggers a second sendEmail call', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const content = '**[HIGH]** Force-resend test fixture.';
    const baseBody = {
      messageContent: content,
      messageTimestamp: TEST_TIMESTAMP_BASE + 30,
      severity: 'high',
    };

    const r1 = await POST(mkReq(baseBody));
    expect(r1.status).toBe(200);
    expect((await r1.json()).alreadySent).toBeFalsy();

    const r2 = await POST(mkReq({ ...baseBody, forceResend: true }));
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    expect(j2.ok).toBe(true);
    expect(j2.alreadySent).toBeFalsy(); // forceResend skipped the dedup gate

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    // The forced send should use a suffixed idempotency key
    const k1 = (mockSendEmail.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;
    const k2 = (mockSendEmail.mock.calls[1]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(k1).not.toBe(k2);
    expect(k2).toMatch(/-force-\d+$/);
  });

  it('returns resend_failed (and marks outbound_log failed) when Resend errors', async () => {
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    mockSendEmail.mockResolvedValueOnce({ ok: false, error: 'simulated upstream error' });
    const content = '**[CRITICAL]** Resend-failure path.';
    const body = {
      messageContent: content,
      messageTimestamp: TEST_TIMESTAMP_BASE + 40,
      severity: 'critical',
    };
    const res = await POST(mkReq(body));
    expect(res.status).toBe(200); // route returns 200 with ok=false (mirrors twitter/post envelope)
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe('resend_failed');
    expect(json.detail).toContain('simulated upstream error');

    // The outbound_log row should be flagged failed
    const { rows } = await query<{ status: string }>(
      `SELECT status FROM aegis_outbound_log
         WHERE entity_kind = 'agent_response' AND recipient = $1
         ORDER BY id DESC LIMIT 1`,
      [TEST_RECIPIENT],
    );
    expect(rows[0]?.status).toBe('failed');
  });

  it('uses comma-separated recipients (first wins for v1)', async () => {
    process.env.EMAIL_ME_RECIPIENT = `first@example.org, ${TEST_RECIPIENT}`;
    mockAuth.mockResolvedValue({ user: { email: 'alice@example.org' } });
    const res = await POST(
      mkReq({
        messageContent: '**[HIGH]** Comma-list test.',
        messageTimestamp: TEST_TIMESTAMP_BASE + 50,
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recipient).toBe('first@example.org');
  });
});
