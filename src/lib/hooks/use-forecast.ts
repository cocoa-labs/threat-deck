'use client';

/**
 * Phase 11.D.11 — IntelCard forecast hook.
 *
 * TanStack Query wrapper around /api/aegis/predictions/cve-forecast and
 * /api/aegis/predictions/actor-forecast with the same 300ms debounce +
 * 5-min stale window as use-pivots.ts so rapid hover cycles don't fan
 * out one request per cursor flicker.
 *
 * Returns a flattened ForecastData shape that IntelCardForecast renders
 * directly — so the kind-switching logic lives here, not in the
 * presentational component.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

const DEBOUNCE_MS = 300;
const STALE_MS = 5 * 60_000;
const GC_MS = 60 * 60_000;

export type ForecastKind = 'cve' | 'threat_actor' | 'campaign';

export interface ForecastData {
  logistic?: {
    pExploited30d: number;
    pExploited60d: number;
    pExploited90d: number;
    ciLow: number;
    ciHigh: number;
    modelVersion: string;
  } | null;
  hmm?: {
    stateDistribution: number[];
    viterbiPath: number[];
    expectedDaysToKev: number | null;
    modelVersion: string;
  } | null;
  actorTargets?: Array<{
    category: string;
    pMean: number;
    pLow: number;
    pHigh: number;
  }> | null;
  actorTargetsModel?: string;
}

export interface UseForecastResult {
  data: ForecastData | null;
  loading: boolean;
}

export function useForecast(kind: ForecastKind | null, entityId: string | null): UseForecastResult {
  const [debounced, setDebounced] = useState<{ kind: ForecastKind; entityId: string } | null>(null);

  // Debounce — gated through setTimeout so set-state-in-effect lint passes.
  useEffect(() => {
    if (!kind || !entityId) {
      const id = setTimeout(() => setDebounced(null), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setDebounced({ kind, entityId }), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [kind, entityId]);

  const query = useQuery({
    enabled: debounced !== null,
    queryKey: ['forecast', debounced?.kind, debounced?.entityId],
    staleTime: STALE_MS,
    gcTime: GC_MS,
    queryFn: async () => {
      if (!debounced) return null;
      if (debounced.kind === 'cve') {
        const res = await fetch(
          `/api/aegis/predictions/cve-forecast?cveId=${encodeURIComponent(debounced.entityId)}`,
        );
        if (!res.ok) return null;
        const json = (await res.json()) as {
          ok: boolean;
          forecast: { logistic: ForecastData['logistic']; hmm: ForecastData['hmm'] } | null;
        };
        if (!json.ok || !json.forecast) return null;
        return {
          logistic: json.forecast.logistic,
          hmm: json.forecast.hmm,
        } as ForecastData;
      }
      // threat_actor or campaign — both query the actor endpoint. Campaign
      // resolves to its parent actor before issuing the call (the
      // entityId passed in for a campaign is the actor id per the
      // IntelCard wiring below).
      const res = await fetch(
        `/api/aegis/predictions/actor-forecast?actorId=${encodeURIComponent(debounced.entityId)}`,
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        ok: boolean;
        forecast: {
          sectors: { topCategories: ForecastData['actorTargets']; modelVersion: string } | null;
        } | null;
      };
      if (!json.ok || !json.forecast?.sectors) return null;
      return {
        actorTargets: json.forecast.sectors.topCategories,
        actorTargetsModel: json.forecast.sectors.modelVersion,
      } as ForecastData;
    },
  });

  return {
    data: (query.data as ForecastData | null | undefined) ?? null,
    loading: query.isFetching && !query.data,
  };
}
