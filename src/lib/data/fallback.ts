/**
 * Tag demo/fallback payloads so activation watchers can tell synthetic data
 * apart from the live feed.
 *
 * Collectors return hand-written DEMO_ seed data when their upstream is down
 * (rate-limited, 429, network error) so the dashboard is never blank during an
 * outage. That data is fine to RENDER — but it must never drive an outward
 * side-effect: an alert row, an autonomous Max invocation, a per-alert email,
 * an RSS item, a tweet. Before this flag existed, a transient HIBP/CISA blip
 * that swapped real data for demo (and back) manufactured phantom "new"
 * breaches / KEV entries and fired them — the `breach.disclosed org_unknown`
 * storm and fabricated critical KEV alerts.
 *
 * Wrap the DEMO_ constant once at declaration so every return path
 * (`DEMO.slice(...)`, bare `return DEMO`) carries the flag with no per-site
 * bookkeeping. This extends BUG-002's principle (fallback data must never
 * produce clickable external links) to the whole activation spine.
 */
export function markFallback<T extends object>(items: T[]): (T & { isFallback: boolean })[] {
  return items.map((item) => ({ ...item, isFallback: true }));
}
