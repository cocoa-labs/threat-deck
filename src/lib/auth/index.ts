import NextAuth from 'next-auth';
import { authConfig } from './config';

/**
 * Single source of truth for Auth.js v5 in Cocoa AI Threat Deck.
 *
 * Import from here (not directly from `next-auth`) so that:
 *   - The shared config in `./config.ts` is always the one applied.
 *   - Tests and tools can swap the export by mocking this module.
 *
 * Exposes the four primitives the v5 App Router API gives us:
 *   - `handlers`  — { GET, POST } for the catch-all route at /api/auth/[...nextauth]
 *   - `auth`      — server-side session reader; use in Server Components & route handlers
 *   - `signIn`    — server-side sign-in trigger (also used by our /api/auth/magic-link wrapper)
 *   - `signOut`   — server-side sign-out trigger; wire to a sign-out button when needed
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export { authConfig, isEmailAllowed } from './config';
