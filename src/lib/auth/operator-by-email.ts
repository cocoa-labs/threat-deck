/**
 * Email-keyed half of operator resolution, split out from `operator.ts` so it
 * carries NO NextAuth import.
 *
 * Agent tools need this: they receive a server-trusted `operatorEmail` via
 * `ToolExecutionContext` (merged onto tool input by `ToolRegistry`) rather than
 * reading the session themselves, and importing `@/lib/auth` from a tool
 * handler drags NextAuth into every context that loads it — including vitest,
 * where `next-auth/lib/env` fails to resolve `next/server`.
 *
 * See `operator.ts` for why the upsert exists at all: JWT sessions never create
 * `users` rows, so ownership-scoped writes had nothing to key on.
 */

import { type UserRow, upsertUser } from '@/lib/db/queries/users';

/** The `users` row for this email, created on first touch. Null if no email. */
export async function resolveOperatorUserByEmail(
  email: string | null | undefined,
  name?: string,
): Promise<UserRow | null> {
  if (!email) return null;
  return upsertUser({ email, name });
}
