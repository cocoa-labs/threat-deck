'use client';

import { useEffect, useState } from 'react';
import { type Freshness, freshnessFromAge } from '@/lib/utils/freshness';

/**
 * Re-evaluates data freshness on a steady tick so a panel's LIVE/DELAYED/STALE
 * telltale flips on time instead of waiting for an incidental re-render.
 *
 * `freshnessFromAge` is a pure snapshot of `Date.now() - dataUpdatedAt`; left
 * un-ticked, a panel that only re-renders when its query refetches (minutes to
 * hours apart) would keep showing "LIVE" long after the data went stale. This
 * hook recomputes every `tickMs` (default 5s — matching PanelShell's "ago"
 * cadence) so the badge stays honest.
 *
 * Returns `undefined` before the first successful fetch (`dataUpdatedAt === 0`),
 * which PanelShell renders as "no telltale".
 */
export function useFreshness(
  dataUpdatedAt: number,
  thresholds: { liveMs: number; staleMs: number },
  tickMs = 5_000,
): Freshness | undefined {
  // Destructure to primitives so the effect's dependency array is exact
  // (a fresh `thresholds` object identity each render would otherwise churn).
  const { liveMs, staleMs } = thresholds;

  const [freshness, setFreshness] = useState<Freshness | undefined>(() =>
    dataUpdatedAt > 0
      ? freshnessFromAge(Date.now() - dataUpdatedAt, { liveMs, staleMs })
      : undefined,
  );

  useEffect(() => {
    const evaluate = () =>
      setFreshness(
        dataUpdatedAt > 0
          ? freshnessFromAge(Date.now() - dataUpdatedAt, { liveMs, staleMs })
          : undefined,
      );

    // Recompute immediately on dependency change, then on a steady interval.
    evaluate();
    const id = setInterval(evaluate, tickMs);
    return () => clearInterval(id);
  }, [dataUpdatedAt, liveMs, staleMs, tickMs]);

  return freshness;
}
