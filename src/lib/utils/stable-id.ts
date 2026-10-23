/**
 * Deterministic numeric ids derived from a stable string key.
 *
 * Why: `Advisory.id` used to be a positional index — `id: idx` inside each
 * collector's `.map()`, then re-numbered `1..N` again after sorting, and a
 * third time in the `/api/data/advisories` merge branch. So the same advisory
 * carried a different id on every poll, and a different id depending on which
 * endpoint fetched it. Downstream API and ticker consumers need identity, not
 * position; React rows use the full canonical advisory key directly.
 *
 * djb2-style, matching the inline hash already used by `seededOffset` in
 * `src/lib/utils/geo.ts`. Not cryptographic — it only has to be stable and
 * well-distributed enough that two distinct advisories don't collide.
 */

/** Positive 31-bit hash of `key`. Same input always yields the same output. */
export function stableNumericId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  // Force positive: ids are compared and rendered as plain numbers, and a
  // negative id reads as corrupt data downstream.
  return Math.abs(hash) || 1;
}

/**
 * Stamp a stable `id` on every advisory-shaped item, derived from its
 * `advisoryId` (both collectors always set one: `${issuer}-…` / `${vendor}-…`).
 * Falls back to the advisory URL, then the title, so an item is never left with
 * a positional id.
 */
export function withStableAdvisoryIds<
  T extends { id: number; advisoryId?: string; advisoryUrl?: string; title?: string },
>(items: T[]): T[] {
  return items.map((item) => ({
    ...item,
    id: stableNumericId(item.advisoryId ?? item.advisoryUrl ?? item.title ?? String(item.id)),
  }));
}
