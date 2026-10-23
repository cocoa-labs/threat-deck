/**
 * Shared AEGIS source-URL derivation.
 *
 * Rule #21 — source attribution as a trust mechanism: every alert, tweet, and
 * agent citation points at an AEGIS HTML viewer route so the operator can open
 * the underlying record. This was previously a private helper inside
 * `src/lib/twitter/content/data.ts`; the alert spine needs the same mapping, so
 * it lives here as the single definition.
 *
 * Two modes:
 *   - absolute (default) — prefixed with NEXTAUTH_URL / NEXT_PUBLIC_SITE_URL.
 *     Required for outbound channels (tweets, email) where the link leaves the app.
 *   - relative (`{ relative: true }`) — bare `/api/aegis/...` path. Correct for
 *     in-app surfaces (panels, the breaking-alert overlay) where an absolute URL
 *     would break on localhost/preview deploys.
 */

export type AegisEntityKind =
  | 'cve'
  | 'kev'
  | 'threat_actor'
  | 'incident'
  | 'breach'
  | 'advisory'
  | 'ioc'
  | 'news'
  | 'monitor'
  | (string & {});

/** Path (no origin) for an entity's AEGIS viewer, or null when it has no viewer. */
export function aegisViewerPath(entityKind: string, entityId: string): string | null {
  const id = encodeURIComponent(entityId);
  switch (entityKind) {
    case 'cve':
      return `/api/aegis/cves/view?id=${id}`;
    case 'kev':
      return `/api/aegis/kev/view?id=${id}`;
    case 'threat_actor':
      return `/api/aegis/threat-actors/view?id=${id}`;
    case 'incident':
      return `/api/aegis/incidents/view?id=${id}`;
    case 'breach':
      return `/api/aegis/compromised-orgs/view?id=${id}`;
    default:
      // advisory / ioc / news / monitor have no standalone viewer route yet.
      return null;
  }
}

/**
 * Build a source URL for an alert entity. Falls back to a dashboard focus link
 * for kinds with no viewer route so a citation is never empty.
 */
export function deriveSourceUrl(
  entityKind: string,
  entityId: string,
  opts?: { relative?: boolean },
): string {
  // Kinds with no AEGIS viewer (news, advisories) store the canonical article
  // URL as their entity id, so the alert is still citable. Pass it through
  // untouched rather than wrapping it in a dashboard focus link.
  if (/^https?:\/\//i.test(entityId)) return entityId;

  const path = aegisViewerPath(entityKind, entityId);
  if (opts?.relative) {
    return path ?? `/?focus=${encodeURIComponent(entityId)}`;
  }
  const base = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  if (path) return `${base}${path}`;
  return base ? `${base}/?focus=${encodeURIComponent(entityId)}` : '';
}
