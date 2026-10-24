/**
 * The manual composer previews the exact payload and publishes on one explicit
 * click. Saving, closing, provider failures, and duplicate clicks cannot send more.
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
  if (!root) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
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

const image = {
  generatedMediaId: '101',
  status: 'ready' as const,
  blobUrl: '/api/outbound/generated-media/101/content',
  createdAt: 1779000000000,
  styleTag: 'terminal_dossier',
};
function dialog(): HTMLElement {
  return document.querySelector('[role="dialog"]') as HTMLElement;
}
function mockWorkflow(
  options: {
    status?: Record<string, unknown>;
    result?: Record<string, unknown>;
    failApproval?: boolean;
    failStage?: boolean;
  } = {},
) {
  const mock = vi.fn(async (url: string) => {
    if (url === '/api/twitter/status')
      return options.status ? Response.json(options.status) : connectedStatus();
    if (url === '/api/twitter/compose') return composeFormattedOk();
    if (url === '/api/outbound/x/review')
      return options.failStage
        ? Response.json({ ok: false, error: 'media_not_owned' }, { status: 403 })
        : Response.json({ ok: true, draftId: 101 }, { status: 201 });
    if (url === '/api/outbound/drafts/101/approve') {
      if (options.failApproval) throw new TypeError('network interrupted');
      return Response.json(
        options.result ?? { ok: true, status: 'published', tweetIds: ['1999999999999999999'] },
      );
    }
    return Response.json({ ok: false, error: 'unexpected_url' }, { status: 500 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
function approvals(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([url]) => String(url).endsWith('/approve'));
}

describe('PostToXButton (one composer)', () => {
  it('attaches an image generated after the composer was first opened', async () => {
    mockWorkflow();
    const container = renderButton();
    await clickAndFlush(buttonByText(container, 'Post to X'));
    await clickAndFlush(exactButtonByText(dialog(), 'Refine with Max'));
    const text = (dialog().querySelector('textarea') as HTMLTextAreaElement).value;
    await clickAndFlush(
      dialog().querySelector('[aria-label="Close X composer"]') as HTMLButtonElement,
    );
    renderButton({ ...BUTTON_PROPS, generatedImages: [image] });
    await clickAndFlush(buttonByText(container, 'Post to X'));
    expect(dialog().querySelector('img')?.getAttribute('src')).toBe(image.blobUrl);
    expect((dialog().querySelector('textarea') as HTMLTextAreaElement).value).toBe(text);
    await clickAndFlush(exactButtonByText(dialog(), 'No attachment'));
    await clickAndFlush(
      dialog().querySelector('[aria-label="Close X composer"]') as HTMLButtonElement,
    );
    await clickAndFlush(buttonByText(container, 'Post to X'));
    expect(dialog().querySelector('img')).toBeNull();
  });
  it('defaults to one post, attaches the existing image, and does not send on open', async () => {
    const mock = mockWorkflow();
    const container = renderButton({ ...BUTTON_PROPS, generatedImages: [image] });
    await clickAndFlush(buttonByText(container, 'Post to X'));
    expect(dialog().textContent).toContain('@ExampleMonitor');
    expect(exactButtonByText(dialog(), 'One post').getAttribute('aria-pressed')).toBe('true');
    expect(dialog().querySelector('img')?.getAttribute('src')).toBe(image.blobUrl);
    expect(approvals(mock)).toHaveLength(0);
    expect(mock.mock.calls.some(([url]) => url === '/api/outbound/x/review')).toBe(false);
  });

  it('publishes the displayed text and image on one explicit click, then shows its X link', async () => {
    const mock = mockWorkflow();
    const container = renderButton({ ...BUTTON_PROPS, generatedImages: [image] });
    await clickAndFlush(buttonByText(container, 'Post to X'));
    const visibleText = (dialog().querySelector('textarea') as HTMLTextAreaElement).value;
    expect(dialog().textContent).toContain('Added to your post: #AICyber');
    await clickAndFlush(exactButtonByText(dialog(), 'Post to X'));
    expect(jobsBody(mock)).toMatchObject({
      text: `${visibleText} #AICyber`,
      publishMode: 'single',
      imageBlobUrl: image.blobUrl,
    });
    expect(approvals(mock)).toHaveLength(1);
    expect(JSON.parse(String(approvals(mock)[0]?.[1]?.body))).toEqual({
      publish: true,
      reviewedPayload: {
        canonicalHashtag: '#AICyber',
        tweets: [{ text: `${visibleText} #AICyber` }],
        mediaId: '101',
        mediaKind: 'image',
      },
    });
    expect(dialog().textContent).toContain('Posted to X.');
    expect(
      dialog().querySelector('a[href="https://x.com/i/status/1999999999999999999"]'),
    ).not.toBeNull();
    expect(dialog().textContent).not.toContain('Review draft');
  });

  it('saves without publishing, preserves the composer on reopen, and reuses the saved draft', async () => {
    const mock = mockWorkflow();
    const container = renderButton();
    await clickAndFlush(buttonByText(container, 'Post to X'));
    await clickAndFlush(exactButtonByText(dialog(), 'Refine with Max'));
    const edited = (dialog().querySelector('textarea') as HTMLTextAreaElement).value;
    await clickAndFlush(exactButtonByText(dialog(), 'Save for later'));
    expect(approvals(mock)).toHaveLength(0);
    expect(dialog().textContent).toContain('Saved for later. Not posted.');
    await clickAndFlush(
      dialog().querySelector('[aria-label="Close X composer"]') as HTMLButtonElement,
    );
    await clickAndFlush(buttonByText(container, 'Post to X'));
    expect((dialog().querySelector('textarea') as HTMLTextAreaElement).value).toBe(edited);
    await clickAndFlush(exactButtonByText(dialog(), 'Post to X'));
    expect(mock.mock.calls.filter(([url]) => url === '/api/outbound/x/review')).toHaveLength(1);
    expect(approvals(mock)).toHaveLength(1);
    expect(String(jobsBody(mock).text)).toContain('Hook line from Max.\n\nBLUF:');
  });

  it('ignores a duplicate click while saving or publishing', async () => {
    const mock = mockWorkflow();
    await clickAndFlush(buttonByText(renderButton(), 'Post to X'));
    const publish = exactButtonByText(dialog(), 'Post to X');
    await act(async () => {
      publish.click();
      publish.click();
    });
    expect(mock.mock.calls.filter(([url]) => url === '/api/outbound/x/review')).toHaveLength(1);
    expect(approvals(mock)).toHaveLength(1);
  });

  it('never approves a failed draft creation', async () => {
    const mock = mockWorkflow({ failStage: true });
    await clickAndFlush(buttonByText(renderButton(), 'Post to X'));
    await clickAndFlush(exactButtonByText(dialog(), 'Post to X'));
    expect(approvals(mock)).toHaveLength(0);
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('media_not_owned');
  });

  it('does not report an interrupted publish as success or resend on reopen', async () => {
    const mock = mockWorkflow({ failApproval: true });
    const container = renderButton();
    await clickAndFlush(buttonByText(container, 'Post to X'));
    await clickAndFlush(exactButtonByText(dialog(), 'Post to X'));
    expect(dialog().textContent).toContain('before X confirmed');
    expect(dialog().textContent).not.toContain('Posted to X.');
    await clickAndFlush(exactButtonByText(dialog(), 'Done'));
    await clickAndFlush(buttonByText(container, 'Post to X'));
    expect(dialog().textContent).toContain('before X confirmed');
    expect(
      Array.from(dialog().querySelectorAll('button')).some((b) => b.textContent === 'Post to X'),
    ).toBe(false);
    expect(approvals(mock)).toHaveLength(1);
  });

  it('shows partial publication links without claiming the whole thread posted', async () => {
    mockWorkflow({
      result: {
        ok: false,
        error: 'partial_publish',
        partial: { tweetIds: ['1999999999999999999'], publishedCount: 1 },
      },
    });
    await clickAndFlush(buttonByText(renderButton(), 'Post to X'));
    await clickAndFlush(exactButtonByText(dialog(), 'Two-post thread'));
    await clickAndFlush(exactButtonByText(dialog(), 'Post to X'));
    expect(dialog().textContent).toContain('1 post(s) sent, but the thread did not finish');
    expect(
      dialog().querySelector('a[href="https://x.com/i/status/1999999999999999999"]'),
    ).not.toBeNull();
    expect(dialog().textContent).not.toContain('Thread posted to X.');
  });

  it('labels dry runs before and after the test without a public success link', async () => {
    mockWorkflow({
      status: { ok: true, connected: true, dryRun: true, missingScopes: [] },
      result: { ok: true, status: 'published', dryRun: true, tweetIds: ['dry-123'] },
    });
    await clickAndFlush(buttonByText(renderButton(), 'Post to X'));
    expect(dialog().textContent).toContain('Test mode is enabled');
    await clickAndFlush(exactButtonByText(dialog(), 'Test post (not public)'));
    expect(dialog().textContent).toContain('Nothing was posted to X');
    expect(dialog().querySelector('a[href^="https://x.com/"]')).toBeNull();
  });

  it.each([
    { ok: true, connected: false, missingScopes: [] },
    { ok: true, connected: true, missingScopes: ['media.write'] },
    { ok: true, connected: true, missingScopes: ['tweet.write'] },
  ])('does not publish without a usable X connection: %o', async (status) => {
    const mock = mockWorkflow({ status });
    await clickAndFlush(
      buttonByText(renderButton({ ...BUTTON_PROPS, generatedImages: [image] }), 'Post to X'),
    );
    expect(exactButtonByText(dialog(), 'Post to X').disabled).toBe(true);
    await clickAndFlush(exactButtonByText(dialog(), 'Save for later'));
    expect(approvals(mock)).toHaveLength(0);
  });

  it('blocks posting until the attached image is ready', async () => {
    const mock = mockWorkflow();
    await clickAndFlush(
      buttonByText(
        renderButton({
          ...BUTTON_PROPS,
          generatedImages: [{ ...image, status: 'pending', blobUrl: undefined }],
        }),
        'Post to X',
      ),
    );
    expect(exactButtonByText(dialog(), 'Post to X').disabled).toBe(true);
    expect(exactButtonByText(dialog(), 'Save for later').disabled).toBe(true);
    expect(approvals(mock)).toHaveLength(0);
  });
});
