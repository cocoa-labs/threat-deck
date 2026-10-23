'use client';

import { useMemo } from 'react';
import { useAgentStore } from '@/lib/store/agent-store';
import { useAlertsStore } from '@/lib/store/alerts-store';
import { useDataStore } from '@/lib/store/data-store';

export interface SessionDelta {
  newKev: number;
  newCriticalCves: number;
  newBreaches: number;
  newAlerts: number;
  total: number;
  /** The lastSeenAt anchor, or null on a first-ever visit (no delta to show). */
  sinceISO: string | null;
}

function toMs(ts: string | number | null | undefined): number | null {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * "What changed since your last visit" — Proactive Max, Tier 1.
 *
 * A pure, zero-API-cost reducer over the already-in-store cyber data vs the
 * persisted `lastSeenAt` anchor (stamped on drawer close). No LLM call: the
 * greeting renders these counts directly; the user clicks "Brief me" for the
 * Tier 2 agent summary. Timestamps are normalized so string/number fields all
 * compare cleanly.
 */
export function useSessionDelta(): SessionDelta {
  const lastSeenAt = useAgentStore((s) => s.lastSeenAt);
  const cves = useDataStore((s) => s.cves);
  const kev = useDataStore((s) => s.kev);
  const breaches = useDataStore((s) => s.breaches);
  const alerts = useAlertsStore((s) => s.alerts);

  return useMemo(() => {
    const sinceMs = toMs(lastSeenAt);
    if (sinceMs == null) {
      return {
        newKev: 0,
        newCriticalCves: 0,
        newBreaches: 0,
        newAlerts: 0,
        total: 0,
        sinceISO: null,
      };
    }

    const isNew = (ts: string | number | null | undefined): boolean => {
      const ms = toMs(ts);
      return ms != null && ms > sinceMs;
    };

    const newKev = kev.filter((k) => isNew(k.addedToKevAt)).length;
    const newCriticalCves = cves.filter(
      (c) => c.severity === 'critical' && isNew(c.publishedAt),
    ).length;
    const newBreaches = breaches.filter((b) => isNew(b.disclosedAt)).length;
    const newAlerts = alerts.filter((a) => !a.acknowledged && isNew(a.createdAt)).length;

    return {
      newKev,
      newCriticalCves,
      newBreaches,
      newAlerts,
      total: newKev + newCriticalCves + newBreaches + newAlerts,
      sinceISO: lastSeenAt,
    };
  }, [lastSeenAt, cves, kev, breaches, alerts]);
}
