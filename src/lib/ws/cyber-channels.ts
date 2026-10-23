// ═══════════════════════════════════════════════
// THREAT DECK — Cyber WS channel → TanStack query-key mapping
// ═══════════════════════════════════════════════
//
// Phase 4.1 — the server broadcasts a lightweight `{ channel, type:'refresh' }`
// nudge on a cyber channel when new data is ingested (the Redis→broadcast
// publisher is Phase 4.2). The CLIENT reacts by invalidating the matching
// TanStack queries so they refetch authoritative data from the API. No row
// payloads cross the socket — this is a pure nudge → invalidate → refetch path.
//
// This module is the single source of truth for WHICH query keys each cyber
// channel maps to. The keys here are PREFIXES — TanStack Query v5
// `invalidateQueries({ queryKey })` does prefix matching by default, so
// invalidating `['cves']` matches every `useCveData` variant key like
// `['cves', severity, isKev, limit]`. Keys are mirrored from the cyber hooks
// in `src/lib/hooks/use-realtime-data.ts`.

import type { WSChannel } from './server';

/**
 * The cyber subset of {@link WSChannel}. Server + client `ALL_CHANNELS` both
 * spread this so the two channel lists can never drift.
 */
export const CYBER_CHANNELS = ['cves', 'kev', 'iocs', 'breaches', 'advisories'] as const;

export type CyberChannel = (typeof CYBER_CHANNELS)[number];

/**
 * Query-key prefixes (array of arrays) to invalidate for each cyber channel.
 *
 * A cyber channel can map to BOTH the `/api/data/*` feed-hook key and the
 * `/api/aegis/*` deep-intel-hook key, since a single ingest can refresh both
 * surfaces:
 *  - `cves`       → `useCveData` (['cves']) + `useAegisCves` (['aegis-cves'])
 *  - `kev`        → `useKevData` (['kev'])
 *  - `iocs`       → `useIocData` (['iocs'])
 *  - `breaches`   → `useBreachData` (['breaches']) + `useAegisIncidents` (['aegis-incidents'])
 *  - `advisories` → `useAdvisoryData` (['advisories']) + `usePatchData` (['patches'])
 */
const CYBER_CHANNEL_QUERY_KEYS: Record<CyberChannel, readonly (readonly string[])[]> = {
  cves: [['cves'], ['aegis-cves']],
  kev: [['kev']],
  iocs: [['iocs']],
  breaches: [['breaches'], ['aegis-incidents']],
  advisories: [['advisories'], ['patches']],
};

function isCyberChannel(channel: WSChannel | string): channel is CyberChannel {
  return (CYBER_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Pure mapping: given a WS channel, return the TanStack query-key prefixes to
 * invalidate. Returns `[]` for any non-cyber (or unknown) channel.
 */
export function cyberChannelToQueryKeys(channel: WSChannel | string): string[][] {
  if (!isCyberChannel(channel)) return [];
  // Clone to plain mutable string[][] so callers can pass entries straight to
  // `invalidateQueries({ queryKey })` without readonly-variance friction.
  return CYBER_CHANNEL_QUERY_KEYS[channel].map((key) => [...key]);
}
