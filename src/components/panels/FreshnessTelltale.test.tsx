/**
 * Render tests for <FreshnessTelltale> — the per-panel signal light.
 *
 * The dashboard is auth-gated, so these assertions stand in for a screenshot:
 * they prove each of the four freshness states renders its distinct visual
 * contract (label text, token color, and the motion idiom that echoes the
 * header <ConnectionStatus> — a ping ring for LIVE, an opacity breathe for
 * STALE, steady dots otherwise).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Freshness } from '@/lib/utils/freshness';
import { FreshnessTelltale } from './FreshnessTelltale';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(freshness: Freshness) {
  act(() => {
    root?.render(<FreshnessTelltale freshness={freshness} />);
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function label(): HTMLElement {
  const el = container?.querySelector('[data-testid="freshness-label"]');
  if (!el) throw new Error('freshness label not found');
  return el as HTMLElement;
}

function pingRing(): Element | null {
  return container?.querySelector('.freshness-ping') ?? null;
}

function breatheNode(): Element | null {
  return container?.querySelector('.freshness-breathe') ?? null;
}

describe('FreshnessTelltale', () => {
  it('LIVE: green label + animated ping ring (live transmission)', () => {
    render('live');
    expect(label().textContent).toBe('LIVE');
    expect(pingRing()).not.toBeNull(); // concentric ring present
    expect(breatheNode()).toBeNull(); // not breathing
    expect(label().style.color).toContain('--severity-low');
  });

  it('DELAYED: amber label, steady dot (no ping, no breathe)', () => {
    render('delayed');
    expect(label().textContent).toBe('DELAYED');
    expect(pingRing()).toBeNull();
    expect(breatheNode()).toBeNull();
    expect(label().style.color).toContain('--severity-medium');
  });

  it('STALE: red label + breathing dot (attention pulse), no ping', () => {
    render('stale');
    expect(label().textContent).toBe('STALE');
    expect(pingRing()).toBeNull();
    expect(breatheNode()).not.toBeNull(); // slow opacity breathe
    expect(label().style.color).toContain('--severity-critical');
  });

  it('DEMO: cocoa-brown label, steady dot (no motion)', () => {
    render('demo');
    expect(label().textContent).toBe('DEMO');
    expect(pingRing()).toBeNull();
    expect(breatheNode()).toBeNull();
    expect(label().style.color).toContain('--cocoa-brown');
  });

  it('exposes an accessible image role + descriptive label', () => {
    render('live');
    const img = container?.querySelector('[role="img"]') as HTMLElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('aria-label')).toBe('Data status: LIVE');
  });
});
