/**
 * `aegis_pipeline_alerts` — the alert spine.
 *
 * Before this module the table had no production writer: every INSERT in the
 * repo lived in seed SQL, a test fixture, or a dev script, so `/feed/cyber-wire`,
 * the public RSS feed, and the X content generators were all reading four
 * hardcoded 2024 seed rows. The dashboard, meanwhile, ran on a separate
 * `alerts-store` whose only writer (a WS `('alerts','new')` message) nothing
 * ever broadcast.
 *
 * `processEvent()` in `src/lib/agent/activation.ts` now writes here on every
 * fired trigger, and `/api/data/alerts` reads back out — one table, one spine,
 * every surface (ALERTS panel, hero overlay, ticker, Cyber Wire, RSS, X, and the
 * agent's own context) fed from it.
 *
 * Timestamps are TEXT-typed columns migrated to timestamptz in migration 011;
 * every read casts back to text so API responses stay JSON-serializable (rule #1).
 */

import { query, queryOne } from '../client';

/** Status lifecycle: new → triaging → escalated → resolved / dismissed. */
export type PipelineAlertStatus = 'new' | 'triaging' | 'escalated' | 'resolved' | 'dismissed';

export interface PipelineAlertRow {
  id: number;
  alert_type: string;
  entity_kind: string;
  entity_id: string;
  severity: string;
  headline: string | null;
  summary: string | null;
  published_at: string;
  status: string;
  ai_relevance: string | null;
  created_at: string;
}

const SELECT_COLUMNS = `id, alert_type, entity_kind, entity_id, severity, headline, summary,
          published_at::text AS published_at, status, ai_relevance,
          created_at::text AS created_at`;

/**
 * How long the same entity is considered "already alerted". The client watchers
 * re-diff their feed on every poll, so a CERT advisory that shifts position in
 * the list looks new again minutes later. The 60s activation cooldown catches
 * the burst; this catches the slow drip that would otherwise stack the same
 * alert on the board three times in ten minutes.
 */
const DEDUP_WINDOW_HOURS = 24;

export interface InsertPipelineAlertResult {
  id: number;
  /** False when an existing row for this entity was reused instead. */
  created: boolean;
}

/**
 * Insert one alert, or reuse the recent row for the same entity. Returns null on
 * any failure — an alert write must never break the agent invocation that
 * produced it (same fail-soft contract as `recordXPost`).
 *
 * Deduped on `(alert_type, entity_kind, entity_id)` within DEDUP_WINDOW_HOURS.
 * The reused id is still returned so callers (notably the KEV → breaking-tweet
 * gate) always have a real `alert_id` to work with.
 *
 * `skipDedup` is for callers that already hold an authoritative uniqueness gate.
 * Watchlist matches are the case: `monitor_match_log` has
 * `UNIQUE (monitor_id, source, item_id)` and `recordMonitorMatch` returns true
 * only for a genuinely new hit, so this guard would add nothing — and would do
 * harm, since two different monitors hitting the same article share an
 * entity_id and must each get their own row.
 */
export async function insertPipelineAlert(params: {
  alertType: string;
  entityKind: string;
  entityId: string;
  severity: string;
  headline?: string | null;
  summary?: string | null;
  publishedAt?: string;
  aiRelevance?: number | null;
  skipDedup?: boolean;
}): Promise<InsertPipelineAlertResult | null> {
  try {
    if (!params.skipDedup) {
      const existing = await queryOne<{ id: number }>(
        `SELECT id FROM aegis_pipeline_alerts
          WHERE alert_type = $1 AND entity_kind = $2 AND entity_id = $3
            AND published_at::timestamptz > NOW() - ($4 || ' hours')::interval
          ORDER BY id DESC
          LIMIT 1`,
        [params.alertType, params.entityKind, params.entityId, String(DEDUP_WINDOW_HOURS)],
      );
      if (existing) return { id: existing.id, created: false };
    }

    const row = await queryOne<{ id: number }>(
      `INSERT INTO aegis_pipeline_alerts
         (alert_type, entity_kind, entity_id, severity, headline, summary, published_at, ai_relevance, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new')
       RETURNING id`,
      [
        params.alertType,
        params.entityKind,
        params.entityId,
        params.severity,
        params.headline ?? null,
        params.summary ?? null,
        params.publishedAt ?? new Date().toISOString(),
        params.aiRelevance ?? null,
      ],
    );
    return row ? { id: row.id, created: true } : null;
  } catch (err) {
    console.error('[pipeline-alerts] insert failed:', err);
    return null;
  }
}

