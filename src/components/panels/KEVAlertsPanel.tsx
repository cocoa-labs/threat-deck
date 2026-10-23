'use client';

import { useMemo } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useFreshness } from '@/lib/hooks/use-freshness';
import { useKevData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { KEV } from '@/lib/types';
import { prefillAgent } from '@/lib/utils/panel-actions';
import styles from './KEVAlertsPanel.module.css';

// KEV catalog updates infrequently — live within 30m, stale past 3h.
const FRESHNESS = { liveMs: 30 * 60_000, staleMs: 3 * 60 * 60_000 };

/**
 * KEVAlertsPanel — Phase 4.5C signature panel (overrides the worker baseline).
 *
 * NORAD countdown wall. Three columns per row: VT323 countdown (color-coded
 * by urgency), vendor/product + vulnerability name, severity + glowing
 * ransomware-use badge. Top counter strip throbs red on overdue.
 *
 * The panel feels alive and angry when something is past due — and quietly
 * confident (Matrix-green status line) when everything is clear.
 */
export function KEVAlertsPanel() {
  const { isLoading, dataUpdatedAt } = useKevData(50);
  const kev = useDataStore((s) => s.kev);

  const freshness = useFreshness(dataUpdatedAt, FRESHNESS);

  // Deadline-ASC: overdue first, then closest deadlines, then no-deadline last.
  const sorted = useMemo(() => {
    const copy = [...kev];
    copy.sort((a, b) => {
      const aTs = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const bTs = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      return aTs - bTs;
    });
    return copy;
  }, [kev]);

  const overdueCount = useMemo(
    () =>
      sorted.filter((entry) => {
        const ms = msUntil(entry.dueDate);
        return ms !== null && ms < 0;
      }).length,
    [sorted],
  );

  const hasData = sorted.length > 0;

  return (
    <PanelShell
      id="kevAlerts"
      title="KEV ALERTS"
      span={1}
      lastUpdated={dataUpdatedAt > 0 ? dataUpdatedAt : null}
      freshness={freshness}
    >
      <div className={styles.shell}>
        {/* Counter strip */}
        <div className={styles.counterStrip}>
          <div className={styles.counterCell}>
            <span className={styles.counterLabel}>Active</span>
            <span className={styles.counterValue}>{sorted.length.toString().padStart(2, '0')}</span>
          </div>
          <div className={`${styles.counterCell} ${styles.counterCellRight}`}>
            <span className={styles.counterLabel}>Overdue</span>
            <span
              className={`${styles.counterValue} ${overdueCount > 0 ? styles.counterValueOverdue : ''}`}
            >
              {overdueCount.toString().padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* List or states */}
        {isLoading && !hasData ? (
          <div className={styles.list}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={`shimmer-${i}`} className={styles.shimmerRow}>
                <div className={styles.shimmerBlock} />
                <div className={styles.shimmerBlock} />
                <div className={styles.shimmerBlock} />
              </div>
            ))}
          </div>
        ) : !hasData ? (
          <div className={styles.empty}>
            <span className={styles.emptyMark}>{'// AEGIS //'}</span>
            <span className={styles.emptyText}>No active KEV exposure</span>
          </div>
        ) : (
          <div className={styles.list}>
            {sorted.map((entry) => (
              <KevRow key={entry.cveId} kev={entry} />
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}

/* ─── Row ─── */

function KevRow({ kev }: { kev: KEV }) {
  const ms = msUntil(kev.dueDate);
  const days = ms === null ? null : Math.floor(ms / 86_400_000);
  const hours =
    ms === null ? null : Math.floor((Math.abs(ms) - Math.abs(days ?? 0) * 86_400_000) / 3_600_000);

  const countdownText = formatCountdown(days, hours);
  const countdownLabel = formatDeadlineLabel(days);
  const countdownClass = countdownColorClass(days);

  const isRansomware = Boolean(kev.knownRansomwareUse?.trim() === 'Known');
  const isRansomwareUnknown = Boolean(
    kev.knownRansomwareUse?.trim() && kev.knownRansomwareUse.trim() !== 'Known',
  );
  const vendorProduct = [kev.vendorProject, kev.product].filter(Boolean).join(' · ');
  const vulnName = kev.vulnerabilityName ?? kev.shortDescription ?? 'Known exploited vulnerability';

  return (
    <button
      type="button"
      className={styles.row}
      onClick={() =>
        prefillAgent(
          `Brief me on this KEV: ${vulnName}. CVE: ${kev.cveId}. Vendor: ${vendorProduct || 'N/A'}. ${kev.shortDescription ?? ''} Required action: ${kev.requiredAction ?? 'N/A'}.`,
          {
            sourcePanel: 'kevAlerts',
            dataType: 'kev',
            trendData: {
              cveId: kev.cveId,
              vulnerabilityName: kev.vulnerabilityName,
              vendorProject: kev.vendorProject,
              product: kev.product,
              dueDate: kev.dueDate,
              addedToKevAt: kev.addedToKevAt,
              shortDescription: kev.shortDescription,
              requiredAction: kev.requiredAction,
              knownRansomwareUse: kev.knownRansomwareUse,
              url: `/api/aegis/kev/view?id=${kev.cveId}`,
            },
          },
        )
      }
    >
      <div>
        <div className={`${styles.countdown} ${countdownClass}`}>{countdownText}</div>
        <div className={styles.countdownLabel}>{countdownLabel}</div>
      </div>

      <div className={styles.middleCol}>
        {vendorProduct ? (
          <div className={styles.vendorLine}>
            {vendorProduct}
            <span className={styles.cveTag}>{kev.cveId}</span>
          </div>
        ) : (
          <div className={styles.vendorLine}>{kev.cveId}</div>
        )}
        <div className={styles.vulnLine}>{vulnName}</div>
      </div>

      <div className={styles.rightCol}>
        <span className={`${styles.severityChip} ${styles.severityCritical}`}>KEV</span>
        {isRansomware ? <span className={styles.ransomBadge}>Ransomware</span> : null}
        {isRansomwareUnknown ? (
          <span className={`${styles.severityChip} ${styles.severityHigh}`}>Ransom &nbsp;?</span>
        ) : null}
      </div>
    </button>
  );
}

/* ─── Helpers ─── */

function msUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return null;
  return d - Date.now();
}

/** Format the big VT323 countdown line: "T-04D 11H" / "OVERDUE 03D" / "—". */
function formatCountdown(days: number | null, hours: number | null): string {
  if (days === null || hours === null) return '—';
  if (days < 0) {
    return `OVERDUE ${Math.abs(days).toString().padStart(2, '0')}D`;
  }
  return `T-${days.toString().padStart(2, '0')}D ${hours.toString().padStart(2, '0')}H`;
}

/** Mono caps subtitle under the countdown — short, contextual. */
function formatDeadlineLabel(days: number | null): string {
  if (days === null) return 'no deadline';
  if (days < 0) return 'past due';
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days <= 7) return 'this week';
  if (days <= 30) return 'this month';
  return 'on schedule';
}

function countdownColorClass(days: number | null): string {
  if (days === null) return styles.countdownNone ?? '';
  if (days < 0) return styles.countdownOverdue ?? '';
  if (days <= 7) return styles.countdownUrgent ?? '';
  if (days <= 30) return styles.countdownSoon ?? '';
  return styles.countdownComfortable ?? '';
}
