'use client';

/**
 * Phase 10.3 — IntelCard inline pivot chips.
 *
 * Pure presentational. Renders 0–3 pivot chips between the IntelCard body
 * and the action-hint footer. Loading state = 3 skeleton chips. Empty
 * array = render nothing (caller already gates on `suggestions.length`).
 *
 * Each chip is a click target that pre-fills the AgentDrawer per rule #17.
 * The chip wrapper sets `pointerEvents: 'auto'` so clicks register —
 * IntelCard's root pointer policy is otherwise pass-through to keep hover
 * cycles on the underlying lens nodes alive.
 */

import type { PivotSuggestion } from '@/lib/aegis/pivot-templates';
import { prefillAgent } from '@/lib/utils/panel-actions';

interface IntelCardPivotsProps {
  /** Pivot list from /api/aegis/pivot-suggestions. Empty = render nothing. */
  pivots: PivotSuggestion[];
  /** True while the route is in-flight on first load — shows 3 skeleton chips. */
  loading: boolean;
  /** Source panel string for prefillAgent telemetry. */
  sourcePanel?: string;
  /**
   * Extra trendData to forward into prefillAgent so the AgentDrawer can render
   * its sidebar with entity context (per rule #17). Pivot-specific keys
   * (`pivotLabel`, `pivotSource`) are appended automatically.
   */
  pivotContext?: Record<string, unknown>;
}

const HAIRLINE = 'rgba(255, 255, 255, 0.05)';

export function IntelCardPivots({
  pivots,
  loading,
  sourcePanel = 'intelcard-pivot',
  pivotContext,
}: IntelCardPivotsProps): React.JSX.Element | null {
  // First-load skeleton state — keep the slot reserved so the card height
  // doesn't jump when pivots arrive.
  if (loading && pivots.length === 0) {
    return (
      <>
        <div style={{ height: 1, background: HAIRLINE }} />
        <div style={{ padding: '8px 14px 8px' }}>
          <PivotsHeader loading />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <SkeletonChip width={150} />
            <SkeletonChip width={120} />
            <SkeletonChip width={170} />
          </div>
        </div>
      </>
    );
  }

  // Empty result → render NOTHING (no hairline, no header). Card looks
  // identical to pre-Phase-10 for entities with no pivot context.
  if (pivots.length === 0) return null;

  return (
    <>
      <div style={{ height: 1, background: HAIRLINE }} />
      <div
        style={{
          padding: '8px 14px 8px',
          // Chip wrapper opts back IN to pointer events so clicks register.
          // Card root is `pointerEvents: 'auto'` already (hover-sink), but
          // we set explicit here for defense in depth.
          pointerEvents: 'auto',
        }}
      >
        <PivotsHeader loading={loading} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {pivots.map((p) => (
            <PivotChip
              key={`${p.source}:${p.rank}:${p.label}`}
              pivot={p}
              sourcePanel={sourcePanel}
              pivotContext={pivotContext}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PivotsHeader({ loading }: { loading: boolean }): React.JSX.Element {
  return (
    <div
      style={{
        fontSize: 9,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--text-muted, rgba(255,255,255,0.42))',
        marginBottom: 5,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span>Next pivots</span>
      {loading && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--crt-glow, #00ff41)',
            opacity: 0.5,
            animation: 'intelcard-pulse 1.2s ease-in-out infinite',
          }}
        />
      )}
    </div>
  );
}

function PivotChip({
  pivot,
  sourcePanel,
  pivotContext,
}: {
  pivot: PivotSuggestion;
  sourcePanel: string;
  pivotContext?: Record<string, unknown>;
}): React.JSX.Element {
  const isHaiku = pivot.source === 'haiku';
  const borderColor = isHaiku
    ? 'rgba(var(--crt-glow-rgb), 0.45)'
    : 'rgba(var(--crt-glow-rgb), 0.20)';
  const bg = isHaiku ? 'rgba(var(--crt-glow-rgb), 0.10)' : 'rgba(var(--crt-glow-rgb), 0.04)';

  function onActivate(event: React.MouseEvent | React.KeyboardEvent) {
    event.stopPropagation();
    // Per rule #17 — every prefillAgent call carries panel context + trendData.
    prefillAgent(pivot.prefillPrompt, {
      sourcePanel,
      dataType: 'pivot',
      trendData: {
        ...(pivotContext ?? {}),
        pivotLabel: pivot.label,
        pivotSource: pivot.source,
        pivotRank: pivot.rank,
      },
    });
  }

  return (
    <button
      type="button"
      onClick={onActivate}
      onMouseDown={(e) => e.stopPropagation()}
      title={pivot.prefillPrompt}
      style={{
        fontFamily: "'Geist Mono', ui-monospace, monospace",
        fontSize: 10,
        lineHeight: 1.2,
        letterSpacing: '0.02em',
        color: 'var(--crt-glow, #00ff41)',
        background: bg,
        border: `1px solid ${borderColor}`,
        padding: '3px 8px',
        cursor: 'pointer',
        textAlign: 'left',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {pivot.label}
    </button>
  );
}

function SkeletonChip({ width }: { width: number }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height: 18,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        animation: 'intelcard-pulse 1.2s ease-in-out infinite',
      }}
    />
  );
}
