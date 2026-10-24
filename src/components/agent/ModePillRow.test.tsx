/**
 * Tests for the three-mode posture pill row in the AgentDrawer.
 *
 * Renders the component standalone (no store wiring) and verifies the four
 * visual states (locked / detected-passive / escalated / inert) plus click
 * behavior:
 *   - Click an inert pill → onLockToggle(mode) with that mode
 *   - Click the currently-locked pill → onLockToggle(null) (unlock to AUTO)
 *   - The AUTO label is visible only when lockedMode is null
 */

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModePillRow } from './ModePillRow';

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(props: ComponentProps<typeof ModePillRow>): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ModePillRow {...props} />);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  if (container?.parentNode) {
    container.parentNode.removeChild(container);
    container = null;
  }
});

function buttonByText(c: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(c.querySelectorAll('button')).find((el) =>
    el.textContent?.toUpperCase().includes(text.toUpperCase()),
  );
  if (!(btn instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${text}`);
  }
  return btn;
}

describe('ModePillRow', () => {
  it('switches detected, locked and escalated modes without conflicting style updates', () => {
    const consoleError = vi.spyOn(console, 'error');
    const onLockToggle = vi.fn();
    try {
      const c = render({ lockedMode: null, detectedMode: 'anchor', onLockToggle });
      const states: Array<Pick<ComponentProps<typeof ModePillRow>, 'lockedMode' | 'detectedMode'>> =
        [
          { lockedMode: 'anchor', detectedMode: 'anchor' },
          { lockedMode: 'anchor', detectedMode: 'analyst' },
          { lockedMode: 'analyst', detectedMode: 'analyst' },
          { lockedMode: null, detectedMode: 'fix-architect' },
          { lockedMode: 'fix-architect', detectedMode: 'fix-architect' },
          { lockedMode: null, detectedMode: 'anchor' },
        ];
      for (const state of states) {
        act(() => root?.render(<ModePillRow {...state} onLockToggle={onLockToggle} />));
      }
      expect(buttonByText(c, 'Anchor').style.textDecorationLine).toBe('underline');
      expect(buttonByText(c, 'Anchor').style.textDecorationThickness).toBe('1px');
      expect(
        consoleError.mock.calls.filter((args) => String(args[0]).includes('conflicting')),
      ).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  describe('unlocked (AUTO) state', () => {
    it('shows the AUTO label when lockedMode is null', () => {
      const c = render({
        lockedMode: null,
        detectedMode: 'anchor',
        onLockToggle: vi.fn(),
      });
      expect(c.textContent).toContain('AUTO');
    });

    it('does NOT show the AUTO label when a mode is locked', () => {
      const c = render({
        lockedMode: 'analyst',
        detectedMode: 'analyst',
        onLockToggle: vi.fn(),
      });
      expect(c.textContent).not.toContain('AUTO');
    });

    it('marks no pill as aria-pressed when unlocked', () => {
      const c = render({
        lockedMode: null,
        detectedMode: 'anchor',
        onLockToggle: vi.fn(),
      });
      const pressed = Array.from(c.querySelectorAll('button[aria-pressed="true"]'));
      expect(pressed.length).toBe(0);
    });
  });

  describe('locked state', () => {
    it('marks the locked pill as aria-pressed=true', () => {
      const c = render({
        lockedMode: 'analyst',
        detectedMode: 'analyst',
        onLockToggle: vi.fn(),
      });
      const analyst = buttonByText(c, 'Analyst');
      expect(analyst.getAttribute('aria-pressed')).toBe('true');
    });

    it('does not mark other pills as aria-pressed=true', () => {
      const c = render({
        lockedMode: 'analyst',
        detectedMode: 'analyst',
        onLockToggle: vi.fn(),
      });
      const anchor = buttonByText(c, 'Anchor');
      const fa = buttonByText(c, 'Fix Architect');
      expect(anchor.getAttribute('aria-pressed')).toBe('false');
      expect(fa.getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('click handling', () => {
    it('clicking an inert pill calls onLockToggle with that mode', () => {
      const onLockToggle = vi.fn();
      const c = render({
        lockedMode: null,
        detectedMode: 'anchor',
        onLockToggle,
      });
      act(() => {
        buttonByText(c, 'Analyst').click();
      });
      expect(onLockToggle).toHaveBeenCalledWith('analyst');
    });

    it('clicking the locked pill calls onLockToggle(null) (unlock to AUTO)', () => {
      const onLockToggle = vi.fn();
      const c = render({
        lockedMode: 'analyst',
        detectedMode: 'analyst',
        onLockToggle,
      });
      act(() => {
        buttonByText(c, 'Analyst').click();
      });
      expect(onLockToggle).toHaveBeenCalledWith(null);
    });

    it('clicking a different mode while locked switches the lock', () => {
      const onLockToggle = vi.fn();
      const c = render({
        lockedMode: 'analyst',
        detectedMode: 'analyst',
        onLockToggle,
      });
      act(() => {
        buttonByText(c, 'Fix Architect').click();
      });
      expect(onLockToggle).toHaveBeenCalledWith('fix-architect');
    });
  });

  describe('escalation indicator', () => {
    it('when locked anchor but detected analyst, the analyst pill carries an escalation cue', () => {
      // Render with lockedMode=anchor and detectedMode=analyst — the user
      // locked to ANCHOR but the last response auto-escalated to ANALYST.
      const c = render({
        lockedMode: 'anchor',
        detectedMode: 'analyst',
        onLockToggle: vi.fn(),
      });
      // The escalation cue is a visible "↑" chevron prefix on the
      // escalated-detected pill.
      const analyst = buttonByText(c, 'Analyst');
      expect(analyst.textContent).toContain('↑');
    });

    it('does NOT render an escalation cue when locked mode matches detected mode', () => {
      const c = render({
        lockedMode: 'analyst',
        detectedMode: 'analyst',
        onLockToggle: vi.fn(),
      });
      const analyst = buttonByText(c, 'Analyst');
      expect(analyst.textContent).not.toContain('↑');
    });

    it('does NOT render an escalation cue in pure AUTO (unlocked) mode', () => {
      const c = render({
        lockedMode: null,
        detectedMode: 'fix-architect',
        onLockToggle: vi.fn(),
      });
      const fa = buttonByText(c, 'Fix Architect');
      expect(fa.textContent).not.toContain('↑');
    });

    // Phase 14.5 (code-review fix #13) — hierarchy guard against down-grade
    it('does NOT render the ↑ chevron on a DOWN-graded detected mode', () => {
      // Locked Fix Architect with a stale / polluted detectedMode of Anchor:
      // the anchor pill matches `detectedMode === mode.id` but is BELOW
      // the lock floor, so it must not signal upward escalation.
      const c = render({
        lockedMode: 'fix-architect',
        detectedMode: 'anchor',
        onLockToggle: vi.fn(),
      });
      const anchor = buttonByText(c, 'Anchor');
      expect(anchor.textContent).not.toContain('↑');
    });

    it('does NOT render the ↑ chevron on an Analyst pill when locked Fix Architect detects Analyst (down-grade)', () => {
      const c = render({
        lockedMode: 'fix-architect',
        detectedMode: 'analyst',
        onLockToggle: vi.fn(),
      });
      const analyst = buttonByText(c, 'Analyst');
      expect(analyst.textContent).not.toContain('↑');
    });
  });

  describe('accessibility', () => {
    it('the row is grouped under a labeled role for screen readers', () => {
      const c = render({
        lockedMode: null,
        detectedMode: 'anchor',
        onLockToggle: vi.fn(),
      });
      const group = c.querySelector('[role="group"]');
      expect(group).not.toBeNull();
      expect(group?.getAttribute('aria-label')).toBeTruthy();
    });
  });
});
