/**
 * Phase 13 Tier 1 — Origin-header CSRF defense.
 *
 * NextAuth already sets the session cookie with `SameSite=Strict +
 * httpOnly`, which blocks most cross-site cookie attachment. But
 * defense-in-depth: we also reject any mutation whose `Origin` header
 * is set and DOES NOT match an allowed surface. This blocks cross-site
 * form POSTs (which always set `Origin` to the attacker's domain) while
 * leaving:
 *
 *   - same-origin browser fetch (sets `Origin: https://our-domain`)
 *   - direct API tooling like curl / scripts (omits `Origin` entirely)
 *
 * Used by sensitive POST routes — currently the outbound/drafts approve
 * + reject endpoints (Phase 13 Tier 1.9). Easy to add to other mutating
 * routes as we identify them.
 */

const LOCAL_HOSTS = new Set([
  'localhost:3000',
  'localhost:3002',
  '127.0.0.1:3000',
  '127.0.0.1:3002',
]);

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  // No Origin header → assume non-browser caller (curl, server-to-server,
  // some same-origin browser GETs). Auth gates downstream will catch
  // unauthenticated callers; this guard is specifically about CSRF.
  if (!origin || origin.length === 0) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const host = parsed.host;

  // Local dev — accept the documented ports.
  if (LOCAL_HOSTS.has(host)) return true;

  // Production — match against NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_URL.
  // Both are documented prod surfaces; either is sufficient.
  for (const envKey of ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_URL', 'NEXTAUTH_URL']) {
    const configured = process.env[envKey];
    if (!configured) continue;
    try {
      const url = new URL(configured);
      if (url.host === host) return true;
    } catch {
      // Skip malformed env value.
    }
  }

  return false;
}
