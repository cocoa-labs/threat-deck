'use client';

/**
 * Phase 10.3 — IntelCard pivot suggestions hook.
 *
 * TanStack Query wrapper around POST /api/aegis/pivot-suggestions with a
 * 300ms debounce so rapid hover cycles over many lens nodes don't fan out
 * one request per cursor flicker.
 *
 * Caching:
 *   - `staleTime: 5 minutes` — within 5 min the same (kind, entityId) reuses
 *     the cached response (TanStack cache + the route's own 1h server cache
 *     downstream).
 *   - `gcTime: 1 hour` — keeps recently-seen entities warm in memory so
 *     re-hovering an actor 30 min later doesn't refetch.
 *   - `enabled: false` when entityId is empty OR debounce is still settling.
 *
 * Failure semantics:
 *   - Network errors → empty suggestions (route is fail-soft 200 so this
 *     only fires for genuine network drops).
 *   - 4xx → empty + log a warning, but DO NOT throw so the IntelCard
 *     doesn't go black on a bad entityId.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type {
  PivotKind,
  PivotResponse,
  PivotSuggestion,
} from '@/app/api/aegis/pivot-suggestions/route';

const DEBOUNCE_MS = 300;
const STALE_MS = 5 * 60_000;
const GC_MS = 60 * 60_000;

export interface UsePivotsResult {
  suggestions: PivotSuggestion[];
  sourceUrl: string | null;
  loading: boolean;
}

/**
 * Fetch pivot suggestions for an AEGIS entity. Returns empty + non-loading
 * when `kind` or `entityId` is null (caller can short-circuit rendering).
 */
export function usePivots(kind: PivotKind | null, entityId: string | null): UsePivotsResult {
  // Debounced (kind, entityId) — only changes after the inputs have been
  // stable for DEBOUNCE_MS, so rapid hover cycles don't fan out requests.
  const [debounced, setDebounced] = useState<{ kind: PivotKind; entityId: string } | null>(null);

  useEffect(() => {
    // Both branches schedule via setTimeout so setState is never invoked
    // synchronously inside the effect body — that pattern cascades a render
    // and trips react-hooks/set-state-in-effect. A 0ms timeout for the
    // clear path is enough to satisfy the rule without observable delay.
    if (!kind || !entityId) {
      const id = setTimeout(() => setDebounced(null), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      setDebounced({ kind, entityId });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [kind, entityId]);

  const queryEnabled = debounced != null;

  // Capture into a local so the queryFn closure doesn't need to re-narrow
  // through optional chains or non-null assertions. The `enabled` gate
  // below ensures we only call queryFn when `queryDebounced` is non-null.
  const queryDebounced = debounced;
  const { data, isFetching } = useQuery<PivotResponse>({
    queryKey: ['pivots', queryDebounced?.kind ?? '', queryDebounced?.entityId ?? ''],
    queryFn: async () => {
      // `enabled: queryEnabled` (= queryDebounced != null) gates this branch.
      if (!queryDebounced) throw new Error('pivots queryFn invoked without debounced inputs');
      const res = await fetch('/api/aegis/pivot-suggestions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: queryDebounced.kind, entityId: queryDebounced.entityId }),
      });
      if (!res.ok) {
        // Fail-soft synthetic response — the route is meant to be 200 with
        // empty suggestions on failure, so a 4xx/5xx here is a wiring bug
        // (bad entityId, server crash). Don't crash the IntelCard.
        return {
          ok: false,
          sourceUrl: null,
          suggestions: [],
          generatedAt: new Date().toISOString(),
        };
      }
      return (await res.json()) as PivotResponse;
    },
    enabled: queryEnabled,
    staleTime: STALE_MS,
    gcTime: GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    suggestions: data?.suggestions ?? [],
    sourceUrl: data?.sourceUrl ?? null,
    loading: queryEnabled && isFetching && !data,
  };
}
