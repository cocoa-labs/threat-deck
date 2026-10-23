import { afterEach, describe, expect, it } from 'vitest';
import { buildAuthUrl, getMissingTwitterScopes } from './oauth';

const originalClientId = process.env.TWITTER_OAUTH_CLIENT_ID;

afterEach(() => {
  if (originalClientId === undefined) {
    delete process.env.TWITTER_OAUTH_CLIENT_ID;
  } else {
    process.env.TWITTER_OAUTH_CLIENT_ID = originalClientId;
  }
});

describe('twitter oauth scopes', () => {
  it('requests media.write so generated image replies can upload media', () => {
    process.env.TWITTER_OAUTH_CLIENT_ID = 'client-id';

    const { url } = buildAuthUrl({
      redirectUri: 'http://localhost:3002/api/twitter/oauth/callback',
    });

    const scopes = new URL(url).searchParams.get('scope')?.split(' ') ?? [];
    expect(scopes).toEqual(
      expect.arrayContaining([
        'tweet.write',
        'tweet.read',
        'users.read',
        'offline.access',
        'media.write',
      ]),
    );
  });

  it('detects older token grants that predate media.write', () => {
    expect(
      getMissingTwitterScopes(['tweet.write', 'tweet.read', 'users.read', 'offline.access']),
    ).toEqual(['media.write']);
  });
});
