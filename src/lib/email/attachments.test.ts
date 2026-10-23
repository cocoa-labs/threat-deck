/**
 * Tests for buildMediaAttachments — fetches blob URLs, base64-encodes them into
 * Resend attachment objects, and reports anything it couldn't attach.
 */

import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMediaAttachments } from './attachments';

const mockFetch = vi.fn();

function bin(bytes: number, type: string): Response {
  return new Response(new Uint8Array(bytes).fill(65), {
    status: 200,
    headers: { 'content-type': type },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildMediaAttachments', () => {
  it('builds base64 attachments for an image + a video', async () => {
    mockFetch
      .mockResolvedValueOnce(bin(10, 'image/png'))
      .mockResolvedValueOnce(bin(20, 'video/mp4'));
    const { attachments, skipped } = await buildMediaAttachments([
      { blobUrl: 'https://b/img.png', kind: 'image' },
      { blobUrl: 'https://b/clip.mp4', kind: 'video' },
    ]);

    expect(skipped).toEqual([]);
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      filename: 'cocoa-infographic.png',
      contentType: 'image/png',
    });
    expect(attachments[1]).toMatchObject({ filename: 'cocoa-clip.mp4', contentType: 'video/mp4' });
    expect(attachments[0]?.content).toBe(
      Buffer.from(new Uint8Array(10).fill(65)).toString('base64'),
    );
  });

  it('skips non-https urls without fetching', async () => {
    const { attachments, skipped } = await buildMediaAttachments([
      { blobUrl: 'http://b/x.png', kind: 'image' },
    ]);
    expect(attachments).toHaveLength(0);
    expect(skipped[0]?.reason).toContain('https');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips fetch failures', async () => {
    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const { attachments, skipped } = await buildMediaAttachments([
      { blobUrl: 'https://b/x.png', kind: 'image' },
    ]);
    expect(attachments).toHaveLength(0);
    expect(skipped[0]?.reason).toContain('404');
  });

  it('numbers multiple attachments of the same kind', async () => {
    mockFetch.mockResolvedValueOnce(bin(5, 'image/png')).mockResolvedValueOnce(bin(5, 'image/png'));
    const { attachments } = await buildMediaAttachments([
      { blobUrl: 'https://b/a.png', kind: 'image' },
      { blobUrl: 'https://b/b.png', kind: 'image' },
    ]);
    expect(attachments.map((a) => a.filename)).toEqual([
      'cocoa-infographic.png',
      'cocoa-infographic-2.png',
    ]);
  });
});
