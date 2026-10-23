import { feedResponse } from '@/lib/data/feed-response';
/**
 * The dashboard's read window onto `aegis_pipeline_alerts` — the alert spine.
 *
 * Before this route the table was server-side only (Cyber Wire page, RSS feed,
 * X content generators). The dashboard ran on a separate in-memory store that
 * nothing ever wrote, so the ALERTS panel was a permanent empty state.
 *
 * Every row comes back with a `sourceUrl` (rule #21) and, when it resolves, a
 * `location` — the gate the hero breaking-alert overlay reads.
 */

import { resolveAlertGeo } from '@/lib/aegis/alert-geo';
import { toAlertHistoryItem } from '@/lib/aegis/alert-mapper';
import { listPipelineAlerts, type PipelineAlertStatus } from '@/lib/db/queries/pipeline-alerts';

const VALID_STATUSES: PipelineAlertStatus[] = [
  'new',
  'triaging',
  'escalated',
  'resolved',
  'dismissed',
];

/**
 * Default look-back for the board. Without a window a seeded 2024 row sat at
 * `status='new'` forever and the dashboard treated it as current — the board
 * should reflect the last week of activity, not the whole table.
 */
const DEFAULT_WINDOW_HOURS = 168;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200);

  // Read the RAW param: `Number(null)` is 0, not NaN, so a `Number()`-first
  // check can never tell "absent" from "explicitly zero" and the default would
  // silently never apply.
  const rawSince = searchParams.get('since_hours');
  const parsedSince = rawSince === null ? Number.NaN : Number(rawSince);
  // `since_hours=0` explicitly means "no window" — for the archive view.
  const sinceHours =
    rawSince === null || !Number.isFinite(parsedSince)
      ? DEFAULT_WINDOW_HOURS
      : parsedSince > 0
        ? parsedSince
        : undefined;

  const statusParam = searchParams.get('status');
  const statuses = statusParam
    ? (statusParam
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is PipelineAlertStatus =>
          VALID_STATUSES.includes(s as PipelineAlertStatus),
        ) as PipelineAlertStatus[])
    : undefined;

  try {
    const rows = await listPipelineAlerts({
      statuses: statuses?.length ? statuses : undefined,
      sinceHours,
      limit,
    });

    const geo = await resolveAlertGeo(rows);
    const data = rows.map((row) => toAlertHistoryItem(row, geo.get(String(row.id))));

    return feedResponse({
      data,
      count: data.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return feedResponse(
      { error: err instanceof Error ? err.message : 'Failed to fetch alerts' },
      { status: 500 },
    );
  }
}
