/**
 * Tests for the Resend wrapper — CC/BCC payload mapping + sandbox detection.
 */

import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => mockSend(...args) };
  },
}));

const { sendEmail, isSandboxSender, senderAddress, _resetResendClient } = await import('./resend');

const el = createElement('div');

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ data: { id: 're-1' }, error: null });
  process.env.RESEND_API_KEY = 'test-key';
  delete process.env.RESEND_FROM_EMAIL;
  // Pin the transport so these Resend-path tests are deterministic regardless
  // of the operator's .env.local (which sets EMAIL_PROVIDER=gmail in prod).
  process.env.EMAIL_PROVIDER = 'resend';
  _resetResendClient();
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.GMAIL_SENDER;
  _resetResendClient();
});

describe('isSandboxSender / senderAddress', () => {
  it('reports sandbox when RESEND_FROM_EMAIL is unset', () => {
    expect(isSandboxSender()).toBe(true);
    expect(senderAddress()).toContain('onboarding@resend.dev');
  });

  it('reports non-sandbox for a verified custom sender', () => {
    process.env.RESEND_FROM_EMAIL = 'Cocoa AI <max@example.org>';
    expect(isSandboxSender()).toBe(false);
    expect(senderAddress()).toBe('Cocoa AI <max@example.org>');
  });

  it('treats an empty-string RESEND_FROM_EMAIL as sandbox', () => {
    process.env.RESEND_FROM_EMAIL = '';
    expect(isSandboxSender()).toBe(true);
  });
});

describe('provider dispatch (EMAIL_PROVIDER=gmail)', () => {
  it('routes senderAddress / isSandboxSender to the Gmail transport', () => {
    process.env.EMAIL_PROVIDER = 'gmail';
    process.env.GMAIL_SENDER = 'max@example.org';
    expect(senderAddress()).toBe('Cocoa AI <max@example.org>');
    expect(isSandboxSender()).toBe(false);
  });
});

describe('sendEmail', () => {
  it('maps cc and bcc into the Resend payload', async () => {
    await sendEmail({
      to: 'a@x.com',
      cc: ['b@x.com', 'c@x.com'],
      bcc: 'd@x.com',
      subject: 's',
      react: el,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@x.com',
        cc: ['b@x.com', 'c@x.com'],
        bcc: 'd@x.com',
        subject: 's',
      }),
      undefined,
    );
  });

  it('omits empty cc/bcc fields so Resend never sees them', async () => {
    await sendEmail({ to: 'a@x.com', cc: [], bcc: '   ', subject: 's', react: el });
    const payload = mockSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('cc');
    expect(payload).not.toHaveProperty('bcc');
  });

  it('returns from + sandbox metadata on success', async () => {
    process.env.RESEND_FROM_EMAIL = 'Cocoa AI <max@example.org>';
    _resetResendClient();
    const r = await sendEmail({ to: 'a@example.org', subject: 's', react: el });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('re-1');
    expect(r.sandbox).toBe(false);
    expect(r.from).toBe('Cocoa AI <max@example.org>');
  });

  it('fails soft (with from + sandbox) when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    _resetResendClient();
    const r = await sendEmail({ to: 'a@x.com', subject: 's', react: el });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('RESEND_API_KEY');
    expect(r.sandbox).toBe(true);
    expect(typeof r.from).toBe('string');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('surfaces a Resend API error', async () => {
    mockSend.mockResolvedValueOnce({ data: null, error: { message: 'verify a domain' } });
    const r = await sendEmail({ to: 'a@x.com', subject: 's', react: el });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('verify a domain');
  });
});
