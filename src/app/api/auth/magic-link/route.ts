import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, auditDenied, auditFailure, auditSuccess } from '@/lib/audit';
import { isEmailAllowed, signIn } from '@/lib/auth';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * POST /api/auth/magic-link — Phase 7.1 (NextAuth v5 wrapper).
 *
 * Front-door endpoint that the login terminal POSTs to. Behind the scenes it
 * delegates to Auth.js's server-side `signIn('email', ...)` which (a) generates
 * a token, (b) persists it via the in-memory adapter, (c) dispatches the
 * verification email through our Resend wrapper.
 *
 * Response contract — deliberately uniform for security:
 *   - 400 `{ error: 'invalid_email' }` — malformed input (shape check only).
 *   - 400 `{ error: 'invalid_body' }`  — body not JSON.
 *   - 200 `{ status: 'queued' }`       — for ALL syntactically-valid emails,
 *     whether or not they're in `ALLOWED_EMAILS`. This prevents an attacker
 *     from probing the allowlist by watching response codes. The actual email
 *     is only dispatched when the address passes the signIn callback gate.
 *
 * The 280ms artificial latency from the Phase 4.5A stub is intentionally kept —
 * it matches the AuthTerminal state-machine timing and masks any timing-channel
 * leak (allowlist-hit emails would otherwise resolve slower than non-hit ones,
 * since the latter never reach Resend).
 */

const ARTIFICIAL_LATENCY_MS = 280;

async function handlePost(request: Request) {
  let email: string | undefined;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.email === 'string') email = body.email.trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!email || !isPlausibleEmail(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const startedAt = Date.now();
  const actorIp = getClientIp(request);
  const actorUa = request.headers.get('user-agent');

  // Pre-check: skip the (expensive) NextAuth call entirely for non-allowlisted
  // addresses. We still return `queued` so callers can't distinguish. The
  // signIn callback duplicates this gate as defense-in-depth.
  //
  // Audit recording is fire-and-forget — we do NOT await it before responding
  // because the artificial-latency padding below would expose the DB write
  // duration as a timing channel.
  if (isEmailAllowed(email)) {
    try {
      await signIn('email', {
        email,
        redirect: false,
        redirectTo: '/',
      });
      void auditSuccess(AUDIT_ACTIONS.AUTH_MAGIC_LINK_REQUESTED, {
        actorId: email,
        actorIp,
        actorUa,
        targetKind: 'user',
        targetId: email,
      });
    } catch (err) {
      // Auth.js throws AccessDenied if the signIn callback rejects, and a
      // generic Error if Resend send fails. We swallow both: a soft 200
      // response keeps the wrapper contract leak-free and lets the UI show
      // a uniform "check your inbox" affordance even on transient failures.
      console.error('[auth/magic-link] signIn dispatch failed:', err);
      void auditFailure(AUDIT_ACTIONS.AUTH_MAGIC_LINK_REQUESTED, err, {
        actorId: email,
        actorIp,
        actorUa,
        targetKind: 'user',
        targetId: email,
      });
    }
  } else {
    // Non-allowlisted attempt — record as denied so SECURITY can spot
    // allowlist-probing patterns. Caller still sees the uniform 200 response.
    void auditDenied(AUDIT_ACTIONS.AUTH_MAGIC_LINK_DENIED, 'email_not_in_allowlist', {
      actorId: email,
      actorIp,
      actorUa,
      targetKind: 'user',
      targetId: email,
    });
  }

  // Pad to the artificial latency floor so timing doesn't leak allowlist hits.
  const elapsed = Date.now() - startedAt;
  if (elapsed < ARTIFICIAL_LATENCY_MS) {
    await new Promise((resolve) => setTimeout(resolve, ARTIFICIAL_LATENCY_MS - elapsed));
  }

  return NextResponse.json({ status: 'queued' }, { status: 200 });
}

function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

// Rate limit: 5 requests per IP per 60 seconds. Prevents magic-link spray
// (using the endpoint to enumerate the allowlist or burn through Resend quota).
// Fails OPEN if Redis is down — see src/lib/security/rate-limit.ts.
const routePOSTImplementation = withRateLimit(handlePost, {
  key: (req) => `magic-link:${getClientIp(req)}`,
  limit: 5,
  windowMs: 60_000,
});

export const POST = withRoutePolicy('/api/auth/magic-link', routePOSTImplementation);
