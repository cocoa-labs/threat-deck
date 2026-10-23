/**
 * UI tests for the IMG button as a FIRE-AND-CLOSE launcher.
 *
 * The button no longer holds a polling loop or renders the image inline. On a
 * successful submit it seeds a PENDING GeneratedImageAttachment via onImageReady
 * (carrying the pollUrl) and closes immediately — mirroring GenerateVideoButton.
 * The AgentDrawer auto-poller renders the result inline. These tests assert that
 * contract (seed + close + single START fetch, no in-component polling).
 */

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerateImageButton } from './GenerateImageButton';

const BUTTON_PROPS = {
  messageContent: '**[CRITICAL]** CVE image fixture.',
  messageTimestamp: 1779000000000,
};

let root: Root | null = null;

function renderButton(
  props: ComponentProps<typeof GenerateImageButton> = BUTTON_PROPS,
): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<GenerateImageButton {...props} />);
  });
  return container;
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${text}`);
  }
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GenerateImageButton (fire-and-close launcher)', () => {
  it('shows a useful error for empty/non-JSON failed responses (modal stays open)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Error' })),
    );

    const container = renderButton();
    await clickAndFlush(buttonByText(container, 'IMG'));
    await clickAndFlush(buttonByText(container, 'Generate'));

    expect(container.textContent).toContain('HTTP 500 Internal Error');
    expect(container.textContent).not.toContain('Unexpected end of JSON input');
  });

  it('seeds a PENDING attachment and closes the modal on submit (no inline polling)', async () => {
    const onImageReady = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        generatedMediaId: '42',
        status: 'pending',
        pollUrl: '/api/outbound/generated-media/42',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const container = renderButton({ ...BUTTON_PROPS, onImageReady });
    await clickAndFlush(buttonByText(container, 'IMG'));
    await clickAndFlush(buttonByText(container, 'Generate'));

    // Seeded a PENDING attachment (carrying the pollUrl) for the drawer poller.
    expect(onImageReady).toHaveBeenCalledTimes(1);
    expect(onImageReady).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedMediaId: '42',
        status: 'pending',
        pollUrl: '/api/outbound/generated-media/42',
      }),
    );
    // Modal closed immediately, and the button never polled (single START fetch).
    expect(container.textContent).not.toContain('Detected brief');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/outbound/generate-image', expect.anything());
  });

  it('seeds a READY attachment directly on a dedup hit', async () => {
    const onImageReady = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          ok: true,
          generatedMediaId: '88',
          status: 'ready',
          blobUrl: 'https://blob.example/outbound-visuals/88.png',
        }),
      ),
    );

    const container = renderButton({ ...BUTTON_PROPS, onImageReady });
    await clickAndFlush(buttonByText(container, 'IMG'));
    await clickAndFlush(buttonByText(container, 'Generate'));

    expect(onImageReady).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedMediaId: '88',
        status: 'ready',
        blobUrl: 'https://blob.example/outbound-visuals/88.png',
      }),
    );
    expect(container.textContent).not.toContain('Detected brief');
  });

  it('previews structured brief fields and submits source context', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ ok: true, generatedMediaId: '42', status: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);

    const container = renderButton({
      messageContent:
        '## BLUF\n**[CRITICAL]** CVE-2099-0001 exploit pressure is rising. CVSS: 9.8\n\n## KEY FINDINGS\n- Patch now.\n\n**Sources:**\n- [VERIFIED] [CISA KEV](/api/aegis/kev/view?id=CVE-2099-0001)',
      messageTimestamp: 1779000000000,
      sourceContext: {
        sourcePanel: 'kevAlerts',
        dataType: 'kev',
        trendData: { sourceUrl: '/api/aegis/kev/view?id=CVE-2099-0001' },
      },
    });

    await clickAndFlush(buttonByText(container, 'IMG'));

    expect(container.textContent).toContain('Detected brief');
    expect(container.textContent).toContain('critical');
    expect(container.textContent).toContain('metrics');
    expect(container.textContent).toContain('KEV pressure');

    await clickAndFlush(buttonByText(container, 'Generate'));

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.sourceContext).toMatchObject({ sourcePanel: 'kevAlerts', dataType: 'kev' });
  });
});
