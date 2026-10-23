/**
 * UI tests for the X draft composer. Review draft stages the reviewed text and
 * hands off to the publication queue. Only explicit approval can publish.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub a working in-memory localStorage BEFORE importing the persisted store so
// persist hydration + writes succeed (mirrors agent-store.test.ts).
const memStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => memStore.set(k, v),
  removeItem: (k: string) => memStore.delete(k),
  clear: () => memStore.clear(),
  key: () => null,
  length: 0,
});

const { useAgentStore } = await import('@/lib/store/agent-store');
const { PostToXButton } = await import('./PostToXButton');

const BUTTON_PROPS = {
  messageContent:
    '**[CRITICAL]** CVE-2099-0001 exploit pressure is rising. Source: https://source.example/advisory',
  messageTimestamp: 1779000000000,
};

let root: Root | null = null;

function renderButton(props: ComponentProps<typeof PostToXButton> = BUTTON_PROPS): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PostToXButton {...props} />
      </QueryClientProvider>,
    );
  });
  return document.body;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  return button;
}

function exactButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  return button;
}

async function clickAndFlush(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function jobsBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/outbound/x/review');
  if (!call) throw new Error('X draft staging call not found');
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

const connectedStatus = () =>
  Response.json({
    ok: true,
    connected: true,
    handle: 'ExampleMonitor',
    dryRun: false,
    missingScopes: [],
  });
const composeOk = () =>
  Response.json({
    ok: true,
    package: {
      primaryText: 'A Cocoa AI story post.',
      replyText: 'Source trail.',
      draftedBy: 'llm',
    },
  });
const composeFormattedOk = () =>
  Response.json({
    ok: true,
    package: {
      primaryText:
        'Hook line from Max.\n\nBLUF: The operator read is structured.\n\n1. First signal\nThe detail breathes on X.\n\nOperator take: Keep the thread readable.',
      replyText: 'Source trail.',
      draftedBy: 'llm',
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  useAgentStore.setState({ xPostJobs: [] });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  document.body.innerHTML = '';
  useAgentStore.setState({ xPostJobs: [] });
});

describe('PostToXButton (reviewable drafts)', () => {
  it('opens the two-post composer once X is connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/twitter/status') return connectedStatus();
        if (url === '/api/twitter/compose') return composeOk();
        return Response.json({ ok: false, error: 'unexpected_url' }, { status: 500 });
      }),
    );

    const container = renderButton();
    await clickAndFlush(buttonByText(container, 'Post to X'));

    expect(container.textContent).toContain('@ExampleMonitor');
    expect(container.textContent).toContain('One post');
    expect(container.textContent).toContain('Two-post thread');
  });

  it('stages reviewed copy without publishing it', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/twitter/status') return connectedStatus();
      if (url === '/api/twitter/compose') return composeOk();
      if (url === '/api/outbound/x/review') {
        return Response.json(
          {
            ok: true,
            draftId: 101,
            status: 'queued',
            pollUrl: '/api/outbound/x/review/xpost_abc',
          },
          { status: 202 },
        );
      }
      return Response.json({ ok: false, error: 'unexpected_url' }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = renderButton();
    await clickAndFlush(buttonByText(container, 'Post to X'));
    await clickAndFlush(exactButtonByText(container, 'Refine with Max'));
    await clickAndFlush(exactButtonByText(container, 'Review draft'));

    // Saving uses the draft endpoint and never publishes.
    const body = jobsBody(fetchMock);
    expect(body.publishMode).toBe('two_post');
    expect(String(body.text).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/twitter/post',
      expect.objectContaining({ method: 'POST' }),
    );

    // No publishing job starts; the composer closes for draft review.
    expect(useAgentStore.getState().xPostJobs).toHaveLength(0);
    expect(container.textContent).not.toContain('Two-post thread');
  });

  it('preserves formatted primary post line breaks when launching the job', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/twitter/status') return connectedStatus();
      if (url === '/api/twitter/compose') return composeFormattedOk();
      if (url === '/api/outbound/x/review') {
        return Response.json(
          {
            ok: true,
            draftId: 102,
            status: 'queued',
            pollUrl: '/api/outbound/x/review/xpost_formatted',
          },
          { status: 202 },
        );
      }
      return Response.json({ ok: false, error: 'unexpected_url' }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const container = renderButton();
    await clickAndFlush(buttonByText(container, 'Post to X'));
    await clickAndFlush(exactButtonByText(container, 'Refine with Max'));
    await clickAndFlush(exactButtonByText(container, 'Review draft'));

    const body = jobsBody(fetchMock);
    expect(body.text).toBe(
      'Hook line from Max.\n\nBLUF: The operator read is structured.\n\n1. First signal\nThe detail breathes on X.\n\nOperator take: Keep the thread readable.',
    );
  });
});
