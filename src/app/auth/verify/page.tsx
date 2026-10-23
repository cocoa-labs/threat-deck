/**
 * /auth/verify — Two-step magic-link confirmation page.
 *
 * Why this exists: Gmail (and most enterprise mail security gateways) GETs
 * every link in inbound mail BEFORE the recipient sees it, as anti-phishing
 * "safe browsing" reconnaissance. Auth.js's magic-link callback tokens are
 * single-use — that prefetch consumes the token and the real click then 404s
 * with "Verification" error. The user appears to be in a redirect loop.
 *
 * Our fix is the standard pattern: route the email link to THIS page (an inert
 * HTML render with no token side-effect), and require the user to click a
 * button to actually hit `/api/auth/callback/email`. The mail scanner GETs the
 * wrapper safely; only the genuine human click consumes the token.
 *
 * Security:
 *   - The `next` param MUST point to the Auth.js callback on this same origin.
 *     Anything else is rejected so this page can't be used as an open redirect.
 *   - We render a server-side anchor (no JS required) so the click is real
 *     user navigation, not a synthetic event.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { CocoaWordmark } from '@/components/brand/CocoaWordmark';
import { applicationOrigin } from '@/lib/security/origin';

const AUTHJS_CALLBACK_PATH = '/api/auth/callback/email';

interface VerifyPageProps {
  searchParams: Promise<{ next?: string }>;
}

/** Whether `raw` is a same-origin Auth.js email callback URL. Defense against open-redirect abuse. */
function isSafeCallback(raw: string | undefined, expectedOrigin: string): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.origin !== expectedOrigin) return false;
    if (u.pathname !== AUTHJS_CALLBACK_PATH) return false;
    if (!u.searchParams.get('token')) return false;
    return true;
  } catch {
    return false;
  }
}

export default async function VerifyPage({ searchParams }: VerifyPageProps): Promise<ReactElement> {
  const { next } = await searchParams;

  // Best-effort origin resolution. NEXTAUTH_URL is the source of truth in
  // production; locally the verify page is hit from the same host that issued
  // the link, so deriving from the param URL itself is also fine as fallback.
  const expectedOrigin = applicationOrigin() ?? '';

  if (!isSafeCallback(next, expectedOrigin)) {
    // No valid token URL — send the visitor to /login to start a fresh request.
    redirect('/login?error=invalid_verify_link');
  }

  return (
    <main
      style={{
        minHeight: '100dvh',
        backgroundColor: '#0a0a0a',
        color: '#e8e8e8',
        fontFamily: "'Geist Mono', ui-monospace, monospace",
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        backgroundImage:
          'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.6) 100%), ' +
          'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(var(--crt-glow-rgb),0.025) 2px, rgba(var(--crt-glow-rgb),0.025) 3px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          backgroundColor: '#0e0e0e',
          border: '1px solid rgba(var(--crt-glow-rgb),0.25)',
          borderRadius: '4px',
          overflow: 'hidden',
          boxShadow: '0 0 64px rgba(var(--crt-glow-rgb),0.08)',
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--brand-accent, #00ff41)',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <CocoaWordmark sigilSize={18} wordmarkSize={14} systemTag="// THREAT DECK" />
        </div>

        <div style={{ padding: '28px 24px' }}>
          <h1
            style={{
              fontFamily: "'VT323', 'Geist Mono', monospace",
              fontSize: '24px',
              letterSpacing: '0.08em',
              color: 'var(--matrix-green, #00ff41)',
              margin: '0 0 12px 0',
              textTransform: 'uppercase',
            }}
          >
            Confirm sign-in
          </h1>
          <p
            style={{
              color: '#bdbdbd',
              fontSize: '14px',
              lineHeight: 1.55,
              margin: '0 0 22px 0',
            }}
          >
            Click the button below to enter the threat deck. This extra step blocks the
            anti-phishing scanners that would otherwise burn your single-use sign-in link before you
            see it.
          </p>

          {/*
            Real anchor (no JS) so this is a genuine user-initiated navigation.
            `next` is validated above — it points at the Auth.js callback with
            a token attached. The click consumes the token.
            `rel="noreferrer"` strips the Referer so the token never leaks
            cross-origin if the user has a referrer-leaking browser extension.
          */}
          <a
            href={next}
            rel="noreferrer"
            style={{
              display: 'inline-block',
              backgroundColor: 'var(--brand-accent-readable, var(--matrix-green, #00ff41))',
              color: '#001a08',
              fontFamily: "'Geist Mono', monospace",
              fontWeight: 700,
              fontSize: '13px',
              letterSpacing: '0.08em',
              padding: '12px 22px',
              borderRadius: '2px',
              textDecoration: 'none',
              textTransform: 'uppercase',
            }}
          >
            Open Threat Deck →
          </a>

          <hr style={{ borderColor: 'rgba(255,255,255,0.06)', margin: '24px 0 16px 0' }} />

          <p
            style={{
              color: '#777',
              fontSize: '11px',
              letterSpacing: '0.05em',
              margin: 0,
              lineHeight: 1.55,
            }}
          >
            If you didn’t request this, you can close this tab — the link will expire on its own.
            Need a fresh link?{' '}
            <Link href="/login" style={{ color: 'var(--matrix-green, #00ff41)' }}>
              Return to login
            </Link>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
