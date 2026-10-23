import { handlers } from '@/lib/auth';
import { withRoutePolicy } from '@/lib/security/route-policy';

/**
 * Auth.js (NextAuth v5) catch-all route handler.
 *
 * Exposes the standard Auth.js endpoints under /api/auth/*:
 *   - GET  /api/auth/signin
 *   - POST /api/auth/signin/:provider   (email submission lands here)
 *   - GET  /api/auth/callback/:provider (magic-link verification)
 *   - GET  /api/auth/session            (current session JSON)
 *   - POST /api/auth/signout
 *   - GET  /api/auth/csrf
 *   - GET  /api/auth/providers
 *
 * Our front-door magic-link request endpoint lives at `/api/auth/magic-link`
 * (separate file) and internally relays into Auth.js's flow.
 */

export const GET = withRoutePolicy('/api/auth/[...nextauth]', handlers.GET);
export const POST = withRoutePolicy('/api/auth/[...nextauth]', handlers.POST);
