'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface Monitor {
  id: string;
  name: string;
  keywords: string[];
  color: string;
  severity: string;
  sources: string[];
  notify_on_match: boolean;
  enabled: boolean;
  created_at: string;
  /** Set by the scan cron each pass — proof the watchlist is being checked. */
  last_scanned_at: string | null;
  /** Lifetime hits from monitor_match_log. */
  match_count: number;
  last_match_at: string | null;
}

export interface CreateMonitorInput {
  name: string;
  keywords: string[];
  severity?: string;
  sources?: string[];
  notifyOnMatch?: boolean;
}

export interface UpdateMonitorInput {
  name?: string;
  keywords?: string[];
  severity?: string;
  sources?: string[];
  enabled?: boolean;
  notifyOnMatch?: boolean;
}

const KEY = ['monitors'] as const;

async function fetchMonitors(): Promise<Monitor[]> {
  const res = await fetch('/api/monitors');
  if (!res.ok) return [];
  const json = (await res.json()) as { monitors?: Monitor[] };
  return json.monitors ?? [];
}

export function useMonitors() {
  return useQuery({ queryKey: KEY, queryFn: fetchMonitors, staleTime: 30_000 });
}

/** One recorded hit from `monitor_match_log`. */
export interface MonitorMatch {
  id: string;
  monitorId: string;
  monitorName: string;
  source: string;
  itemId: string;
  matchedKeyword: string | null;
  itemTitle: string | null;
  itemUrl: string | null;
  firedAt: string;
}

/**
 * Recent hits for one monitor. `enabled` gates the fetch so the panel only
 * pays for the monitor the operator actually expanded — a deck with eight
 * watchlists shouldn't fire eight queries to render eight collapsed rows.
 */
export function useMonitorMatches(monitorId: string | null) {
  return useQuery({
    queryKey: ['monitor-matches', monitorId ?? ''],
    enabled: monitorId != null,
    queryFn: async (): Promise<MonitorMatch[]> => {
      const res = await fetch(`/api/monitors/${encodeURIComponent(monitorId ?? '')}/matches`);
      if (!res.ok) return [];
      const json = (await res.json()) as { matches?: MonitorMatch[] };
      return json.matches ?? [];
    },
    staleTime: 60_000,
  });
}

export function useCreateMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMonitorInput) => {
      const res = await fetch('/api/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('create_failed');
      return (await res.json()) as { monitor: Monitor };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateMonitorInput }) => {
      const res = await fetch(`/api/monitors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('update_failed');
      return (await res.json()) as { monitor: Monitor };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete_failed');
      return true;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
