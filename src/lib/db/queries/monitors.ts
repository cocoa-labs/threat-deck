import { query, queryOne } from '../client';

export interface MonitorRow {
  id: string;
  user_id: string | null;
  name: string;
  keywords: string[];
  color: string;
  severity: string;
  sources: string[];
  geo_lat: number | null;
  geo_lon: number | null;
  notify_on_match: boolean;
  map_pin: boolean;
  enabled: boolean;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listMonitors(userId: string): Promise<MonitorRow[]> {
  const { rows } = await query<MonitorRow>(
    'SELECT * FROM monitors WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows;
}

/** All enabled monitors across users — the scan cron's work-list. */
export async function getEnabledMonitors(): Promise<MonitorRow[]> {
  const { rows } = await query<MonitorRow>('SELECT * FROM monitors WHERE enabled = TRUE');
  return rows;
}

export interface MonitorWithStats extends MonitorRow {
  match_count: number;
  last_match_at: string | null;
}

/**
 * Monitors plus their hit stats. Without these the panel could only show the
 * rules, so there was no way to tell a watchlist that had never matched from
 * one the scan had never reached — and `monitor_match_log` stayed write-only.
 *
 * Served by `idx_monitor_match_monitor(monitor_id, fired_at DESC)` from
 * migration 019, which existed for a reader that was never written.
 */
export async function listMonitorsWithStats(userId: string): Promise<MonitorWithStats[]> {
  const { rows } = await query<MonitorWithStats>(
    `SELECT m.*,
            COALESCE(s.match_count, 0)::int AS match_count,
            s.last_match_at::text          AS last_match_at
       FROM monitors m
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS match_count, MAX(fired_at) AS last_match_at
           FROM monitor_match_log l
          WHERE l.monitor_id = m.id
       ) s ON TRUE
      WHERE m.user_id = $1
      ORDER BY m.created_at DESC`,
    [userId],
  );
  return rows;
}

export interface CreateMonitorParams {
  userId: string;
  name: string;
  keywords: string[];
  severity: string;
  sources: string[];
  color?: string;
  notifyOnMatch?: boolean;
}

export async function createMonitor(params: CreateMonitorParams): Promise<MonitorRow> {
  const row = await queryOne<MonitorRow>(
    `INSERT INTO monitors (user_id, name, keywords, severity, sources, color, notify_on_match)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, '#44ff88'), COALESCE($7, TRUE))
     RETURNING *`,
    [
      params.userId,
      params.name,
      params.keywords,
      params.severity,
      params.sources,
      params.color ?? null,
      params.notifyOnMatch ?? null,
    ],
  );
  // Non-null: a fresh INSERT ... RETURNING always yields a row.
  return row as MonitorRow;
}

export interface UpdateMonitorPatch {
  name?: string;
  keywords?: string[];
  severity?: string;
  sources?: string[];
  enabled?: boolean;
  notifyOnMatch?: boolean;
  color?: string;
}

/** Owner-scoped update (COALESCE keeps unspecified fields). Returns null if the
 *  monitor doesn't exist OR isn't owned by userId. */
export async function updateMonitor(
  id: string,
  userId: string,
  patch: UpdateMonitorPatch,
): Promise<MonitorRow | null> {
  return queryOne<MonitorRow>(
    `UPDATE monitors SET
       name = COALESCE($3, name),
       keywords = COALESCE($4, keywords),
       severity = COALESCE($5, severity),
       sources = COALESCE($6, sources),
       enabled = COALESCE($7, enabled),
       notify_on_match = COALESCE($8, notify_on_match),
       color = COALESCE($9, color),
       updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [
      id,
      userId,
      patch.name ?? null,
      patch.keywords ?? null,
      patch.severity ?? null,
      patch.sources ?? null,
      patch.enabled ?? null,
      patch.notifyOnMatch ?? null,
      patch.color ?? null,
    ],
  );
}

export async function deleteMonitor(id: string, userId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    'DELETE FROM monitors WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId],
  );
  return row != null;
}

export async function touchMonitorScanned(id: string): Promise<void> {
  await query('UPDATE monitors SET last_scanned_at = NOW() WHERE id = $1', [id]);
}

/**
 * Atomically record a match. Returns true only when this (monitor, source, item)
 * is NEW (ON CONFLICT DO NOTHING) — the caller alerts only on a true return.
 */
export async function recordMonitorMatch(params: {
  monitorId: string;
  source: string;
  itemId: string;
  matchedKeyword?: string;
  itemTitle?: string;
  itemUrl?: string;
}): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO monitor_match_log (monitor_id, source, item_id, matched_keyword, item_title, item_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (monitor_id, source, item_id) DO NOTHING
     RETURNING id`,
    [
      params.monitorId,
      params.source,
      params.itemId,
      params.matchedKeyword ?? null,
      params.itemTitle ?? null,
      params.itemUrl ?? null,
    ],
  );
  return row != null;
}

export interface MonitorMatchRow {
  id: string;
  monitor_id: string;
  monitor_name: string;
  source: string;
  item_id: string;
  matched_keyword: string | null;
  item_title: string | null;
  item_url: string | null;
  fired_at: string;
}

/**
 * Recent hits for one monitor, OWNER-SCOPED.
 *
 * `userId` is not optional: this is per-operator data and the join to
 * `monitors` is what enforces that. The previous signature took only a
 * monitorId — safe while it had zero callers, but it is now reachable from an
 * HTTP route and an agent tool, where an unscoped read would let any operator
 * enumerate another's watchlist activity by guessing a UUID.
 *
 * Served by `idx_monitor_match_monitor(monitor_id, fired_at DESC)` (migration 019).
 */
export async function recentMonitorMatches(
  monitorId: string,
  userId: string,
  limit = 20,
): Promise<MonitorMatchRow[]> {
  const { rows } = await query<MonitorMatchRow>(
    `SELECT l.id, l.monitor_id, m.name AS monitor_name, l.source, l.item_id,
            l.matched_keyword, l.item_title, l.item_url, l.fired_at::text AS fired_at
       FROM monitor_match_log l
       JOIN monitors m ON m.id = l.monitor_id
      WHERE l.monitor_id = $1 AND m.user_id = $2
      ORDER BY l.fired_at DESC
      LIMIT $3`,
    [monitorId, userId, limit],
  );
  return rows;
}

/**
 * Recent hits across ALL of an operator's monitors — what the agent needs to
 * answer "what has my watchlist caught?" without being handed a monitor id.
 */
export async function recentMatchesForOperator(
  userId: string,
  limit = 20,
): Promise<MonitorMatchRow[]> {
  const { rows } = await query<MonitorMatchRow>(
    `SELECT l.id, l.monitor_id, m.name AS monitor_name, l.source, l.item_id,
            l.matched_keyword, l.item_title, l.item_url, l.fired_at::text AS fired_at
       FROM monitor_match_log l
       JOIN monitors m ON m.id = l.monitor_id
      WHERE m.user_id = $1
      ORDER BY l.fired_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/**
 * Drop match history past the retention window. The scan writes a row per
 * (monitor, source, item) forever otherwise — one scan of one broad monitor
 * produced 37 rows, and it runs every 5 minutes.
 *
 * Deleting is safe: anything that mattered also became an `aegis_pipeline_alerts`
 * row, which the Cyber Wire and RSS keep independently. This table is the
 * per-monitor history, not the system of record.
 */
export async function pruneMonitorMatches(olderThanDays = 90): Promise<number> {
  try {
    const { rows } = await query<{ id: string }>(
      `DELETE FROM monitor_match_log
        WHERE fired_at < NOW() - ($1 || ' days')::interval
        RETURNING id`,
      [String(olderThanDays)],
    );
    return rows.length;
  } catch (err) {
    console.error('[monitors] match-log prune failed:', err);
    return 0;
  }
}
