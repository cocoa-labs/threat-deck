'use client';

import { Bell, Check, ExternalLink } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { alertTypeLabel } from '@/lib/aegis/alert-mapper';
import { useAlertsStore } from '@/lib/store/alerts-store';
import type { AlertHistoryItem, Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

const SEVERITY_DOT_CLASSES: Record<Severity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
  info: 'bg-gray-400',
};

function analyzeAlert(alert: AlertHistoryItem) {
  const title = alert.title ?? alert.summary ?? 'Alert triggered';
  prefillAgent(`Brief me on this alert: ${title}`, {
    sourcePanel: 'alerts',
    dataType: alert.alertType ?? 'alert',
    trendData: {
      title,
      summary: alert.summary,
      severity: alert.severity,
      createdAt: alert.createdAt,
      alertType: alert.alertType,
      entityKind: alert.entityKind,
      entityId: alert.entityId,
      // Rule #21 — the agent must be able to cite the underlying record.
      // prefillAgent mirrors url ↔ sourceUrl, so one key is enough.
      sourceUrl: alert.sourceUrl,
    },
    timestamp: alert.createdAt,
  });
}

/* ─── Alert Item ─── */

function AlertItem({
  alert,
  onAcknowledge,
}: {
  alert: AlertHistoryItem;
  onAcknowledge: (alert: AlertHistoryItem) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: nested acknowledge button prevents using <button>
    <div
      role="button"
      tabIndex={0}
      onClick={() => analyzeAlert(alert)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') analyzeAlert(alert);
      }}
      className={cn(
        'group flex items-start gap-2 py-1.5 px-1 rounded transition-colors cursor-pointer hover:bg-[var(--bg-hover)]',
        !alert.acknowledged && 'bg-[var(--bg-hover)]/50',
      )}
    >
      {/* Severity dot */}
      <div
        className={cn(
          'mt-[5px] h-2 w-2 shrink-0 rounded-full',
          SEVERITY_DOT_CLASSES[alert.severity] ?? 'bg-gray-400',
        )}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            'text-[var(--text-xs)] leading-tight line-clamp-2',
            alert.acknowledged ? 'text-[var(--text-dim)]' : 'text-[var(--text-primary)]',
          )}
        >
          {alert.title ?? alert.summary ?? 'Alert triggered'}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* Kicker — what KIND of alert this is. The single most useful
              disambiguator on the board: KEV ADDED vs BREACH vs PATCH. */}
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--crt-glow)]">
            {alertTypeLabel(alert.alertType)}
          </span>
          <span className="text-[9px] text-[var(--text-muted)]">&middot;</span>
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
            {alert.severity}
          </span>
          <span className="text-[9px] text-[var(--text-muted)]">&middot;</span>
          <span className="text-[9px] font-mono text-[var(--text-muted)] shrink-0">
            {formatRelativeTime(alert.createdAt)}
          </span>
          {alert.sourceUrl && (
            <a
              href={alert.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity shrink-0 text-[var(--text-dim)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crt-glow)] rounded"
              aria-label="Open alert source"
              title="Open alert source"
            >
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      {/* Acknowledge button */}
      {!alert.acknowledged && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAcknowledge(alert);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--color-positive)]/10 hover:text-[var(--color-positive)]"
          aria-label="Acknowledge alert"
        >
          <Check size={10} />
        </button>
      )}
    </div>
  );
}

/* ─── AlertsPanel ─── */

export function AlertsPanel() {
  const alerts = useAlertsStore((s) => s.alerts);
  const unacknowledgedCount = useAlertsStore((s) => s.unacknowledgedCount);
  const acknowledgeAlert = useAlertsStore((s) => s.acknowledgeAlert);

  const hasData = alerts.length > 0;

  /**
   * Optimistic acknowledge: flip the row immediately, then persist
   * `status = 'triaging'`. A failed write is non-fatal — the next poll of
   * /api/data/alerts re-hydrates the true status.
   */
  const handleAcknowledge = (alert: AlertHistoryItem) => {
    acknowledgeAlert(alert.id);
    void fetch(`/api/data/alerts/${encodeURIComponent(alert.id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'triaging' }),
    }).catch(() => {
      // Best-effort — the poll is the source of truth.
    });
  };

  return (
    <PanelShell id="alerts" title="ALERTS" span={1}>
      {/* Unacknowledged badge */}
      {unacknowledgedCount > 0 && (
        <div className="flex items-center gap-1.5 mb-2 -mt-1">
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-negative)] px-1 text-[8px] font-mono font-bold text-white tabular-nums">
            {unacknowledgedCount}
          </span>
          <span className="text-[9px] font-mono text-[var(--text-dim)]">unacknowledged</span>
        </div>
      )}

      {!hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <div className="flex flex-col items-center gap-1">
            <Bell size={16} className="text-[var(--text-muted)]" />
            <span className="text-[10px] font-mono text-[var(--text-muted)]">No alerts</span>
          </div>
        </div>
      ) : (
        <div className="space-y-0">
          {alerts.map((alert) => (
            <AlertItem key={alert.id} alert={alert} onAcknowledge={handleAcknowledge} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
