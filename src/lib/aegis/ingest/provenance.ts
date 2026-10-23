import type { DataProvenance } from '@/lib/data/provenance';
import { queryOne } from '@/lib/db/client';

function utcTime(value: string | null): number | null {
  if (!value) return null;
  // Older ingestion records use UTC text without a timezone suffix.
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

/** A database poll is not a source refresh. Preserve successful acquisition time. */
export async function ingestProvenance(source: 'cves' | 'threat-actors'): Promise<DataProvenance> {
  const row = await queryOne<{
    last_success_at: string | null;
    last_error: string | null;
    last_cursor: string | null;
  }>('SELECT last_success_at, last_error, last_cursor FROM aegis_ingest_runs WHERE source = $1', [
    source,
  ]);
  const fetchedAt = utcTime(row?.last_success_at ?? null);
  const ttl = source === 'cves' ? 2 * 3600_000 : 26 * 3600_000;
  const coverage = source === 'cves' ? utcTime(row?.last_cursor ?? null) : fetchedAt;
  const expiresAt = fetchedAt === null ? null : Math.min(fetchedAt, coverage ?? fetchedAt) + ttl;
  return {
    fetchedAt,
    expiresAt,
    state:
      fetchedAt === null
        ? 'unavailable'
        : row?.last_error || (expiresAt !== null && Date.now() > expiresAt)
          ? 'stale'
          : 'live',
  };
}
