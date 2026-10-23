import { isEmailAllowed } from './allowlist';

export { isEmailAllowed } from './allowlist';

import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { sendEmail } from '@/lib/email/resend';
import { MagicLinkEmail } from '@/lib/email/templates/MagicLink';
import { applicationOrigin, isLoopbackUrl } from '@/lib/security/origin';
import { createMagicLinkAdapter } from './adapter';

/**
 * Auth.js (NextAuth v5) configuration for Cocoa AI Threat Deck.
 *
 * Architecture:
 *   - Custom "email" provider — bypasses Auth.js's built-in nodemailer/SMTP path
 *     and dispatches the magic link through our existing Resend wrapper
 *     (`src/lib/email/resend.ts`), which already handles BYOK fail-soft.
 *   - JWT session strategy — no DB writes for sessions; the session lives in a
 *     signed httpOnly cookie. See `adapter.ts` for the (minimal) token-only adapter.
 *   - Env-var allowlist — `ALLOWED_EMAILS` (comma-separated) gates the signIn
 *     callback. Emails outside the list silently fail (no allowlist-membership
 *     leakage from the front-door `/api/auth/magic-link` route).
 *
 * Why a custom email provider instead of the built-in @auth/core Resend provider?
 *   - Our `sendEmail()` wrapper centralizes idempotency keys, fail-soft on missing
 *     `RESEND_API_KEY`, and structured error logs — already battle-tested by Phase 6.3.
 *   - Reusing it keeps Resend behavior consistent across magic-links and CVE alerts.
 *
 * Phase 7.2+ TODO:
 *   - Promote `createMagicLinkAdapter()` to a Redis-backed implementation for
 *     multi-instance deployments (cold starts on Vercel can hit different regions).
 *   - Add `signIn` log writes to `aegis_outbound_log` for audit trail.
 */

const TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const COCOA_FROM_FALLBACK = 'Cocoa AI <onboarding@resend.dev>';
const LOCAL_DEV_PROVIDER_ID = 'local-dev';

/**
 * Parse `ALLOWED_EMAILS` into two sets:
 *   - `emails`  — exact addresses (e.g. `operator@example.org`)
 *   - `domains` — domain wildcards prefixed with `@` (e.g. `@example.org` matches
 *                 every address ending in `@example.org`)
 *
 * Re-read per request — env can change between hot reloads in dev.
 *
 * Empty/missing allowlist = deny-all (intentional fail-closed default; an
 * unconfigured production deploy must reject everyone rather than allow
 * everyone).
 */
function getAllowedEntries(): { emails: Set<string>; domains: Set<string> } {
  const raw = process.env.ALLOWED_EMAILS ?? '';
  const emails = new Set<string>();
  const domains = new Set<string>();

  for (const rawEntry of raw.split(',')) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith('@') && entry.length > 1 && !entry.includes(' ')) {
      // Domain wildcard (e.g. "@example.org" matches every address with that suffix)
      domains.add(entry.slice(1));
    } else if (entry.includes('@')) {
      emails.add(entry);
    }
    // Silently skip malformed entries (no '@', whitespace mid-token, etc.)
    // rather than allowlisting them. Misconfiguration should fail closed.
  }

  return { emails, domains };
}

/** True iff `email` is in `ALLOWED_EMAILS` (exact match) or its domain is whitelisted (`@domain.tld`). */
function getFirstExactAllowedEmail(): string | null {
  const { emails } = getAllowedEntries();
  for (const email of emails) return email;
  return null;
}

export function isLocalDevBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.AUTH_DEV_BYPASS === 'true' &&
    isLoopbackUrl(process.env.NEXTAUTH_URL || 'http://localhost:3002')
  );
}

/**
 * Local-only identity used by the prototype bypass.
 *
 * Preference order:
 *   1. AUTH_DEV_EMAIL, if present
 *   2. First exact address in ALLOWED_EMAILS
 *
 * Domain wildcards still work for production magic links, but the dev bypass
 * needs one concrete email so API routes can see a stable session.user.email.
 */
export function getLocalDevSessionEmail(): string | null {
  if (!isLocalDevBypassEnabled()) return null;

  const configured = process.env.AUTH_DEV_EMAIL?.trim().toLowerCase();
  const email = configured || getFirstExactAllowedEmail();
  if (!email || !isEmailAllowed(email)) return null;
  return email;
}

