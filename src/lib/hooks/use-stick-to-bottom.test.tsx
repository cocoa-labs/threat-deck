/**
 * Tests for useStickToBottom — the chat auto-scroll behind the agent + companion
 * drawers. The key guarantee is the bug fix: a scrolled-up reader must NOT be
 * yanked to the bottom when background content changes (e.g. the video-render
 * poller mutating the message every ~2s). It must still follow content when
 * already at the bottom, and jump on a freshly sent user message.
 */

import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStickToBottom } from './use-stick-to-bottom';

type Msg = { role?: string };

function Host({ messages, streamingText }: { messages: Msg[]; streamingText: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onScroll = useStickToBottom(ref, messages, streamingText);
  return <div ref={ref} data-testid="scroller" onScroll={onScroll} />;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function defineScrollMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  let top = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
}

function scroller(): HTMLDivElement {
  const el = container?.querySelector('[data-testid="scroller"]');
  if (!el) throw new Error('scroller not found');
  return el as HTMLDivElement;
}

function render(messages: Msg[], streamingText = '') {
  act(() => {
    root?.render(<Host messages={messages} streamingText={streamingText} />);
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // rAF runs synchronously and returns 0 so the hook's dedup guard never sticks.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe('useStickToBottom', () => {
  it('does NOT scroll a scrolled-up reader when content changes (the render-poll bug)', () => {
    render([{ role: 'assistant' }]);
    const el = scroller();
    defineScrollMetrics(el, 1000, 200);
    el.scrollTop = 100; // 1000 - 100 - 200 = 700 px from bottom → scrolled up
    act(() => el.dispatchEvent(new Event('scroll', { bubbles: true })));

    // Video-poll churn: a new messages array with the same length/roles.
    render([{ role: 'assistant' }]);

    expect(el.scrollTop).toBe(100);
  });

  it('pins to the bottom when the reader is already at the bottom', () => {
    render([{ role: 'assistant' }]);
    const el = scroller();
    defineScrollMetrics(el, 1000, 200);
    el.scrollTop = 800; // 1000 - 800 - 200 = 0 → at bottom
    act(() => el.dispatchEvent(new Event('scroll', { bubbles: true })));

    render([{ role: 'assistant' }, { role: 'assistant' }]); // new content arrives

    expect(el.scrollTop).toBe(1000);
  });

  it('jumps to the bottom on a freshly sent user message even when scrolled up', () => {
    render([{ role: 'assistant' }]);
    const el = scroller();
    defineScrollMetrics(el, 1000, 200);
    el.scrollTop = 100; // scrolled up
    act(() => el.dispatchEvent(new Event('scroll', { bubbles: true })));

    render([{ role: 'assistant' }, { role: 'user' }]); // user just sent

    expect(el.scrollTop).toBe(1000);
  });
});
