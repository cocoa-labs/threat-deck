'use client';

/**
 * Three-mode posture UI for the AgentDrawer.
 *
 * `ModePillRow` — interactive lock/detect pill row at the top of the drawer.
 * `ModeBadge` — small per-message chip next to each assistant timestamp,
 *   showing which mode that specific response was rendered in.
 *
 * Four visual states per pill:
 *   - **Locked**: this pill's mode matches `lockedMode`. Matrix-green border
 *     + glow + lock icon `⌗` prefix. `aria-pressed=true`.
 *   - **Detected (passive)**: this pill's mode matches `detectedMode` while
 *     `lockedMode` is null. Subtle green underline. Read-only indicator.
 *   - **Escalated**: `lockedMode` is set AND `detectedMode !== lockedMode`
 *     (the last response auto-escalated above the lock floor). Locked pill
 *     keeps its lock visual; the escalated-detected pill gets a small `↑`
 *     chevron prefix + green underline.
 *   - **Inert**: none of the above. Dim white.
 *
 * Click behavior:
 *   - Click an inert pill → `onLockToggle(<that mode>)` (lock to it).
 *   - Click the currently-locked pill → `onLockToggle(null)` (unlock to AUTO).
 *   - Click a different locked pill → `onLockToggle(<new mode>)` (switch lock).
 *
 * The faint `AUTO` label adjacent to the row shows only while `lockedMode === null`,
 * so the user has an explicit cue that the row is in passive-detection mode.
 */

import { type AgentMode, isEscalation } from '@/lib/agent/mode-config';

interface ModePillRowProps {
  lockedMode: AgentMode | null;
  detectedMode: AgentMode;
  onLockToggle: (mode: AgentMode | null) => void;
}

interface ModeDescriptor {
  id: AgentMode;
  label: string;
  tooltip: string;
}

const MODES: readonly ModeDescriptor[] = [
  {
    id: 'anchor',
    label: 'Anchor',
    tooltip:
      'News-anchor brief. BLUF + 1–2 sentences + source. Click to lock here; click the locked pill again to unlock (AUTO); click a different pill to switch the lock.',
  },
  {
    id: 'analyst',
    label: 'Analyst',
    tooltip:
      'Senior technical analyst SITREP. Multi-tool deep dive. Click to lock here; click the locked pill again to unlock (AUTO); click a different pill to switch the lock.',
  },
  {
    id: 'fix-architect',
    label: 'Fix Architect',
    tooltip:
      'Remediation playbook with concrete artifacts (patches, Sigma/YARA, D3FEND). Click to lock here; click the locked pill again to unlock (AUTO); click a different pill to switch the lock.',
  },
] as const;

export function ModePillRow({ lockedMode, detectedMode, onLockToggle }: ModePillRowProps) {
  const isUnlocked = lockedMode === null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: posture pill row is a presentational toggle group, not a form fieldset
    <div
      className="relative z-[2] flex shrink-0 items-center justify-center gap-1 px-4 py-2 text-[10px]"
      role="group"
      aria-label="Max posture mode"
    >
      {isUnlocked ? (
        <span
          className="mr-2 font-mono uppercase tracking-wider"
          style={{ color: 'rgba(255, 255, 255, 0.32)' }}
          aria-hidden="true"
        >
          AUTO
        </span>
      ) : null}

      {MODES.map((mode, i) => {
        const isLocked = lockedMode === mode.id;
        const isDetectedPassive = isUnlocked && detectedMode === mode.id;
        // Phase 14.5 (code-review fix #13) — `isEscalation` requires
        // `detectedMode` LEVEL to be strictly above `lockedMode` LEVEL.
        // A stale or cross-stream-polluted `detectedMode` BELOW the lock
        // floor would otherwise render a misleading ↑ chevron — see
        // mode-config.ts isEscalation for the hierarchy semantics.
        const isEscalated =
          !isUnlocked &&
          !isLocked &&
          detectedMode === mode.id &&
          isEscalation(lockedMode, detectedMode);

        // Style mapping per state.
        const color = isLocked
          ? 'var(--matrix-green, #00ff41)'
          : isDetectedPassive || isEscalated
            ? 'rgba(0, 255, 65, 0.7)'
            : 'rgba(255, 255, 255, 0.32)';
        const border = isLocked
          ? '1px solid var(--matrix-green, #00ff41)'
          : '1px solid transparent';
        const background = isLocked ? 'rgba(0, 255, 65, 0.06)' : 'transparent';
        const boxShadow = isLocked ? '0 0 6px rgba(0, 255, 65, 0.2)' : 'none';
        const textDecorationLine = isDetectedPassive || isEscalated ? 'underline' : 'none';

        const handleClick = () => {
          onLockToggle(isLocked ? null : mode.id);
        };

        return (
          <span key={mode.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleClick}
              aria-pressed={isLocked}
              title={mode.tooltip}
              className="font-mono uppercase tracking-wider transition-colors duration-150"
              style={{
                color,
                border,
                background,
                boxShadow,
                textDecorationLine,
                textDecorationThickness: '1px',
                textUnderlineOffset: '3px',
                padding: '2px 8px',
                cursor: 'pointer',
              }}
            >
              {isLocked ? (
                <span aria-hidden="true" style={{ marginRight: 4, opacity: 0.7 }}>
                  ⌗
                </span>
              ) : null}
              {isEscalated ? (
                <span aria-hidden="true" style={{ marginRight: 4 }}>
                  ↑
                </span>
              ) : null}
              {mode.label}
            </button>
            {i < MODES.length - 1 ? (
              <span aria-hidden="true" style={{ color: 'rgba(255, 255, 255, 0.18)' }}>
                ·
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Per-message mode chip rendered next to the assistant timestamp in the
 * AgentDrawer transcript. Color-keyed: anchor = neutral, analyst = matrix
 * green, fix-architect = cocoa brown. Renders nothing for messages with no
 * `agentMode` field (pre-Phase-14 persisted messages).
 */
export function ModeBadge({ mode }: { mode: AgentMode | undefined }) {
  if (!mode) return null;
  const color =
    mode === 'analyst'
      ? 'var(--matrix-green, #00ff41)'
      : mode === 'fix-architect'
        ? 'var(--cocoa-brown, #6b4423)'
        : 'var(--text-dim, rgba(255,255,255,0.4))';
  const label = mode === 'fix-architect' ? 'FIX ARCH' : mode.toUpperCase();
  return (
    <span
      className="text-[7px] font-mono uppercase tracking-wider opacity-80"
      style={{ color }}
      title={`Response rendered in ${mode} mode`}
    >
      {label}
    </span>
  );
}
