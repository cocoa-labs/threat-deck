'use client';

import { useMemo } from 'react';
import styles from './login.module.css';

export type TickerItem = {
  id: string;
  /** Display time in HH:MM */
  time: string;
  /** Tag chip text — short, e.g. CVE-2024-XXX or BREACH or KEV */
  tag: string;
  /** Severity drives dot color */
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** One-line headline (will be truncated with ellipsis) */
  text: string;
};

/**
 * AmbientTicker — slow vertical scroll of live cyber events.
 *
 * Eavesdropping on a live SIGINT feed while you wait for authorization.
 * Track is duplicated so the scroll loops seamlessly without a visible seam.
 * Pauses on hover so the user can actually read a line they spot.
 */
export function AmbientTicker({ items }: { items: TickerItem[] }) {
  // Duplicate the list so the -50% transform loop is visually continuous.
  const doubled = useMemo(() => [...items, ...items], [items]);

  if (items.length === 0) {
    return (
      <section className={styles.tickerSection}>
        <div className={styles.tickerLabel}>Live SIGINT feed</div>
        <div className={styles.tickerViewport}>
          <div className={styles.tickerEmpty}>{'// awaiting feed sync //'}</div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.tickerSection} aria-label="Live cyber intelligence feed">
      <div className={styles.tickerLabel}>Live SIGINT feed</div>
      <div className={styles.tickerViewport}>
        <div className={styles.tickerTrack}>
          {doubled.map((item, i) => (
            <div
              // index suffix so React keys stay unique across the duplication
              key={`${item.id}-${i}`}
              className={styles.tickerRow}
            >
              <span
                className={`${styles.tickerDot} ${severityClass(item.severity)}`}
                aria-hidden="true"
              />
              <span className={styles.tickerTime}>{item.time}</span>
              <span className={styles.tickerTag}>{item.tag}</span>
              <span className={styles.tickerText}>{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function severityClass(sev: TickerItem['severity']): string {
  switch (sev) {
    case 'critical':
      return styles.tickerDotCritical ?? '';
    case 'high':
      return styles.tickerDotHigh ?? '';
    case 'medium':
      return styles.tickerDotMedium ?? '';
    default:
      return styles.tickerDotLow ?? '';
  }
}
