import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ready: false }));
vi.mock('@/lib/redis/client', () => ({
  isRedisConnected: () => state.ready,
  redis: {
    multi: () => {
      throw new Error('offline');
    },
  },
}));

import { checkRateLimit, getClientIp } from './rate-limit';

describe('fail-closed admission', () => {
  it('denies work when Redis is offline or commands fail', async () => {
    expect((await checkRateLimit('test', 5, 60_000)).allowed).toBe(false);
    state.ready = true;
    expect((await checkRateLimit('test', 5, 60_000)).allowed).toBe(false);
  });
  it('does not trust spoofable forwarded IPs by default', () => {
    vi.stubEnv('TRUST_PROXY', 'false');
    expect(
      getClientIp(
        new Request('https://deck.example.org', { headers: { 'x-forwarded-for': '192.0.2.1' } }),
      ),
    ).toBe('unknown');
  });
});
