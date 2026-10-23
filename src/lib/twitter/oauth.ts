/**
 * Twitter OAuth 2.0 user-context flow with PKCE.
 *
 * Reference: https://developer.twitter.com/en/docs/authentication/oauth-2-0/user-access-token
 *
 * Endpoints:
 *   - Authorize:  https://x.com/i/oauth2/authorize
 *   - Token:      https://api.x.com/2/oauth2/token
 *
 * Required scopes for posting tweets and image replies:
 *   tweet.write tweet.read users.read offline.access media.write
 *   (offline.access yields a refresh token so we can mint new access tokens
 *    without re-prompting the user.)
 *
 * Single-tenant: only one Twitter handle posts at a time (Cocoa AI's
 * official Cyber Wire account). Tokens live in `cocoa_oauth_tokens`,
 * encrypted at rest via AES-256-GCM (see src/lib/crypto/symmetric.ts).
 */

import { createHash, randomBytes } from 'node:crypto';
import { decrypt, encrypt } from '@/lib/crypto/symmetric';
import { query, queryOne } from '@/lib/db/client';

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const ME_URL = 'https://api.x.com/2/users/me';
export const REQUIRED_SCOPES = [
  'tweet.write',
  'tweet.read',
  'users.read',
  'offline.access',
  'media.write',
] as const;
export const MEDIA_UPLOAD_REQUIRED_SCOPES = ['media.write'] as const;

/**
 * Proactive keep-alive: refresh when the token has less than this much life
 * left. Larger than the 60s lazy skew so the cron / dev interval renews the
 * token well before any post needs it (access tokens last ~2h). With an hourly
 * cron + ~45m dev interval, the token is always comfortably fresh.
 */
const PROACTIVE_REFRESH_WINDOW_MS = 90 * 60_000;
const PERSIST_RETRY_DELAY_MS = 500;

function oauthDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In-process single-flight guard. X rotates (single-use) refresh tokens, so two
 * concurrent refreshes would both consume the same token — the second fails and
 * can break the chain. Concurrent callers share one in-flight refresh instead.
 */
let refreshInFlight: Promise<string | null> | null = null;

export interface BuildAuthUrlInput {
  redirectUri: string;
}

export interface BuildAuthUrlResult {
  url: string;
  state: string;
  codeVerifier: string;
}

export interface ExchangeCodeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null; // ISO 8601
  scopes: string[];
}

export interface AuthenticatedTwitterUser {
  id: string;
  name: string;
  username: string;
}

export function normalizeTwitterHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').toLowerCase();
}

export function getConfiguredTwitterHandle(): string {
  return normalizeTwitterHandle(process.env.TWITTER_OAUTH_HANDLE ?? '');
}

export function formatTwitterHandle(handle: string): string {
  const trimmed = handle.trim().replace(/^@/, '');
  return trimmed ? `@${trimmed}` : 'the configured X account';
}

export function getMissingTwitterScopes(
  grantedScopes: readonly string[] | null | undefined,
  requiredScopes: readonly string[] = REQUIRED_SCOPES,
): string[] {
  const granted = new Set((grantedScopes ?? []).map((scope) => scope.trim()).filter(Boolean));
  return requiredScopes.filter((scope) => !granted.has(scope));
}

/* ─── PKCE helpers ─── */

/** Base64url-encode without padding (RFC 7636 §4.1). */
function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a high-entropy code verifier (RFC 7636 §4.1: 43-128 chars). */
function makeCodeVerifier(): string {
  return base64Url(randomBytes(48)); // 48 bytes → 64 base64url chars
}

/** S256 challenge: BASE64URL(SHA-256(verifier)). */
function makeCodeChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

/** Opaque CSRF token round-tripped through the cookie. */
function makeState(): string {
  return base64Url(randomBytes(24));
}

/* ─── OAuth client helpers ─── */

