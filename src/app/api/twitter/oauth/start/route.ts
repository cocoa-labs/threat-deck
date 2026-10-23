import { auth } from '@/lib/auth';
import { applicationOrigin } from '@/lib/security/origin';
import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/twitter/oauth/start
 *
 * Kicks off the Twitter OAuth 2.0 user-context flow:
 *   1. Generates a PKCE pair (code_verifier + code_challenge) and a CSRF state.
 *   2. Stores { state, codeVerifier, redirectUri } in a short-lived encrypted
 *      cookie so the callback can validate the state and recover the verifier.
 *   3. 302-redirects the browser to twitter.com/i/oauth2/authorize.
 *
 * The cookie is httpOnly, sameSite=lax (needed for the cross-site redirect
 * back from twitter.com), 5-minute TTL, and Path=/api/twitter/oauth so it's
 * scoped to the callback handler only.
 */

import { NextResponse } from 'next/server';
import { encrypt } from '@/lib/crypto/symmetric';
import { buildAuthUrl } from '@/lib/twitter/oauth';

const COOKIE_NAME = 'cocoa_twitter_oauth';
const COOKIE_MAX_AGE_SECONDS = 300; // 5 minutes — auth flow should complete fast

function resolveRedirectUri(request: Request): string {
  const fromEnv = process.env.TWITTER_OAUTH_REDIRECT_URI;
  if (fromEnv) return fromEnv;
  // Fallback: derive from the request origin so localhost / preview hosts work
  // without explicit config. In production, set TWITTER_OAUTH_REDIRECT_URI.
  const url = new URL(applicationOrigin() || request.url);
  return `${url.origin}/api/twitter/oauth/callback`;
}

async function routeGETImplementation(request: Request) {
  let authResult: ReturnType<typeof buildAuthUrl>;
  try {
    const redirectUri = resolveRedirectUri(request);
    authResult = buildAuthUrl({ redirectUri });
  } catch (err) {
    console.error('[twitter/oauth/start] buildAuthUrl failed:', err);
    return NextResponse.json(
      { error: 'oauth_config_error', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    );
  }

  // Encrypt the cookie payload — keeps state + verifier opaque even if the
  // cookie is exfiltrated (the AES key lives server-side).
  let cookieValue: string;
  try {
    cookieValue = encrypt(
      JSON.stringify({
        operatorEmail: (await auth())?.user?.email,
        state: authResult.state,
        codeVerifier: authResult.codeVerifier,
        redirectUri: resolveRedirectUri(request),
        issuedAt: Date.now(),
      }),
    );
  } catch (err) {
    console.error('[twitter/oauth/start] cookie encrypt failed:', err);
    return NextResponse.json(
      {
        error: 'crypto_error',
        detail: 'OAUTH_ENCRYPTION_KEY is not configured. See .env.example.',
      },
      { status: 500 },
    );
  }

  const response = NextResponse.redirect(authResult.url);
  response.cookies.set({
    name: COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/twitter/oauth',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export const GET = withRoutePolicy('/api/twitter/oauth/start', routeGETImplementation);