const emailProvider: NextAuthConfig['providers'][number] = {
  id: 'email',
  type: 'email',
  name: 'Email',
  // `||` (not `??`) so empty-string env values still fall back —
  // `.env` parsers turn `RESEND_FROM_EMAIL=` into "" which is not nullish.
  from: process.env.RESEND_FROM_EMAIL?.trim() || COCOA_FROM_FALLBACK,
  maxAge: TOKEN_TTL_SECONDS,
  // Auth.js calls this when a sign-in request hits the verification endpoint.
  // We translate it into a Resend-backed React Email send.
  async sendVerificationRequest(params) {
    const { identifier: to, url, expires } = params;
    const parsed = new URL(url);
    const { host } = parsed;

    // Gmail's anti-phishing scanner GETs every link in inbound mail before
    // the recipient sees it. Auth.js callback tokens are single-use, so
    // that prefetch consumes the token and the real click 404s with
    // "Verification" error.
    //
    // Wrap the Auth.js callback in our own /auth/verify page (`next=`
    // carries the original URL through). Gmail prefetches the wrapper —
    // it's an inert HTML render, nothing to consume. The user then has
    // to click a button on the page to actually hit the Auth.js callback,
    // which finally consumes the token.
    const verifyUrl = new URL('/auth/verify', parsed.origin);
    verifyUrl.searchParams.set('next', url);

    const result = await sendEmail(
      {
        to,
        subject: `Sign in to ${host}`,
        react: MagicLinkEmail({ url: verifyUrl.toString(), host, expiresAt: expires }),
        text: `Sign in to ${host}\n\nUse this link to sign in (expires ${expires.toISOString()}):\n${verifyUrl.toString()}\n\nIf you didn't request this, you can safely ignore this message.`,
      },
      'authentication',
    );

    // Surface send failures so Auth.js returns an error page instead of
    // silently appearing to have queued a non-existent email.
    if (!result.ok) {
      throw new Error(`MagicLinkSendFailed: ${result.error ?? 'unknown'}`);
    }
  },
};

const providers: NextAuthConfig['providers'] = [emailProvider];

if (isLocalDevBypassEnabled()) {
  providers.push(
    Credentials({
      id: LOCAL_DEV_PROVIDER_ID,
      name: 'Local Dev',
      credentials: {
        email: { label: 'Email', type: 'email' },
      },
      async authorize(credentials, request) {
        if (!isLoopbackUrl(request.url)) return null;
        const rawEmail = credentials?.email;
        const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
        if (!email || !isEmailAllowed(email)) return null;
        return { id: email, email };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  // NextAuth replaces request URLs with AUTH_URL/NEXTAUTH_URL before dispatch.
  // Trust only that explicit deployment origin, never a forwarded Host header.
  trustHost: Boolean(applicationOrigin()),
  adapter: createMagicLinkAdapter(),
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  debug: false,
  pages: {
    signIn: '/login',
    verifyRequest: '/login?sent=1',
    error: '/login?error=1',
  },
  providers,
  callbacks: {
    /**
     * Gate-keep: only emails in `ALLOWED_EMAILS` may proceed. Reject silently
     * (return false) for unknown addresses — leak-free by design.
     *
     * Auth.js invokes this twice in the email flow:
     *   1. With `email.verificationRequest === true` BEFORE sending the link.
     *      Returning false here means the email is never dispatched.
     *   2. AFTER the user clicks the link (token verified) before the session
     *      cookie is issued. Returning false here means no session.
     *
     * Both gates check the same allowlist, so any state change to the allowlist
     * between request and click will be enforced at click time.
     */
    async signIn({ user }) {
      const email = user?.email;
      if (!email) return false;
      return isEmailAllowed(email);
    },

    /** Embed the email into the JWT — sessions are stateless under JWT strategy. */
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      return token;
    },

    /** Surface the email on `session.user.email` for server components / API routes. */
    async session({ session, token }) {
      if (token?.email && session.user && isEmailAllowed(token.email as string)) {
        session.user.email = token.email as string;
      } else if (session.user) {
        session.user.email = '';
      }
      return session;
    },
  },
};
