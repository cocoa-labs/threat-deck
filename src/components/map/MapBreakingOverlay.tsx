'use client';

import { ExternalLink, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { alertTypeLabel } from '@/lib/aegis/alert-mapper';
import { useMapStore } from '@/lib/store/map-store';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/**
 * The hero's red flashing banner — the loudest surface in the product.
 *
 * It used to render the literal string "BREAKING ALERT" plus, at most, a place
 * name: no headline, no severity, no source, and nothing to click. The operator
 * had no way to learn what had just interrupted them. It now carries the whole
 * payload (see `BreakingAlertPayload`) and offers two explicit actions — open
 * the underlying record, or hand the alert to Max.
 *
 * Two sibling buttons rather than a clickable container, so no <button> ends up
 * nested inside another (rule #19).
 */
export function MapBreakingOverlay() {
  const breakingAlert = useMapStore((s) => s.breakingAlert);
  const clearBreakingAlert = useMapStore((s) => s.clearBreakingAlert);

  const { headline, severity, alertType, sourceUrl, timestamp, location, alertId } = breakingAlert;

  const askMax = () => {
    prefillAgent(`Brief me on this breaking alert: ${headline ?? 'unknown signal'}`, {
      sourcePanel: 'breakingAlert',
      dataType: alertType ?? 'alert',
      trendData: {
        alertId,
        headline,
        severity,
        alertType,
        // Rule #21 — Max must be able to cite the record it's briefing on.
        sourceUrl,
        location: location?.name,
      },
      timestamp,
    });
    clearBreakingAlert();
  };

  return (
    <AnimatePresence>
      {breakingAlert.active && (
        <>
          {/* Red flashing border */}
          <div
            className="pointer-events-none absolute inset-0 z-30 border-2 border-[var(--severity-critical)]"
            style={{
              animation: 'alert-flash 1s ease-in-out infinite',
            }}
          />

          {/* Breaking banner */}
          <motion.div
            initial={{ opacity: 0, y: -60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -60 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="absolute left-0 right-0 top-0 z-30 flex items-start justify-between gap-3 border-b border-[var(--severity-critical)]/40 bg-[var(--severity-critical)]/10 px-4 py-2 backdrop-blur-sm"
          >
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {/* Pulsing dot */}
              <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0">
                <span
                  className="absolute inline-flex h-full w-full rounded-full bg-[var(--severity-critical)] opacity-75"
                  style={{ animation: 'alert-pulse-ring 1.5s ease-in-out infinite' }}
                />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--severity-critical)]" />
              </span>

              <div className="min-w-0 flex-1">
                {/* Kicker row — what KIND of alert, how severe, where, how old */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[var(--severity-critical)]">
                    {alertTypeLabel(alertType)}
                  </span>
                  {severity && (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--severity-critical)]/70">
                      {severity}
                    </span>
                  )}
                  {location?.name && (
                    <span className="text-[10px] font-mono text-[var(--text-dim)]">
                      {location.name}
                    </span>
                  )}
                  {timestamp && (
                    <span className="text-[10px] font-mono text-[var(--text-dim)]">
                      {formatRelativeTime(timestamp)}
                    </span>
                  )}
                </div>

                {/* The thing the operator actually needs: what happened. */}
                {headline && (
                  <p className="mt-0.5 truncate text-[12px] font-mono text-[var(--text-primary)]">
                    {headline}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={askMax}
                className="rounded border border-[var(--crt-glow)]/40 px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--crt-glow)] transition-colors hover:bg-[var(--crt-glow)]/10"
              >
                Ask Max →
              </button>

              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--crt-glow)]/10 hover:text-[var(--crt-glow)]"
                  aria-label="Open alert source"
                  title="Open alert source"
                >
                  <ExternalLink size={12} />
                </a>
              )}

              <button
                type="button"
                onClick={clearBreakingAlert}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:bg-[var(--severity-critical)]/20 hover:text-[var(--severity-critical)]"
                aria-label="Dismiss alert"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
