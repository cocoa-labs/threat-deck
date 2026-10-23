'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAgentStore } from '@/lib/store/agent-store';
import type { MapBaseStyle } from '@/lib/store/map-store';
import { useMapStore } from '@/lib/store/map-store';
import type { BreakingAlertThreshold } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

interface Props {
  open: boolean;
  onClose: () => void;
}

const MAP_STYLES: { id: MapBaseStyle; label: string }[] = [
  { id: 'satellite', label: 'Satellite' },
  { id: 'dark', label: 'Dark' },
  { id: 'terrain', label: 'Outdoors' },
  { id: 'standard', label: '3D' },
];

const BREAKING_THRESHOLDS: { id: BreakingAlertThreshold; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Never raise the hero overlay.' },
  {
    id: 'critical',
    label: 'Critical',
    hint: 'KEV additions and critical breaches only — the default.',
  },
  {
    id: 'critical_high',
    label: 'Crit + High',
    hint: 'Also high-severity breaches and vendor patches.',
  },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors',
        checked ? 'bg-[var(--color-info)]' : 'bg-[var(--bg-hover)]',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

export function SettingsDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewMode = useMapStore((s) => s.viewMode);
  const mapOverlaysVisible = useMapStore((s) => s.mapOverlaysVisible);
  const toggleMapOverlays = useMapStore((s) => s.toggleMapOverlays);
  const baseStyle = useMapStore((s) => s.baseStyle);
  const setBaseStyle = useMapStore((s) => s.setBaseStyle);
  const showCoordinateReadout = useMapStore((s) => s.showCoordinateReadout);
  const toggleCoordinateReadout = useMapStore((s) => s.toggleCoordinateReadout);
  const autonomousAlertsEnabled = useAgentStore((s) => s.autonomousAlertsEnabled);
  const toggleAutonomousAlerts = useAgentStore((s) => s.toggleAutonomousAlerts);
  const breakingAlertThreshold = useAgentStore((s) => s.breakingAlertThreshold);
  const setBreakingAlertThreshold = useAgentStore((s) => s.setBreakingAlertThreshold);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 'var(--z-dialog, 50)' }}
    >
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop dismiss pattern */}
      <div role="presentation" className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Settings"
        tabIndex={-1}
        className="relative w-[380px] max-h-[80vh] overflow-y-auto rounded-lg border border-[var(--color-info)]/30 bg-[var(--bg-surface)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--color-info)]">
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* Map Style */}
          {viewMode === 'map' && (
            <section>
              <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                Map Style
              </h3>
              <div className="flex gap-2">
                {MAP_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setBaseStyle(style.id)}
                    className={cn(
                      'flex-1 rounded border px-3 py-1.5 font-mono text-xs transition-colors',
                      baseStyle === style.id
                        ? 'border-[var(--color-info)] bg-[var(--color-info)]/10 text-[var(--color-info)]'
                        : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]',
                    )}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Display */}
          <section>
            <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Display
            </h3>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between py-1">
                <span className="font-mono text-xs text-[var(--text-secondary)]">
                  Coordinate Readout
                </span>
                <Toggle checked={showCoordinateReadout} onChange={toggleCoordinateReadout} />
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="font-mono text-xs text-[var(--text-secondary)]">
                  Zoom Indicator
                </span>
                <Toggle checked={mapOverlaysVisible} onChange={toggleMapOverlays} />
              </div>
            </div>
          </section>

          {/* Alerts */}
          <section>
            <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Alerts
            </h3>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between py-1">
                <span className="font-mono text-xs text-[var(--text-secondary)]">Agent Alerts</span>
                <Toggle checked={autonomousAlertsEnabled} onChange={toggleAutonomousAlerts} />
              </div>
            </div>

            <p className="mt-3 mb-1.5 font-mono text-[10px] text-[var(--text-muted)]">
              Breaking overlay — the red flash over the hero. Everything below this bar still lands
              on the ALERTS panel.
            </p>
            <div className="flex gap-2">
              {BREAKING_THRESHOLDS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setBreakingAlertThreshold(option.id)}
                  title={option.hint}
                  className={cn(
                    'flex-1 rounded border px-2 py-1.5 font-mono text-[11px] transition-colors',
                    breakingAlertThreshold === option.id
                      ? 'border-[var(--severity-critical)] bg-[var(--severity-critical)]/10 text-[var(--severity-critical)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
