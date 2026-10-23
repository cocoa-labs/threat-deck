import type { Adapter, AdapterUser, VerificationToken } from 'next-auth/adapters';

import { AUDIT_ACTIONS, auditSuccess } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { isEmailAllowed } from './allowlist';

/**
 * Postgres-backed Adapter for NextAuth (Auth.js v5) magic-link flow.
 *
 * Auth.js's email-provider sign-in pipeline only touches three adapter methods:
 *   - createVerificationToken  (called when the user requests a magic link)
 *   - useVerificationToken     (called when the user clicks the link)
 *   - getUserByEmail           (we always return null — see below)
 *
 * Storage: `aegis_verification_tokens` (migrations/006_verification_tokens.sql).
 *
 * Why Postgres (Phase 8.6): the previous in-memory `Map<string, StoredToken>`
 * sat at module scope. Every Next.js HMR cycle re-imported the module and
 * reset the Map, instantly invalidating every in-flight magic-link. The
 * symptom was a perpetual redirect loop on `/login?error=Verification` that
 * looked like an auth bug but was really a dev-loop artifact. Persisting
 * tokens in Postgres makes them survive HMR, server restarts, and (future)
 * multi-instance deploys.
 *
 * Persistence-required adapter methods (createUser, linkAccount,
 * createSession, etc.) are intentionally NOT implemented — JWT sessions
 * never call them, and our signIn callback rejects unallowed emails before
 * the user-creation path is taken.
 */

async function dbCreateVerificationToken(t: VerificationToken): Promise<VerificationToken> {
  // ON CONFLICT update lets a user request a second magic link before the
  // first expires — the new TTL replaces the old one. Auth.js generates a
  // fresh token per request so the (identifier, token) key is effectively
  // unique anyway; this is belt-and-suspenders.
  await query(
    `INSERT INTO aegis_verification_tokens (identifier, token, expires)
     VALUES ($1, $2, $3)
     ON CONFLICT (identifier, token) DO UPDATE SET expires = EXCLUDED.expires`,
    [t.identifier, t.token, t.expires],
  );
  return t;
}

async function dbUseVerificationToken(params: {
  identifier: string;
  token: string;
}): Promise<VerificationToken | null> {
  // Atomic single-use: DELETE-RETURNING in a single statement so two
  // concurrent clicks on the same link (e.g., a stale Gmail prefetch racing
  // a real user click) cannot both succeed. The `expires > NOW()` predicate
  // also gates expired tokens — they're deleted on consumption either way,
  // but only returned if still valid.
  const { rows } = await query<{ identifier: string; token: string; expires: Date }>(
    `DELETE FROM aegis_verification_tokens
     WHERE identifier = $1
       AND token = $2
       AND expires > NOW()
     RETURNING identifier, token, expires`,
    [params.identifier, params.token],
  );

  const row = rows[0];
  if (!row) return null;

  // Audit the successful acceptance — closes the loop with
  // `auth.magic_link_requested` so SECURITY can see "user X requested at T1,
  // accepted at T2". Fire-and-forget; never block auth.
  void auditSuccess(AUDIT_ACTIONS.AUTH_MAGIC_LINK_ACCEPTED, {
    actorId: row.identifier,
    targetKind: 'user',
    targetId: row.identifier,
  });

  return { identifier: row.identifier, token: row.token, expires: row.expires };
}

/**
 * Factory — returns the minimal Adapter surface NextAuth needs for email-link
 * auth with JWT sessions. All other methods are deliberately omitted; if a
 * future adapter consumer reaches for one, TypeScript will flag the missing
 * implementation.
 */
export function createMagicLinkAdapter(): Adapter {
  return {
    async getUser(id) {
      return isEmailAllowed(id) ? { id, email: id, emailVerified: new Date() } : null;
    },
    async createVerificationToken(token) {
      return dbCreateVerificationToken({
        identifier: token.identifier,
        token: token.token,
        expires: token.expires,
      });
    },

    async useVerificationToken(params) {
      return dbUseVerificationToken(params);
    },

    /**
     * Return a SYNTHETIC user keyed by the email. We never persist users to
     * the DB — the signIn callback gates on the ALLOWED_EMAILS allowlist, and
     * JWT sessions keep all identity data in the cookie itself. But Auth.js
     * v5 requires this to return a non-null AdapterUser so the email-provider
     * pipeline can build the JWT payload without falling through to
     * `createUser` (which we don't implement; Auth.js would throw
     * CallbackRouteError: Configuration).
     *
     * The returned `id` is the email itself — stable, unique within our
     * single-tenant deployment, and matches what `session.user.email` will
     * carry to client code.
     */
    async getUserByEmail(email): Promise<AdapterUser | null> {
      return {
        id: email,
        email,
        emailVerified: new Date(),
      };
    },

    /**
     * Auth.js v5's email-provider pipeline calls this immediately after
     * `useVerificationToken` succeeds, to update `emailVerified` on the user
     * record. We don't persist anything, so this is a no-op that just echoes
     * back a synthetic user matching `getUserByEmail`. Without it, Auth.js
     * throws `CallbackRouteError: updateUser is not a function` and bounces
     * the user back to /login.
     */
    async updateUser(user): Promise<AdapterUser> {
      return {
        id: user.id ?? user.email ?? 'unknown',
        email: user.email ?? user.id ?? 'unknown',
        emailVerified: user.emailVerified ?? new Date(),
        name: user.name ?? null,
        image: user.image ?? null,
      };
    },

    /**
     * Stub — same rationale as updateUser. Auth.js may call linkAccount when
     * associating an email-provider "account" with a user. We don't persist
     * accounts; returning the input keeps the pipeline happy without writing
     * anything.
     */
    async linkAccount(account) {
      return account;
    },
  };
}
