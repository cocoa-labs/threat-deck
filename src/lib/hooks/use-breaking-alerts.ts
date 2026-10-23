'use client';

import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/lib/store/agent-store';
import { useAlertsStore } from '@/lib/store/alerts-store';
import { useMapStore } from '@/lib/store/map-store';
import type { AlertHistoryItem, BreakingAlertThreshold, Severity } from '@/lib/types';

/**
 * The one producer of the hero breaking-alert overlay.
 *
 * Previously this hook was doubly dead — it read an alerts-store nothing ever
 * populated, and required `triggerData.lat/lon` that no producer ever set — so
 * in practice the red banner was raised by an ad-hoc geopolitical news watcher
 * inside MapDataProvider that could only fire on defense-industry stories and
 * threw away the headline. Both of those are gone.
 *
 * Two gates, both deliberate:
 *   1. SEVERITY — operator-configurable (`off` / `critical` / `critical+high`).
 *      The red box means "stop what you're doing"; it should be rare.
 *   2. GEO — the overlay lives on the map, so it only fires for alerts that
 *      resolved to coordinates (`/api/data/alerts` attaches `location` from
 *      `aegis_geo_threat_events`, falling back to the cyber geotagger).
 *      Alerts that don't resolve are NOT lost: they land on the ALERTS panel
 *      and the agent toast.
 */

/** How long the flash stays up. The alert itself persists on the ALERTS board. */
const ALERT_DURATION_MS = 15_000;

/**
 * How old an alert may be and still count as BREAKING.
 *
 * Without this the banner showed a 784-day-old seeded KEV row: it was the only
 * `critical` + unacknowledged row in the database (live `patch.released` alerts
 * are deliberately downgraded below critical), nothing ages alerts out, and the
 * read path had no recency filter — so it owned the banner permanently. A red
 * flash for something two days old is wrong whatever its severity.
 */
export const BREAKING_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const THRESHOLD_SEVERITIES: Record<BreakingAlertThreshold, Severity[]> = {
  off: [],
  critical: ['critical'],
  critical_high: ['critical', 'high'],
};

/**
 * Newest alert that clears all three gates — severity threshold, resolved
 * coordinates, and recency. Pure — exported for `use-breaking-alerts.test.ts`.
 *
 * `now` is injectable so the tests don't depend on wall-clock.
 */
export function selectBreakingAlert(
  alerts: AlertHistoryItem[],
  threshold: BreakingAlertThreshold,
  now: number = Date.now(),
): AlertHistoryItem | null {
  const allowed = THRESHOLD_SEVERITIES[threshold];
  if (!allowed || allowed.length === 0) return null;

  const isRecent = (createdAt: string): boolean => {
    const t = new Date(createdAt).getTime();
    // An unparseable timestamp is not evidence of recency.
    if (!Number.isFinite(t)) return false;
    return now - t <= BREAKING_MAX_AGE_MS;
  };

  return (
    alerts.find(
      (a) =>
        !a.acknowledged &&
        allowed.includes(a.severity) &&
        a.location != null &&
        isRecent(a.createdAt),
    ) ?? null
  );
}

export function useBreakingAlerts() {
  const alerts = useAlertsStore((s) => s.alerts);
  const triggerBreakingAlert = useMapStore((s) => s.triggerBreakingAlert);
  const clearBreakingAlert = useMapStore((s) => s.clearBreakingAlert);
  const flyTo = useMapStore((s) => s.flyTo);
  const lastProcessedRef = useRef<string | null>(null);

  useEffect(() => {
    if (alerts.length === 0) return;

    // Rule #24 — read the live values inside the effect. Both of these are
    // persisted user settings that can change between renders, and a
    // closure-captured selector value would go stale.
    const { autonomousAlertsEnabled, breakingAlertThreshold } = useAgentStore.getState();
    if (!autonomousAlertsEnabled) return;

    const latest = selectBreakingAlert(alerts, breakingAlertThreshold);
    if (!latest || latest.id === lastProcessedRef.current) return;
    // `selectBreakingAlert` guarantees this, but the compiler doesn't know.
    if (!latest.location) return;

    lastProcessedRef.current = latest.id;

    triggerBreakingAlert({
      alertId: latest.id,
      location: latest.location,
      headline: latest.title ?? latest.summary ?? 'Breaking alert',
      severity: latest.severity,
      alertType: latest.alertType,
      sourceUrl: latest.sourceUrl,
      timestamp: latest.createdAt,
    });
    flyTo(latest.location.lat, latest.location.lon, 6);

    const timer = setTimeout(() => clearBreakingAlert(), ALERT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [alerts, triggerBreakingAlert, clearBreakingAlert, flyTo]);
}
