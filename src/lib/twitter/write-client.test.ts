import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetActiveToken = vi.fn();
const mockGetActiveTokenScopes = vi.fn();

vi.mock('@/lib/twitter/oauth', () => ({
  getActiveToken: (...args: unknown[]) => mockGetActiveToken(...args),
  getActiveTokenScopes: (...args: unknown[]) => mockGetActiveTokenScopes(...args),
  getMissingTwitterScopes: (
    grantedScopes: readonly string[] | null | undefined,
    requiredScopes: readonly string[],
  ) => {
    const granted = new Set(grantedScopes ?? []);
    return requiredScopes.filter((scope) => !granted.has(scope));
  },
  MEDIA_UPLOAD_REQUIRED_SCOPES: ['media.write'],
}));

const { postTweet, uploadTweetImageFromUrl } = await import('./write-client');

const originalDevOverride = process.env.TWITTER_DEV_HANDLE_OVERRIDE;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TWITTER_DEV_HANDLE_OVERRIDE = '1';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalDevOverride === undefined) {
    delete process.env.TWITTER_DEV_HANDLE_OVERRIDE;
  } else {
    process.env.TWITTER_DEV_HANDLE_OVERRIDE = originalDevOverride;
  }
});

describe('postTweet', () => {
  it('allows long-form post text above the old 280-character limit', async () => {
    mockGetActiveToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ data: { id: 'tweet-id', text: 'ok' } })),
    );

    const result = await postTweet({ text: 'Long-form Cocoa AI post. '.repeat(20) });

    expect(result).toMatchObject({ ok: true, tweetId: 'tweet-id' });
  });

  it('surfaces a clear long-form eligibility message when X rejects the post', async () => {
    mockGetActiveToken.mockResolvedValue('token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ errors: [{ message: 'client forbidden' }] }, { status: 403 }),
        ),
    );

    const result = await postTweet({ text: 'Long-form Cocoa AI post. '.repeat(20) });

    expect(result).toMatchObject({
      ok: false,
      error: 'twitter_api_error',
      status: 403,
    });
    expect(result.detail).toContain('X account/API did not accept long-form post');
  });

  it('rejects post text above the local 25k safety cap', async () => {
    const result = await postTweet({ text: 'x'.repeat(25_001) });

    expect(result).toMatchObject({ ok: false, error: 'text_too_long' });
    expect(mockGetActiveToken).not.toHaveBeenCalled();
  });
});

describe('postTweet — reactive 401 recovery', () => {
  it('force-refreshes the token and retries once when X returns 401 (self-heal)', async () => {
    mockGetActiveToken
      .mockResolvedValueOnce('stale-token') // initial getActiveToken()
      .mockResolvedValueOnce('fresh-token'); // forced refresh after the 401
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ title: 'Unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'tweet-id', text: 'ok' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postTweet({ text: 'Cocoa AI cyber wire' });

    expect(result).toMatchObject({ ok: true, tweetId: 'tweet-id' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second token fetch must be the forced refresh.
    expect(mockGetActiveToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    // The retry must carry the rotated token, not the stale one.
    const retryHeaders = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(retryHeaders.authorization).toBe('Bearer fresh-token');
  });

  it('surfaces twitter_api_error 401 when the token is still rejected after the refresh', async () => {
    mockGetActiveToken.mockResolvedValueOnce('stale-token').mockResolvedValueOnce('fresh-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ title: 'Unauthorized' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postTweet({ text: 'Cocoa AI cyber wire' });

    expect(result).toMatchObject({ ok: false, error: 'twitter_api_error', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // exactly one retry — no infinite loop
  });

  it('does not retry when the forced refresh yields no token (dead grant)', async () => {
    mockGetActiveToken.mockResolvedValueOnce('stale-token').mockResolvedValueOnce(null); // refresh chain is dead → reconnect required
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ title: 'Unauthorized' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postTweet({ text: 'Cocoa AI cyber wire' });

    expect(result).toMatchObject({ ok: false, error: 'twitter_api_error', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing to retry with
  });
});

describe('uploadTweetImageFromUrl', () => {
  it('fails before network upload when the OAuth token lacks media.write', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockGetActiveTokenScopes.mockResolvedValue([
      'tweet.write',
      'tweet.read',
      'users.read',
      'offline.access',
    ]);

    const result = await uploadTweetImageFromUrl('https://blob.example/image.png');

    expect(result).toMatchObject({
      ok: false,
      error: 'missing_scope',
      status: 403,
      missingScopes: ['media.write'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockGetActiveToken).not.toHaveBeenCalled();
  });
});
