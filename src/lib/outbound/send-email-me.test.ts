/**
 * Tests for the shared sendEmailMe() helper — the POST to /api/outbound/email-me
 * used by both the manual EMAIL button and the conversational auto-send-when-ready
 * path. Pure fetch wrapper; fetch is stubbed so no real request happens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendEmailMe } from './send-email-me';

describe('sendEmailMe', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the expected body to /api/outbound/email-me and returns ok', async () => {
    mockFetch.mockResolvedValue({ json: async () => ({ ok: true, recipient: 'me@example.org' }) });

    const result = await sendEmailMe({
      messageContent: 'BLUF — something happened',
      messageTimestamp: 123,
      severity: 'high',
      alertEntityKind: 'cve',
      alertEntityId: 'CVE-2026-1',
      attachImageUrls: ['https://blob.example/x.png'],
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('/api/outbound/email-me');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      messageContent: 'BLUF — something happened',
      messageTimestamp: 123,
      severity: 'high',
      alertEntityKind: 'cve',
      alertEntityId: 'CVE-2026-1',
      attachImageUrls: ['https://blob.example/x.png'],
      attachVideoUrls: [],
      forceResend: false,
    });
    expect(result).toEqual({ ok: true, alreadySent: false, recipient: 'me@example.org' });
  });

  it('returns an error result when the route responds not-ok', async () => {
    mockFetch.mockResolvedValue({
      status: 400,
      json: async () => ({ ok: false, error: 'no_recipient', detail: 'no inbox configured' }),
    });
    const result = await sendEmailMe({ messageContent: 'x', messageTimestamp: 1 });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('no inbox configured');
  });

  it('returns a network_error result when fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    const result = await sendEmailMe({ messageContent: 'x', messageTimestamp: 1 });
    expect(result).toEqual({ ok: false, detail: 'boom' });
  });
});
