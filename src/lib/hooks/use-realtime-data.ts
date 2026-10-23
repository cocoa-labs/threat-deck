'use client';

import { useQuery } from '@tanstack/react-query';
import { useAlertsStore } from '@/lib/store/alerts-store';
import { useConnectionStore } from '@/lib/store/connection-store';
import { useDataStore } from '@/lib/store/data-store';
import type { AlertHistoryItem } from '@/lib/types';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

interface NewsDataResponse {
  requestedCategory?: string;
  category?: string;
  items: unknown[];
  count?: number;
  degradedReason?: 'rate_limited' | 'empty_fetch';
}

export function useMarketData() {
  const setIndices = useDataStore((s) => s.setIndices);
  const setSectors = useDataStore((s) => s.setSectors);
  const setCommodities = useDataStore((s) => s.setCommodities);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['markets'],
    queryFn: async () => {
      const data = await fetchJSON<{
        indices: unknown[];
        sectors: unknown[];
        commodities: unknown[];
      }>('/api/data/markets');

      setIndices(data.indices as ReturnType<typeof useDataStore.getState>['indices']);
      setSectors(data.sectors as ReturnType<typeof useDataStore.getState>['sectors']);
      setCommodities(data.commodities as ReturnType<typeof useDataStore.getState>['commodities']);
      return data;
    },
    refetchInterval: wsConnected ? 300_000 : 60_000,
    staleTime: 30_000,
  });
}

export function useNewsData(category: string) {
  const setNews = useDataStore((s) => s.setNews);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['news', category],
    queryFn: async () => {
      const data = await fetchJSON<NewsDataResponse>(`/api/data/news?category=${category}`);
      if (data.items.length > 0) {
        const storeCategory = data.category ?? category;
        setNews(
          storeCategory,
          data.items as ReturnType<typeof useDataStore.getState>['news'][string],
        );
      }
      return data;
    },
    refetchInterval: wsConnected ? 1_500_000 : 300_000,
    staleTime: 120_000,
  });
}

/**
 * Fetches the cyber + AI news categories into the store on a breaking-news
 * cadence. These categories carry per-item `aiRelevance` scores and are what
 * the autonomous AI+cyber news alert (use-activation-events) watches. Nothing
 * else on the dashboard populates `news['cyber']` / `news['ai']`, so this hook
 * is the data source for that alert — mount it wherever the alert is mounted.
 */
export function useCyberAiNewsData() {
  const setNews = useDataStore((s) => s.setNews);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['news', 'cyber-ai-alert'],
    queryFn: async () => {
      const [cyber, ai] = await Promise.all([
        fetchJSON<NewsDataResponse>('/api/data/news?category=cyber'),
        fetchJSON<NewsDataResponse>('/api/data/news?category=ai'),
      ]);
      if (cyber.items.length > 0) {
        setNews('cyber', cyber.items as ReturnType<typeof useDataStore.getState>['news'][string]);
      }
      if (ai.items.length > 0) {
        setNews('ai', ai.items as ReturnType<typeof useDataStore.getState>['news'][string]);
      }
      return { cyber, ai };
    },
    refetchInterval: wsConnected ? 300_000 : 120_000,
    staleTime: 120_000,
  });
}

export function useCryptoData() {
  const setCrypto = useDataStore((s) => s.setCrypto);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['crypto'],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>('/api/data/crypto');
      setCrypto(data.data as ReturnType<typeof useDataStore.getState>['crypto']);
      return data;
    },
    refetchInterval: wsConnected ? 300_000 : 60_000,
    staleTime: 30_000,
  });
}

export function useCongressData() {
  const setCongressTrades = useDataStore((s) => s.setCongressTrades);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['congress'],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>('/api/data/congress');
      setCongressTrades(data.data as ReturnType<typeof useDataStore.getState>['congressTrades']);
      return data;
    },
    refetchInterval: wsConnected ? 1_500_000 : 300_000,
    staleTime: 120_000,
  });
}

export function useWhaleData() {
  const setWhaleTransactions = useDataStore((s) => s.setWhaleTransactions);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['whales'],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>('/api/data/whales');
      setWhaleTransactions(
        data.data as ReturnType<typeof useDataStore.getState>['whaleTransactions'],
      );
      return data;
    },
    refetchInterval: wsConnected ? 1_500_000 : 300_000,
    staleTime: 120_000,
  });
}

export function usePredictionData() {
  const setPredictionMarkets = useDataStore((s) => s.setPredictionMarkets);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['polymarket'],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>('/api/data/polymarket');
      setPredictionMarkets(
        data.data as ReturnType<typeof useDataStore.getState>['predictionMarkets'],
      );
      return data;
    },
    refetchInterval: wsConnected ? 1_500_000 : 300_000,
    staleTime: 120_000,
  });
}

