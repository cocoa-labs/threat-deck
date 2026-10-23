/**
 * Resolve the signed-in operator to a `users` row, creating it on first touch.
 *
 * Why this exists: sessions are JWT-based and the NextAuth adapter deliberately
 * implements none of the persistence methods (see `src/lib/auth/adapter.ts` —
 * `createUser`/`linkAccount`/`createSession` are intentionally absent because
 * JWT sessions never call them). Nothing else wrote `users` either, so the
 * table stayed empty and every route that resolved an owner id via
 * `getUserByEmail()` failed for a perfectly valid session:
 *
 *   - `/api/monitors` GET/POST and `/api/monitors/[id]` PATCH/DELETE → 401
 *   - `/api/preferences` PATCH → 404 `no_user` (GET silently fell back to
 *     defaults, so preferences looked like they saved and never did)
 *   - `/api/preferences/focus-areas` → same
 *
 * Upserting is safe: `signIn` already rejects any address outside
 * `ALLOWED_EMAILS` (`isEmailAllowed` in `src/lib/auth/config.ts`), so an
 * authenticated session IS an approved operator. The row is an internal
 * ownership key, not an authorization decision.
 */

import { auth, isEmailAllowed } from '@/lib/auth';
import type { UserRow } from '@/lib/db/queries/users';
import { resolveOperatorUserByEmail } from './operator-by-email';

/**
 * The session's `users` row, created if this is the operator's first
 * ownership-scoped write. Returns null only when there is no session at all —
 * callers should treat null as 401.
 */
export async function resolveOperatorUser(): Promise<UserRow | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isEmailAllowed(email)) return null;
  return resolveOperatorUserByEmail(email, session.user?.name ?? undefined);
}
