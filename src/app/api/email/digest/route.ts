import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, auditDenied, auditFailure, auditSuccess } from '@/lib/audit';
import { sendDailyDigest } from '@/lib/email/digest-builder';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * POST /api/email/digest
 *
 * Sends the Cocoa AI Threat Deck daily digest to all configured recipients.
 * Hit by Vercel Cron at 13:00 UTC (see vercel.json). Idempotent per day per
 * recipient via `aegis_outbound_log` (entity_id = `digest-YYYY-MM-DD`).
 *
 * Auth: requires `CRON_SECRET` to match either:
 *   - `Authorization: Bearer <CRON_SECRET>` (Vercel cron default)
 *   - `x-cron-secret: <CRON_SECRET>` (manual / custom callers)
 *
 * Recipients: comma-separated emails in `ALERT_EMAIL_RECIPIENTS`.
 *
 * Always returns 200 (fail-soft). The `ok` field in the response body indicates
 * the actual result — surfaces 401 only when the cron secret is set but invalid.
 */

export const dynamic = 'force-dynamic';

function parseRecipients(): string[] {
  const raw = process.env.ALERT_EMAIL_RECIPIENTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function checkCronSecret(request: Request): {
  ok: boolean;
  reason?: string;
} {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // If no secret configured, allow the call but warn — useful for local dev.
    console.warn('[email/digest] CRON_SECRET not set — accepting request without auth');
    return { ok: true };
  }
  const authHeader = request.headers.get('authorization') ?? '';
  const customHeader = request.headers.get('x-cron-secret') ?? '';
  const bearerMatch = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  if (bearerMatch === expected || customHeader === expected) {
    return { ok: true };
  }
  return { ok: false, reason: 'Invalid or missing cron secret' };
}

async function handle(request: Request): Promise<Response> {
  const actorIp = getClientIp(request);
  const actorUa = request.headers.get('user-agent');

  const auth = checkCronSecret(request);
  if (!auth.ok) {
    void auditDenied(AUDIT_ACTIONS.OUTBOUND_EMAIL_DIGEST_SENT, auth.reason ?? 'unauthorized', {
      actorId: 'cron',
      actorIp,
      actorUa,
      targetKind: 'email_digest',
    });
    return NextResponse.json({ ok: false, error: auth.reason ?? 'unauthorized' }, { status: 401 });
  }

  const recipients = parseRecipients();
  if (recipients.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'ALERT_EMAIL_RECIPIENTS is empty',
      sent: [],
      failed: [],
    });
  }

  try {
    const result = await sendDailyDigest(recipients);
    // Per-recipient audit rows would explode the table; emit a single roll-up
    // event with the recipient counts so SECURITY can spot dispatch anomalies.
    void auditSuccess(AUDIT_ACTIONS.OUTBOUND_EMAIL_DIGEST_SENT, {
      actorId: 'cron',
      actorIp,
      actorUa,
      targetKind: 'email_digest',
      targetId: new Date().toISOString().slice(0, 10),
      details: {
        ok: result.ok,
        sent: result.sent.length,
        failed: result.failed.length,
        skipped: result.skipped?.length ?? 0,
      },
    });
    return NextResponse.json({
      ok: result.ok,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email/digest] Unexpected error:', msg);
    void auditFailure(AUDIT_ACTIONS.OUTBOUND_EMAIL_DIGEST_SENT, err, {
      actorId: 'cron',
      actorIp,
      actorUa,
      targetKind: 'email_digest',
      targetId: new Date().toISOString().slice(0, 10),
    });
    // Fail-soft — 200 + ok:false rather than 500.
    return NextResponse.json({ ok: false, error: msg, sent: [], failed: [] });
  }
}

/**
 * Rate limit: 1 request per hour, globally. The digest is sent to all
 * recipients in a single call, so the bucket key is fixed — there is no
 * legitimate use case for >1 fire-off per hour. Protects against accidental
 * cron storms (e.g., a redeploy retriggering Vercel cron) and against an
 * attacker who has guessed CRON_SECRET from blasting the recipient list.
 *
 * Built-in per-recipient idempotency in sendDailyDigest already prevents
 * duplicate emails on the same calendar day — this layer protects upstream
 * resources (DB connections, Resend quota burst).
 */
const limitedHandle = withRateLimit(handle, {
  key: 'email-digest:global',
  limit: 1,
  windowMs: 60 * 60_000,
});

async function routePOSTImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

// Vercel cron sends GET by default — accept both verbs.
async function routeGETImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

export const POST = withRoutePolicy('/api/email/digest', routePOSTImplementation);
export const GET = withRoutePolicy('/api/email/digest', routeGETImplementation);