export function useFedData() {
  const setFedData = useDataStore((s) => s.setFedData);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['fed'],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown }>('/api/data/fed');
      setFedData(data.data as NonNullable<ReturnType<typeof useDataStore.getState>['fedData']>);
      return data;
    },
    refetchInterval: wsConnected ? 18_000_000 : 3_600_000,
    staleTime: 1_800_000,
  });
}

export function useFedCalendarData() {
  const setFedCalendar = useDataStore((s) => s.setFedCalendar);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['fed-calendar'],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>('/api/data/fed-calendar');
      setFedCalendar(data.data as ReturnType<typeof useDataStore.getState>['fedCalendar']);
      return data;
    },
    refetchInterval: wsConnected ? 21_600_000 : 3_600_000,
    staleTime: 1_800_000,
  });
}

export function useEarningsData() {
  const setEarnings = useDataStore((s) => s.setEarnings);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['earnings'],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>('/api/data/earnings');
      setEarnings(data.data as ReturnType<typeof useDataStore.getState>['earnings']);
      return data;
    },
    refetchInterval: wsConnected ? 9_000_000 : 1_800_000,
    staleTime: 900_000,
  });
}

export function useTwitterData(
  tab: 'accounts' | 'search',
  query?: string,
  filter?: 'markets' | 'geopolitics' | 'policy' | 'crypto' | 'ai' | 'infosec',
) {
  const setTweets = useDataStore((s) => s.setTweets);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams({ tab });
  if (query) params.set('query', query);
  if (filter) params.set('filter', filter);

  return useQuery({
    queryKey: ['twitter', tab, query ?? '', filter ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/data/twitter?${params.toString()}`);
      if (tab === 'accounts') {
        setTweets(data.data as ReturnType<typeof useDataStore.getState>['tweets']);
      }
      return data;
    },
    enabled: tab === 'accounts' || (tab === 'search' && !!query),
    refetchInterval: wsConnected ? 120_000 : 60_000,
    staleTime: 30_000,
  });
}

export function useLivestreamData() {
  return useQuery({
    queryKey: ['livestream-resolve'],
    queryFn: async () => {
      const data = await fetchJSON<{
        data: Record<
          string,
          {
            id: string;
            videoId: string | null;
            isLive: boolean;
            title?: string;
            thumbnailUrl?: string;
          }
        >;
      }>('/api/data/livestream/resolve');
      return data;
    },
    refetchInterval: 21_600_000, // 6 hours
    staleTime: 3_600_000, // 1 hour
  });
}

export function useGovernmentData() {
  const setGovernmentContracts = useDataStore((s) => s.setGovernmentContracts);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  return useQuery({
    queryKey: ['government'],
    queryFn: async () => {
      const data = await fetchJSON<{ results: unknown[] }>('/api/data/government');
      setGovernmentContracts(
        data.results as ReturnType<typeof useDataStore.getState>['governmentContracts'],
      );
      return data;
    },
    refetchInterval: wsConnected ? 9_000_000 : 1_800_000,
    staleTime: 900_000,
  });
}

// ─── AEGIS / cyber hooks ────────────────────────────────────────────────

export function useCveData(opts?: { severity?: string; isKev?: boolean; limit?: number }) {
  const setCves = useDataStore((s) => s.setCves);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.severity) params.set('severity', opts.severity);
  if (opts?.isKev !== undefined) params.set('is_kev', String(opts.isKev));
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['cves', opts?.severity ?? '', opts?.isKev ?? '', opts?.limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/data/cves${qs ? `?${qs}` : ''}`);
      setCves(data.data as ReturnType<typeof useDataStore.getState>['cves']);
      return data;
    },
    // Phase 4.3 — WS push nudges (Phase 4.1) invalidate this query on new data,
    // but push is best-effort: if the socket lags or drops, the slow poll is
    // the only thing keeping cyber data current. Cap the wsConnected branch at
    // a 5-min floor so freshness is guaranteed even with push enabled. The
    // non-WS (push-down) interval is left unchanged.
    refetchInterval: wsConnected ? Math.min(600_000, 300_000) : 120_000,
    staleTime: 60_000,
  });
}

export function useKevData(limit?: number) {
  const setKev = useDataStore((s) => s.setKev);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['kev', limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/data/kev${qs ? `?${qs}` : ''}`);
      setKev(data.data as ReturnType<typeof useDataStore.getState>['kev']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(1_800_000, 300_000) : 600_000,
    staleTime: 300_000,
  });
}

export function useIocData(opts?: { source?: string; iocType?: string; limit?: number }) {
  const setIocs = useDataStore((s) => s.setIocs);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.source) params.set('source', opts.source);
  if (opts?.iocType) params.set('ioc_type', opts.iocType);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['iocs', opts?.source ?? '', opts?.iocType ?? '', opts?.limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/data/iocs${qs ? `?${qs}` : ''}`);
      setIocs(data.data as ReturnType<typeof useDataStore.getState>['iocs']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(1_800_000, 300_000) : 600_000,
    staleTime: 300_000,
  });
}

