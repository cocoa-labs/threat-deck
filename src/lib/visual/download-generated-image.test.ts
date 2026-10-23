import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadGeneratedImage, generatedImageDownloadFilename } from './download-generated-image';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe('downloadGeneratedImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
    } else {
      Reflect.deleteProperty(URL, 'createObjectURL');
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
    } else {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('builds a safe Cocoa AI PNG filename', () => {
    expect(generatedImageDownloadFilename('77')).toBe('cocoa-ai-infographic-77.png');
    expect(generatedImageDownloadFilename('media/with spaces')).toBe(
      'cocoa-ai-infographic-media-with-spaces.png',
    );
  });

  it('fetches the blob and triggers an anchor download', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['png'], { type: 'image/png' }), {
        status: 200,
      }),
    );
    const createObjectURL = vi.fn().mockReturnValue('blob:cocoa-download');
    const revokeObjectURL = vi.fn();
    let clickedAnchor: { download: string; href: string } | null = null;
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function clickSpy(
      this: HTMLAnchorElement,
    ) {
      clickedAnchor = { download: this.download, href: this.href };
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await downloadGeneratedImage('https://blob.example/outbound-visuals/77.png', '77');

    expect(fetchMock).toHaveBeenCalledWith('https://blob.example/outbound-visuals/77.png');
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedAnchor).toEqual({
      download: 'cocoa-ai-infographic-77.png',
      href: 'blob:cocoa-download',
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cocoa-download');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens the full image when direct download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await downloadGeneratedImage('https://blob.example/outbound-visuals/77.png', '77');

    expect(warnSpy).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(
      'https://blob.example/outbound-visuals/77.png',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