/**
 * Enrich an existing alert once the agent has produced its BLUF. Only
 * non-undefined fields are written, so a failed agent run leaves the
 * client-supplied headline intact.
 */
export async function updatePipelineAlert(
  id: number,
  params: { headline?: string | null; summary?: string | null; aiRelevance?: number | null },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (params.headline !== undefined) {
    values.push(params.headline);
    sets.push(`headline = $${values.length}`);
  }
  if (params.summary !== undefined) {
    values.push(params.summary);
    sets.push(`summary = $${values.length}`);
  }
  if (params.aiRelevance !== undefined) {
    values.push(params.aiRelevance);
    sets.push(`ai_relevance = $${values.length}`);
  }
  if (sets.length === 0) return;

  values.push(id);
  try {
    await query(
      `UPDATE aegis_pipeline_alerts SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${values.length}`,
      values,
    );
  } catch (err) {
    console.error('[pipeline-alerts] update failed:', err);
  }
}

/**
 * The active board. Defaults to the operational statuses (`new` + `triaging`)
 * so resolved/dismissed items drop off the dashboard without being deleted.
 */
export async function listPipelineAlerts(params?: {
  statuses?: PipelineAlertStatus[];
  severities?: string[];
  sinceHours?: number;
  limit?: number;
}): Promise<PipelineAlertRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const statuses = params?.statuses ?? ['new', 'triaging', 'escalated'];
  values.push(statuses);
  conditions.push(`status = ANY($${values.length})`);

  if (params?.severities?.length) {
    values.push(params.severities);
    conditions.push(`severity = ANY($${values.length})`);
  }
  if (params?.sinceHours) {
    values.push(String(params.sinceHours));
    conditions.push(
      `published_at::timestamptz >= NOW() - ($${values.length} || ' hours')::interval`,
    );
  }

  values.push(params?.limit ?? 50);

  try {
    const result = await query<PipelineAlertRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM aegis_pipeline_alerts
        WHERE ${conditions.join(' AND ')}
        ORDER BY published_at DESC
        LIMIT $${values.length}`,
      values,
    );
    return result.rows;
  } catch (err) {
    console.error('[pipeline-alerts] list failed:', err);
    return [];
  }
}

/** Move an alert through the lifecycle, stamping the matching timestamp column. */
export async function setPipelineAlertStatus(
  id: number,
  status: PipelineAlertStatus,
): Promise<PipelineAlertRow | null> {
  const stampColumn =
    status === 'triaging'
      ? 'triaged_at'
      : status === 'escalated'
        ? 'escalated_at'
        : status === 'resolved' || status === 'dismissed'
          ? 'resolved_at'
          : null;

  const stamp = stampColumn ? `, ${stampColumn} = COALESCE(${stampColumn}, NOW())` : '';

  try {
    return await queryOne<PipelineAlertRow>(
      `UPDATE aegis_pipeline_alerts
          SET status = $2, updated_at = NOW()${stamp}
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [id, status],
    );
  } catch (err) {
    console.error('[pipeline-alerts] status update failed:', err);
    return null;
  }
}

/**
 * Age out alerts nobody triaged. An operational board should show what is
 * live; a `status='new'` row from two years ago is neither new nor actionable,
 * and while nothing aged rows out, the oldest seeded alert could sit at the top
 * of the severity ranking forever and own the hero banner.
 *
 * Resolved rather than deleted — the Cyber Wire archive, the RSS feed, and
 * `aegis_recent_alerts` can still reach them with an explicit status filter.
 */
export async function resolveStaleAlerts(olderThanDays = 14): Promise<number> {
  try {
    const { rows } = await query<{ id: number }>(
      `UPDATE aegis_pipeline_alerts
          SET status = 'resolved',
              resolved_at = COALESCE(resolved_at, NOW()),
              updated_at = NOW()
        WHERE status IN ('new', 'triaging')
          AND published_at::timestamptz < NOW() - ($1 || ' days')::interval
        RETURNING id`,
      [String(olderThanDays)],
    );
    return rows.length;
  } catch (err) {
    console.error('[pipeline-alerts] stale sweep failed:', err);
    return 0;
  }
}