export function useBreachData(opts?: { industry?: string; country?: string; limit?: number }) {
  const setBreaches = useDataStore((s) => s.setBreaches);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.industry) params.set('industry', opts.industry);
  if (opts?.country) params.set('country', opts.country);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['breaches', opts?.industry ?? '', opts?.country ?? '', opts?.limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/data/breaches${qs ? `?${qs}` : ''}`);
      setBreaches(data.data as ReturnType<typeof useDataStore.getState>['breaches']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(1_800_000, 300_000) : 600_000,
    staleTime: 300_000,
  });
}

/**
 * CERT / national-body advisories → the `advisories` store slice.
 *
 * `issuer` is deliberately NOT an option. This hook is the sole writer of a
 * CERT-only slice, so being able to point it at `issuer=vendor` would be a
 * footgun that reintroduces exactly the bug this split removed: two hooks
 * writing one slice wholesale, thrashing between disjoint payloads. Vendor
 * patches have their own hook and their own slice — see `usePatchData`.
 */
export function useAdvisoryData(opts?: { severity?: string; limit?: number }) {
  const setAdvisories = useDataStore((s) => s.setAdvisories);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams({ issuer: 'cert' });
  if (opts?.severity) params.set('severity', opts.severity);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['advisories', 'cert', opts?.severity ?? '', opts?.limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/data/advisories?${qs}`);
      setAdvisories(data.data as ReturnType<typeof useDataStore.getState>['advisories']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(1_800_000, 300_000) : 600_000,
    staleTime: 300_000,
  });
}

export function useThreatActorData(opts?: {
  actorType?: string;
  country?: string;
  limit?: number;
}) {
  const setThreatActors = useDataStore((s) => s.setThreatActors);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.actorType) params.set('actor_type', opts.actorType);
  if (opts?.country) params.set('country', opts.country);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['threat-actors', opts?.actorType ?? '', opts?.country ?? '', opts?.limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(
        `/api/data/threat-actors${qs ? `?${qs}` : ''}`,
      );
      setThreatActors(data.data as ReturnType<typeof useDataStore.getState>['threatActors']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(3_600_000, 300_000) : 1_800_000,
    staleTime: 600_000,
  });
}

// ─── AEGIS deep-intel hooks (DB-backed) ─────────────────────────────────
// These hit the /api/aegis/* routes that read from the AEGIS DB views.
// They are distinct from the Phase 2 feed hooks above which hit /api/data/*
// collector-backed routes. AEGIS panels use these; cyber feed panels use
// the Phase 2 hooks.