function getClientId(): string {
  const id = process.env.TWITTER_OAUTH_CLIENT_ID;
  if (!id) throw new Error('TWITTER_OAUTH_CLIENT_ID is not set');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.TWITTER_OAUTH_CLIENT_SECRET;
  if (!secret) throw new Error('TWITTER_OAUTH_CLIENT_SECRET is not set');
  return secret;
}

/** Confidential client: HTTP Basic auth header per RFC 6749 §2.3.1. */
function basicAuthHeader(): string {
  const id = getClientId();
  const secret = getClientSecret();
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

/* ─── Public API ─── */

/**
 * Build a Twitter authorization URL. Caller stores `state` + `codeVerifier`
 * in a short-lived encrypted cookie and validates them in the callback.
 */
export function buildAuthUrl({ redirectUri }: BuildAuthUrlInput): BuildAuthUrlResult {
  const clientId = getClientId();
  const state = makeState();
  const codeVerifier = makeCodeVerifier();
  const codeChallenge = makeCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: REQUIRED_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state, codeVerifier };
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * Throws with the Twitter error body on non-2xx.
 */
export async function exchangeCodeForTokens({
  code,
  codeVerifier,
  redirectUri,
}: ExchangeCodeInput): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    // client_id is technically optional when using Basic auth, but Twitter's
    // implementation rejects requests without it.
    client_id: getClientId(),
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuthHeader(),
    },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg = (json.error_description as string) ?? (json.error as string) ?? res.statusText;
    throw new Error(`Token exchange failed (${res.status}): ${errMsg}`);
  }
  return normalizeTokenResponse(json);
}

/**
 * Use a refresh token to mint a new access token. Twitter rotates refresh
 * tokens, so the caller must persist the new refresh_token from the response.
 */
export async function refreshAccessToken({
  refreshToken,
}: {
  refreshToken: string;
}): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getClientId(),
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuthHeader(),
    },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg = (json.error_description as string) ?? (json.error as string) ?? res.statusText;
    throw new Error(`Refresh failed (${res.status}): ${errMsg}`);
  }
  return normalizeTokenResponse(json);
}

/**
 * Resolve which X user actually authorized this OAuth token.
 *
 * This is the safety catch for operators with multiple accounts in the same
 * browser session: the app may be owned by one developer account/team, but the
 * posting identity is the user who grants OAuth consent.
 */
export async function fetchAuthenticatedUser(
  accessToken: string,
): Promise<AuthenticatedTwitterUser> {
  const res = await fetch(ME_URL, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg = (json.detail as string) ?? (json.title as string) ?? res.statusText;
    throw new Error(`Authenticated user lookup failed (${res.status}): ${errMsg}`);
  }

  const data = json.data as Record<string, unknown> | undefined;
  if (
    !data ||
    typeof data.id !== 'string' ||
    typeof data.name !== 'string' ||
    typeof data.username !== 'string'
  ) {
    throw new Error('Authenticated user lookup returned an invalid user shape');
  }

  return {
    id: data.id,
    name: data.name,
    username: data.username,
  };
}

/** Shape Twitter's token-endpoint JSON into our TokenResult. */
function normalizeTokenResponse(json: Record<string, unknown>): TokenResult {
  const accessToken = json.access_token;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new Error('Token response missing access_token');
  }
  const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : null;
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : null;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  // `scope` is space-delimited per the OAuth 2.0 spec.
  const scopes =
    typeof json.scope === 'string' ? json.scope.split(/\s+/).filter(Boolean) : [...REQUIRED_SCOPES];

  return { accessToken, refreshToken, expiresAt, scopes };
}

/* ─── Token persistence ─── */

interface TokenRow {
  id: number;
  provider: string;
  handle: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
  scopes: string[] | null;
}

interface TokenScopeRow {
  scopes: string[] | null;
}

/**
 * Upsert a token set for `(provider, handle)`. Encrypts both tokens at rest.
 * Returns nothing — callers don't need the row id.
 */
