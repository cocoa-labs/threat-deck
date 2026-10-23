/**
 * Tests for useFreshness — the steady-tick wrapper that keeps a panel's
 * LIVE/DELAYED/STALE telltale honest. The guarantee: the badge flips state as
 * wall-clock time passes, WITHOUT the host component re-rendering for any other
 * reason (the whole point — a query that refetches hours apart must not leave a
 * "LIVE" badge lying for hours).
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFreshness } from './use-freshness';

const T = { liveMs: 1_000, staleMs: 5_000 };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Host({ dataUpdatedAt }: { dataUpdatedAt: number }) {
  const freshness = useFreshness(dataUpdatedAt, T, 1_000);
  return <span data-testid="out">{freshness ?? 'none'}</span>;
}

function render(dataUpdatedAt: number) {
  act(() => {
    root?.render(<Host dataUpdatedAt={dataUpdatedAt} />);
  });
}

function out(): string {
  return container?.querySelector('[data-testid="out"]')?.textContent ?? '';
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(0);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe('useFreshness', () => {
  it('returns undefined before the first successful fetch (dataUpdatedAt === 0)', () => {
    render(0);
    expect(out()).toBe('none');
  });

  it('starts live for fresh data', () => {
    vi.setSystemTime(10_000);
    render(10_000); // age 0
    expect(out()).toBe('live');
  });

  it('flips live → delayed → stale on the interval tick with no re-render', () => {
    // Data stamped at t=100_000; never re-render the host after mount, only
    // advance wall-clock time + fire the interval.
    const stamp = 100_000;
    vi.setSystemTime(stamp);
    render(stamp);
    expect(out()).toBe('live'); // age 0 ≤ 1000

    act(() => {
      vi.setSystemTime(stamp + 1_500);
      vi.advanceTimersByTime(1_000); // tick fires; age now 1500 → delayed
    });
    expect(out()).toBe('delayed');

    act(() => {
      vi.setSystemTime(stamp + 6_000);
      vi.advanceTimersByTime(1_000); // tick fires; age now 6000 → stale
    });
    expect(out()).toBe('stale');
  });

  it('recomputes immediately when dataUpdatedAt changes (fresh fetch lands)', () => {
    vi.setSystemTime(100_000);
    render(1); // age ~100_000 → stale (stamp is positive, just very old)
    expect(out()).toBe('stale');

    render(100_000); // new fetch timestamp → age 0 → live, without waiting for a tick
    expect(out()).toBe('live');
  });
});
