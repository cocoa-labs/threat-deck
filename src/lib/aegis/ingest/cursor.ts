/**
 * Cursor helpers for the `aegis_ingest_runs` table (Phase 1, Task 1.3).
 *
 * Per-source bookkeeping for the recurring AEGIS ingestion loop:
 *   - `getCursor(source)` — the last delta cursor (e.g. NVD `lastModStartDate`),
 *     or `null` for a source we've never run.
 *   - `recordRun(source, {...})` — upserts the per-source run record.
 *     `last_success_at` only advances on `ok`; `last_cursor` is preserved
 *     (COALESCE) when a run passes `cursor: undefined`.
 *
 * Timestamps are stored as `YYYY-MM-DD HH:MM:SS` text to match the table's
 * `updated_at` default (`to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`).
 */

import { query, queryOne } from '@/lib/db/client';

const NOW_TEXT = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export async function getCursor(source: string): Promise<string | null> {
  const row = await queryOne<{ last_cursor: string | null }>(
    `SELECT last_cursor FROM aegis_ingest_runs WHERE source = $1`,
    [source],
  );
  return row?.last_cursor ?? null;
}

export async function recordRun(
  source: string,
  opts: { cursor?: string | null; count: number; ok: boolean; error?: string | null },
): Promise<void> {
  const now = NOW_TEXT();
  await query(
    `INSERT INTO aegis_ingest_runs (source, last_cursor, last_run_at, last_success_at, last_count, last_error, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $3)
     ON CONFLICT (source) DO UPDATE
       SET last_cursor     = COALESCE(EXCLUDED.last_cursor, aegis_ingest_runs.last_cursor),
           last_run_at     = EXCLUDED.last_run_at,
           last_success_at = CASE WHEN $7 THEN EXCLUDED.last_run_at ELSE aegis_ingest_runs.last_success_at END,
           last_count      = EXCLUDED.last_count,
           last_error      = EXCLUDED.last_error,
           updated_at      = EXCLUDED.last_run_at`,
    [
      source,
      opts.cursor ?? null,
      now,
      opts.ok ? now : null,
      opts.count,
      opts.error ?? null,
      opts.ok,
    ],
  );
}