export function useAegisCves(opts?: {
  severity?: string;
  isKev?: boolean;
  exploited?: boolean;
  search?: string;
  limit?: number;
}) {
  const setCves = useDataStore((s) => s.setCves);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.severity) params.set('severity', opts.severity);
  if (opts?.isKev !== undefined) params.set('is_kev', String(opts.isKev));
  if (opts?.exploited !== undefined) params.set('exploited_in_wild', String(opts.exploited));
  if (opts?.search) params.set('search', opts.search);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: [
      'aegis-cves',
      opts?.severity ?? '',
      opts?.isKev ?? '',
      opts?.exploited ?? '',
      opts?.search ?? '',
      opts?.limit ?? '',
    ],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/aegis/cves${qs ? `?${qs}` : ''}`);
      setCves(data.data as ReturnType<typeof useDataStore.getState>['cves']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(600_000, 300_000) : 120_000,
    staleTime: 60_000,
  });
}

export function useAegisThreatActors(opts?: {
  actorType?: string;
  minScore?: number;
  country?: string;
  limit?: number;
}) {
  const setThreatActors = useDataStore((s) => s.setThreatActors);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.actorType) params.set('actor_type', opts.actorType);
  if (opts?.minScore != null) params.set('min_score', String(opts.minScore));
  if (opts?.country) params.set('country', opts.country);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: [
      'aegis-threat-actors',
      opts?.actorType ?? '',
      opts?.minScore ?? '',
      opts?.country ?? '',
      opts?.limit ?? '',
    ],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(
        `/api/aegis/threat-actors${qs ? `?${qs}` : ''}`,
      );
      setThreatActors(data.data as ReturnType<typeof useDataStore.getState>['threatActors']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(1_800_000, 300_000) : 600_000,
    staleTime: 300_000,
  });
}

export function useAegisIncidents(opts?: {
  industry?: string;
  country?: string;
  incidentType?: string;
  since?: string;
  limit?: number;
}) {
  const setIncidents = useDataStore((s) => s.setIncidents);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.industry) params.set('industry', opts.industry);
  if (opts?.country) params.set('country', opts.country);
  if (opts?.incidentType) params.set('incident_type', opts.incidentType);
  if (opts?.since) params.set('since', opts.since);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: [
      'aegis-incidents',
      opts?.industry ?? '',
      opts?.country ?? '',
      opts?.incidentType ?? '',
      opts?.since ?? '',
      opts?.limit ?? '',
    ],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(
        `/api/aegis/incidents${qs ? `?${qs}` : ''}`,
      );
      setIncidents(data.data as ReturnType<typeof useDataStore.getState>['incidents']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(1_800_000, 300_000) : 600_000,
    staleTime: 300_000,
  });
}

export interface AegisRiskSimulationInput {
  industry?: string;
  revenue: number; // millions USD
  headcount?: number;
  grade?: 'A' | 'B' | 'C' | 'D';
  runs?: number;
  horizon?: number;
  seed?: number;
}

export function useAegisRiskSimulation(input: AegisRiskSimulationInput | null) {
  const setRiskSimulation = useDataStore((s) => s.setRiskSimulation);

  const params = new URLSearchParams();
  if (input) {
    if (input.industry) params.set('industry', input.industry);
    params.set('revenue', String(input.revenue));
    if (input.headcount != null) params.set('headcount', String(input.headcount));
    if (input.grade) params.set('grade', input.grade);
    if (input.runs != null) params.set('runs', String(input.runs));
    if (input.horizon != null) params.set('horizon', String(input.horizon));
    if (input.seed != null) params.set('seed', String(input.seed));
  }
  const qs = params.toString();

  return useQuery({
    queryKey: [
      'aegis-risk-simulation',
      input?.industry ?? '',
      input?.revenue ?? '',
      input?.headcount ?? '',
      input?.grade ?? '',
      input?.runs ?? '',
      input?.horizon ?? '',
      input?.seed ?? '',
    ],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown }>(`/api/aegis/risk-simulation?${qs}`);
      setRiskSimulation(
        data.data as NonNullable<ReturnType<typeof useDataStore.getState>['riskSimulation']>,
      );
      return data;
    },
    enabled: input !== null && input.revenue > 0,
    refetchInterval: false, // manual trigger only
    staleTime: Number.POSITIVE_INFINITY,
  });
}

// ─── Patch tracker hook (vendor-filterable wrapper over /api/data/patches) ──
// Vendor security updates → the `patches` store slice. PatchTrackerPanel uses
// this for the vendor-tab UX (Microsoft / Apple / Ubuntu / RedHat / Chrome /
// Mozilla).
//
// This wrote `setAdvisories` until the slice split — the same slice
// `useAdvisoryData` writes, on the same 5-min cadence, with both hooks mounted
// at once. Last-writer-wins meant the PATCH TRACKER regularly rendered CERT
// advisories under its vendor tabs.

export function usePatchData(opts?: { vendor?: string; limit?: number }) {
  const setPatches = useDataStore((s) => s.setPatches);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.vendor) params.set('vendor', opts.vendor);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['patches', opts?.vendor ?? '', opts?.limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: unknown[] }>(`/api/data/patches${qs ? `?${qs}` : ''}`);
      setPatches(data.data as ReturnType<typeof useDataStore.getState>['patches']);
      return data;
    },
    // Phase 4.3 — 5-min floor: push nudges are best-effort; poll guarantees freshness.
    refetchInterval: wsConnected ? Math.min(1_800_000, 300_000) : 600_000,
    staleTime: 300_000,
  });
}

// ─── Alerts (the AEGIS alert spine) ─────────────────────────────────────────
// Reads `aegis_pipeline_alerts` via /api/data/alerts and hydrates the client
// alerts-store. This is the store's first read path: its only previous writer
// was a WS `('alerts','new')` message that nothing broadcast, so the ALERTS
// panel, the alert ticker row, and the session delta were all permanently
// empty. Activation now both writes the row and pushes over WS; this poll is
// the guarantee behind that best-effort push (rule #10).

export function useAlertsData(opts?: { limit?: number }) {
  const setAlerts = useAlertsStore((s) => s.setAlerts);
  const wsConnected = useConnectionStore((s) => s.wsConnected);

  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: ['alerts', opts?.limit ?? ''],
    queryFn: async () => {
      const data = await fetchJSON<{ data: AlertHistoryItem[] }>(
        `/api/data/alerts${qs ? `?${qs}` : ''}`,
      );
      setAlerts(data.data);
      return data;
    },
    // Alerts are the interrupt channel — poll harder than the catalog feeds.
    refetchInterval: wsConnected ? 120_000 : 45_000,
    staleTime: 30_000,
  });
}
