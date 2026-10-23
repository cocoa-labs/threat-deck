export type DataState = 'live' | 'delayed' | 'stale' | 'demo' | 'unavailable';
export interface DataProvenance {
  state: DataState;
  fetchedAt: number | null;
  expiresAt: number | null;
}

/** Source acquisition time, preserved through cache reads; never the browser poll time. */
export function stampProvenance<T>(data: T, fetchedAt: number, expiresAt: number): T {
  const stamp = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const record = item as Record<string, unknown>;
    if (!record._provenance)
      record._provenance = {
        state: record.isFallback || record._demo ? 'demo' : 'live',
        fetchedAt,
        expiresAt,
      };
  };
  if (Array.isArray(data)) data.forEach(stamp);
  else stamp(data);
  return data;
}

export function dataProvenance(data: unknown, now = Date.now()): DataProvenance {
  let demo = false,
    stale = false;
  const times: number[] = [],
    expiries: number[] = [];
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (!value || typeof value !== 'object' || depth > 8 || seen.size >= 10000 || seen.has(value))
      return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const row = value as Record<string, unknown>;
    if (
      row.isFallback === true ||
      row._demo === true ||
      (Array.isArray(row._demoKeys) && row._demoKeys.length)
    )
      demo = true;
    if (row.stale === true || row.degradedReason) stale = true;
    const p = row._provenance as DataProvenance | undefined;
    if (p) {
      if (p.state === 'demo') demo = true;
      if (p.state === 'stale' || p.state === 'unavailable') stale = true;
      if (typeof p.fetchedAt === 'number' && Number.isFinite(p.fetchedAt)) times.push(p.fetchedAt);
      if (typeof p.expiresAt === 'number' && Number.isFinite(p.expiresAt))
        expiries.push(p.expiresAt);
    }
    for (const [key, child] of Object.entries(row))
      if (key !== '_provenance' && key !== 'provenance') visit(child, depth + 1);
  }
  visit(data, 0);
  const fetchedAt = times.length ? Math.min(...times) : null;
  const expiresAt = expiries.length ? Math.min(...expiries) : null;
  return {
    state: demo
      ? 'demo'
      : fetchedAt === null
        ? 'unavailable'
        : stale || expiresAt === null || now > expiresAt
          ? 'stale'
          : 'live',
    fetchedAt,
    expiresAt,
  };
}
