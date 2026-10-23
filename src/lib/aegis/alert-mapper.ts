/**
 * `aegis_pipeline_alerts` row → the client `AlertHistoryItem` shape.
 *
 * One mapper so the WS push (`broadcast('alerts','new')` from the activation
 * writer) and the REST read (`GET /api/data/alerts`) can never drift — they feed
 * the same store, and a shape mismatch there would silently corrupt the ALERTS
 * board.
 *
 * Everything returned is JSON-serializable (rule #1): no Date, no numeric id.
 */

import type { PipelineAlertRow } from '@/lib/db/queries/pipeline-alerts';
import type { AlertEntityKind, AlertHistoryItem, AlertStatus, Severity } from '@/lib/types';
import { deriveSourceUrl } from './source-url';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

function toSeverity(value: string | null | undefined): Severity {
  const v = (value ?? '').toLowerCase();
  return (SEVERITIES.find((s) => s === v) ?? 'info') as Severity;
}

/**
 * Human label for an alert type. Rendered as the kicker so the operator can
 * tell a KEV addition from a breach at a glance — the single most common
 * "what does this alert mean?" question.
 */
export const ALERT_TYPE_LABELS: Record<string, string> = {
  new_kev: 'KEV ADDED',
  new_cve: 'NEW CVE',
  new_breach: 'BREACH',
  new_patch: 'PATCH',
  new_ioc: 'IOC',
  advisory: 'ADVISORY',
  monitor_match: 'WATCHLIST',
};

export function alertTypeLabel(alertType: string | null | undefined): string {
  if (!alertType) return 'ALERT';
  return ALERT_TYPE_LABELS[alertType] ?? alertType.replace(/_/g, ' ').toUpperCase();
}

export function toAlertHistoryItem(
  row: PipelineAlertRow,
  location?: { lat: number; lon: number; name?: string } | null,
): AlertHistoryItem {
  const aiRelevance = row.ai_relevance == null ? null : Number(row.ai_relevance);
  return {
    id: String(row.id),
    severity: toSeverity(row.severity),
    title: row.headline ?? undefined,
    summary: row.summary ?? undefined,
    triggerData: null,
    // The ALERTS board treats anything past `new` as handled, so existing
    // consumers (session-delta, ticker, panel badge) need no change.
    acknowledged: row.status !== 'new',
    createdAt: row.published_at,
    alertType: row.alert_type,
    entityKind: row.entity_kind as AlertEntityKind,
    entityId: row.entity_id,
    sourceUrl: deriveSourceUrl(row.entity_kind, row.entity_id, { relative: true }),
    status: row.status as AlertStatus,
    aiRelevance: Number.isFinite(aiRelevance as number) ? aiRelevance : null,
    location: location ?? null,
  };
}
