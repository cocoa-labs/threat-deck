export type Freshness = 'live' | 'delayed' | 'stale' | 'demo' | 'unavailable';

/** Classify data age. ageMs <= liveMs → live; <= staleMs → delayed; else stale. */
export function freshnessFromAge(
  ageMs: number,
  opts: { liveMs: number; staleMs: number },
): Exclude<Freshness, 'demo'> {
  if (ageMs <= opts.liveMs) return 'live';
  if (ageMs <= opts.staleMs) return 'delayed';
  return 'stale';
}

/**
 * Honest panel freshness: degraded/demo signals win over the time-based class.
 *
 * A panel showing hardcoded fallback data (`demo`) or serving stale cache
 * because its source is degraded (`degraded`) must say so, even when the last
 * fetch *timestamp* is recent — a fresh fetch of fallback data is still
 * fallback data. Precedence: demo → stale → time-based.
 *
 * Returns `undefined` when there is no usable age yet (`null`/negative), which
 * PanelShell renders as "no telltale".
 */
export function resolvePanelFreshness(opts: {
  demo?: boolean;
  degraded?: boolean;
  ageMs?: number | null;
  liveMs: number;
  staleMs: number;
}): Freshness | undefined {
  if (opts.demo) return 'demo';
  if (opts.degraded) return 'stale';
  if (opts.ageMs == null || opts.ageMs < 0) return undefined;
  return freshnessFromAge(opts.ageMs, { liveMs: opts.liveMs, staleMs: opts.staleMs });
}