export async function upsertToken({
  provider,
  handle,
  tokens,
}: {
  provider: string;
  handle: string;
  tokens: TokenResult;
}): Promise<void> {
  const accessEnc = encrypt(tokens.accessToken);
  const refreshEnc = tokens.refreshToken ? encrypt(tokens.refreshToken) : null;

  await query(
    `
    INSERT INTO cocoa_oauth_tokens
      (provider, handle, access_token_encrypted, refresh_token_encrypted, expires_at, scopes)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (provider, handle) DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      expires_at = EXCLUDED.expires_at,
      scopes = EXCLUDED.scopes,
      last_used_at = NOW()::text
    `,
    [provider, handle, accessEnc, refreshEnc, tokens.expiresAt, tokens.scopes],
  );
}

/**
 * Refresh the access token from a row's refresh token and PERSIST the rotated
 * pair. X rotates refresh tokens (single-use), so a failed persist would break
 * the chain permanently — we retry the persist, and if it still fails we surface
 * it loudly (the operator must reconnect). Returns the new access token, or null
 * if there's no refresh token / refresh fails.
 */
async function refreshAndPersist(row: TokenRow): Promise<string | null> {
  if (!row.refresh_token_encrypted) {
    console.warn('[twitter/oauth] Token expired and no refresh token stored — reconnect required');
    return null;
  }

  let refreshToken: string;
  try {
    refreshToken = decrypt(row.refresh_token_encrypted);
  } catch (err) {
    console.error('[twitter/oauth] Refresh token decrypt failed:', err);
    return null;
  }

  let refreshed: TokenResult;
  try {
    refreshed = await refreshAccessToken({ refreshToken });
  } catch (err) {
    console.error('[twitter/oauth] Refresh request failed (reconnect may be required):', err);
    return null;
  }

  // Persist-or-fail: retry a transient DB hiccup so a single failure doesn't
  // strand us with X's now-consumed refresh token.
  let persisted = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await upsertToken({ provider: 'twitter', handle: row.handle, tokens: refreshed });
      persisted = true;
      break;
    } catch (err) {
      console.error(
        `[twitter/oauth] persist refreshed token failed (attempt ${attempt + 1}/3):`,
        err,
      );
      await oauthDelay(PERSIST_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  if (!persisted) {
    console.error(
      '[twitter/oauth] CRITICAL: refreshed token could not be persisted — the rotated refresh token is lost; the chain will break. Reconnect X.',
    );
  }

  return refreshed.accessToken;
}

/** Single-flight wrapper so concurrent callers share one refresh (see above). */
function refreshSingleFlight(row: TokenRow): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAndPersist(row).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/**
 * Fetch a usable access token for the active Twitter handle.
 *
 * - Returns null if no row exists (caller should prompt "Connect X →").
 * - If the access token is expired (or within a 60s skew), refreshes
 *   transparently and persists the rotated tokens.
 * - Returns null if refresh fails (token revoked, network error, etc.) —
 *   never throws, so the calling route can fail-soft.
 *
 * Single-tenant assumption: we read the row for the configured posting
 * handle. This deliberately ignores stale/wrong account tokens in the DB.
 * Multi-tenant would pass a tenantId and add a WHERE clause.
 */
export async function getActiveToken({
  forceRefresh = false,
}: {
  forceRefresh?: boolean;
} = {}): Promise<string | null> {
  const configuredHandle = getConfiguredTwitterHandle();
  let row: TokenRow | null;
  try {
    row = await queryOne<TokenRow>(
      `SELECT id, provider, handle,
              access_token_encrypted, refresh_token_encrypted,
              expires_at, scopes
       FROM cocoa_oauth_tokens
       WHERE provider = 'twitter'
         AND lower(ltrim(handle, '@')) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [configuredHandle],
    );
  } catch (err) {
    console.error('[twitter/oauth] DB read failed:', err);
    return null;
  }
  if (!row) return null;

  // Reactive recovery: the caller saw a 401 from X on a token we believed was
  // still valid (mid-life invalidation, or a rotation that didn't persist).
  // Rotate now regardless of the cached expires_at — skip the stale access
  // token entirely and mint a fresh one via the single-flight + persist path.
  if (forceRefresh) return refreshSingleFlight(row);

  let accessToken: string;
  try {
    accessToken = decrypt(row.access_token_encrypted);
  } catch (err) {
    console.error('[twitter/oauth] Access token decrypt failed:', err);
    return null;
  }

  // 60-second skew so we don't hand out a token that expires mid-request.
  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
  const isExpired = Number.isFinite(expiresAt) && expiresAt - Date.now() < 60_000;

  if (!isExpired) {
    // Touch last_used_at; best-effort, don't block on failure.
    query(`UPDATE cocoa_oauth_tokens SET last_used_at = NOW()::text WHERE id = $1`, [row.id]).catch(
      (err) => console.error('[twitter/oauth] last_used_at update failed:', err),
    );
    return accessToken;
  }

  // Expired (or within skew) — refresh via the single-flight + persist-or-fail
  // path so concurrent posts don't double-consume the rotating refresh token.
  return refreshSingleFlight(row);
}

export async function getActiveTokenScopes(): Promise<string[] | null> {
  const configuredHandle = getConfiguredTwitterHandle();
  try {
    const row = await queryOne<TokenScopeRow>(
      `SELECT scopes
       FROM cocoa_oauth_tokens
       WHERE provider = 'twitter'
         AND lower(ltrim(handle, '@')) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [configuredHandle],
    );
    return row?.scopes ?? null;
  } catch (err) {
    console.error('[twitter/oauth] Scope metadata read failed:', err);
    return null;
  }
}

export interface ProactiveRefreshResult {
  ok: boolean;
  refreshed: boolean;
  reason: 'fresh' | 'refreshed' | 'no_token' | 'refresh_failed' | 'db_error';
  expiresAt?: string | null;
}

/**
 * Keep-alive entry point. Refreshes the stored token BEFORE it expires (when it
 * has less than PROACTIVE_REFRESH_WINDOW_MS of life left) so posts never hit the
 * lazy expired-refresh path under load. No-op when the token is still
 * comfortably fresh. Invoked by the Vercel cron (`/api/cron/twitter-refresh`)
 * in production and by a local interval (`instrumentation.ts`) in dev. Never
 * throws — returns a status the caller can log.
 */
export async function proactiveRefreshToken(): Promise<ProactiveRefreshResult> {
  const configuredHandle = getConfiguredTwitterHandle();
  let row: TokenRow | null;
  try {
    row = await queryOne<TokenRow>(
      `SELECT id, provider, handle,
              access_token_encrypted, refresh_token_encrypted,
              expires_at, scopes
       FROM cocoa_oauth_tokens
       WHERE provider = 'twitter'
         AND lower(ltrim(handle, '@')) = $1
       ORDER BY id DESC
       LIMIT 1`,
      [configuredHandle],
    );
  } catch (err) {
    console.error('[twitter/oauth] proactive refresh DB read failed:', err);
    return { ok: false, refreshed: false, reason: 'db_error' };
  }
  if (!row) return { ok: false, refreshed: false, reason: 'no_token' };

  const expiresAt = row.expires_at ? Date.parse(row.expires_at) : Number.POSITIVE_INFINITY;
  const needsRefresh =
    Number.isFinite(expiresAt) && expiresAt - Date.now() < PROACTIVE_REFRESH_WINDOW_MS;
  if (!needsRefresh) {
    return { ok: true, refreshed: false, reason: 'fresh', expiresAt: row.expires_at };
  }

  const token = await refreshSingleFlight(row);
  if (!token) return { ok: false, refreshed: false, reason: 'refresh_failed' };
  return { ok: true, refreshed: true, reason: 'refreshed' };
}
