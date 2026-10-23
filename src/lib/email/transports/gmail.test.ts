import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted handle so the googleapis mock can capture the sent request.
const h = vi.hoisted(() => ({
  sendMock: vi.fn(async () => ({ data: { id: 'gmail-id', threadId: 'gmail-thread' } })),
}));

vi.mock('@react-email/render', () => ({
  render: vi.fn(async (_node: unknown, opts?: { plainText?: boolean }) =>
    opts?.plainText ? 'PLAINTEXT BODY' : '<p>HTML BODY</p>',
  ),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: class {} },
    gmail: () => ({ users: { messages: { send: h.sendMock } } }),
  },
}));

import type { ReactElement } from 'react';
import { sendViaGmail } from './gmail';

// render is mocked, so the actual element value is never used.
const REACT = {} as ReactElement;

function lastRequestBody(): { raw: string; threadId?: string } {
  const calls = h.sendMock.mock.calls as unknown as Array<
    [{ requestBody: { raw: string; threadId?: string } }]
  >;
  const call = calls.at(-1)?.[0];
  if (!call) throw new Error('gmail.send was not called');
  return call.requestBody;
}

function decodeLastRaw(): string {
  const raw = lastRequestBody().raw;
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

describe('sendViaGmail MIME assembly', () => {
  beforeEach(() => {
    process.env.GMAIL_SENDER = 'max@example.org';
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'sa@threat-deck-mailer.iam.gserviceaccount.com';
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n';
    h.sendMock.mockClear();
  });

  it('wraps an attachment in multipart/mixed with a Content-Disposition part', async () => {
    const pngB64 = Buffer.from('FAKE-PNG-BYTES').toString('base64');
    const res = await sendViaGmail({
      to: 'operator@example.org',
      subject: 'Test with infographic',
      react: REACT,
      attachments: [
        { filename: 'cocoa-infographic.png', content: pngB64, contentType: 'image/png' },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.id).toBe('gmail-id');

    const raw = decodeLastRaw();
    expect(raw).toContain('Content-Type: multipart/mixed');
    expect(raw).toContain('Content-Type: multipart/alternative');
    expect(raw).toContain('Content-Type: image/png; name="cocoa-infographic.png"');
    expect(raw).toContain('Content-Disposition: attachment; filename="cocoa-infographic.png"');
    expect(raw).toContain('Content-Type: text/html');
    // The attachment's base64 bytes ride along verbatim.
    expect(raw).toContain(pngB64);
  });

  it('attaches a video with the right content type', async () => {
    const mp4B64 = Buffer.from('FAKE-MP4-BYTES').toString('base64');
    await sendViaGmail({
      to: 'operator@example.org',
      subject: 'Test with clip',
      react: REACT,
      attachments: [{ filename: 'cocoa-clip.mp4', content: mp4B64, contentType: 'video/mp4' }],
    });
    const raw = decodeLastRaw();
    expect(raw).toContain('Content-Type: video/mp4; name="cocoa-clip.mp4"');
    expect(raw).toContain('Content-Disposition: attachment; filename="cocoa-clip.mp4"');
    expect(raw).toContain(mp4B64);
  });

  it('keeps a plain multipart/alternative when there are no attachments', async () => {
    await sendViaGmail({ to: 'operator@example.org', subject: 'No attach', react: REACT });
    const raw = decodeLastRaw();
    expect(raw).toContain('Content-Type: multipart/alternative');
    expect(raw).not.toContain('multipart/mixed');
  });

  it('passes threadId through for in-thread replies', async () => {
    await sendViaGmail({
      to: 'operator@example.org',
      subject: 'Re: thread',
      react: REACT,
      threadId: 'T123',
    });
    expect(lastRequestBody().threadId).toBe('T123');
  });

  it('fails soft (no throw) when Gmail is not configured', async () => {
    process.env.GMAIL_SENDER = '';
    const res = await sendViaGmail({ to: 'operator@example.org', subject: 'x', react: REACT });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });
});
