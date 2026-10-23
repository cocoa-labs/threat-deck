import { auth } from '@/lib/auth';
import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/twitter/oauth/callback
 *
 * Twitter redirects back here with `?code=…&state=…` after the user
 * authorizes (or `?error=…` if they decline). We:
 *   1. Read + decrypt the cookie set by /start.
 *   2. Validate that the returned `state` matches what we stored (CSRF).
 *   3. Exchange the code for tokens using the stored PKCE verifier.
 *   4. Upsert the encrypted tokens into cocoa_oauth_tokens.
 *   5. Clear the OAuth cookie and redirect to /twitter-connected.html.
 */

import { NextResponse } from 'next/server';
import { decrypt } from '@/lib/crypto/symmetric';
import {
  exchangeCodeForTokens,
  fetchAuthenticatedUser,
  getConfiguredTwitterHandle,
  normalizeTwitterHandle,
  upsertToken,
} from '@/lib/twitter/oauth';

const COOKIE_NAME = 'cocoa_twitter_oauth';
const COOKIE_MAX_AGE_SECONDS = 300;

interface CookiePayload {
  operatorEmail: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  issuedAt: number;
}

function clearOauthCookie(response: NextResponse): void {
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/twitter/oauth',
    maxAge: 0,
  });
}

/** Build a redirect to the success page (or error page) on the same origin. */
function redirectTo(request: Request, path: string): NextResponse {
  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}${path}`);
}

/** Node socket + Postgres class-08 (connection exception) failure codes. */
const DB_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '57P01',
  '57P03',
]);

/**
 * Distinguishes "the database is unreachable" (in local dev, almost always
 * Docker not running) from a genuine write failure. Both used to surface as a
 * bare `persist_failed`, which the success page rendered as "Twitter rejected
 * the authorization" — sending debugging after X's API when Postgres was simply
 * down. Callers map this to a distinct, truthful reason.
 */
function isDbConnectivityError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && DB_CONNECTION_ERROR_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|Connection terminated|terminating connection|server closed the connection/i.test(
    message,
  );
}

async function routeGETImplementation(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const userError = searchParams.get('error');

  // User declined / Twitter returned an explicit error.
  if (userError) {
    console.warn('[twitter/oauth/callback] User-facing OAuth error:', userError);
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=${encodeURIComponent(userError)}`,
    );
    clearOauthCookie(response);
    return response;
  }

  if (!code || !state) {
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=missing_params`,
    );
    clearOauthCookie(response);
    return response;
  }

  // Read + decrypt the cookie.
  const cookieRaw = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!cookieRaw) {
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=missing_cookie`,
    );
    clearOauthCookie(response);
    return response;
  }

  let payload: CookiePayload;
  try {
    const decoded = decodeURIComponent(cookieRaw);
    payload = JSON.parse(decrypt(decoded)) as CookiePayload;
  } catch (err) {
    console.error('[twitter/oauth/callback] Cookie decrypt/parse failed:', err);
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=invalid_cookie`,
    );
    clearOauthCookie(response);
    return response;
  }

  // CSRF check — constant-time-ish compare since both are random base64url tokens of equal length.
  if (state !== payload.state || payload.operatorEmail !== (await auth())?.user?.email) {
    console.warn('[twitter/oauth/callback] state mismatch');
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=state_mismatch`,
    );
    clearOauthCookie(response);
    return response;
  }

  // Defense in depth: don't accept a stale cookie even if maxAge somehow leaked.
  if (
    !Number.isFinite(payload.issuedAt) ||
    payload.issuedAt > Date.now() ||
    Date.now() - payload.issuedAt > COOKIE_MAX_AGE_SECONDS * 1000
  ) {
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=cookie_expired`,
    );
    clearOauthCookie(response);
    return response;
  }

  // Exchange the code.
  let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: payload.codeVerifier,
      redirectUri: payload.redirectUri,
    });
  } catch (err) {
    console.error('[twitter/oauth/callback] token exchange failed:', err);
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=token_exchange_failed`,
    );
    clearOauthCookie(response);
    return response;
  }

  const expectedHandle = getConfiguredTwitterHandle();
  let authorizedUser: Awaited<ReturnType<typeof fetchAuthenticatedUser>>;
  try {
    authorizedUser = await fetchAuthenticatedUser(tokens.accessToken);
  } catch (err) {
    console.error('[twitter/oauth/callback] authenticated user lookup failed:', err);
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=handle_lookup_failed`,
    );
    clearOauthCookie(response);
    return response;
  }

  const authorizedHandle = normalizeTwitterHandle(authorizedUser.username);
  if (authorizedHandle !== expectedHandle) {
    console.warn('[twitter/oauth/callback] wrong X handle authorized', {
      expectedHandle,
      authorizedHandle,
    });
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=handle_mismatch_${encodeURIComponent(
        authorizedUser.username,
      )}`,
    );
    clearOauthCookie(response);
    return response;
  }

  try {
    await upsertToken({ provider: 'twitter', handle: authorizedUser.username, tokens });
  } catch (err) {
    const dbDown = isDbConnectivityError(err);
    console.error(
      dbDown
        ? '[twitter/oauth/callback] token persist failed — DATABASE UNREACHABLE (is Docker running? `docker compose up -d`):'
        : '[twitter/oauth/callback] token persist failed:',
      err,
    );
    const response = redirectTo(
      request,
      `/twitter-connected.html?status=error&reason=${dbDown ? 'persist_failed_db_down' : 'persist_failed'}`,
    );
    clearOauthCookie(response);
    return response;
  }

  const response = redirectTo(request, `/twitter-connected.html?status=ok`);
  clearOauthCookie(response);
  return response;
}

export const GET = withRoutePolicy('/api/twitter/oauth/callback', routeGETImplementation);
