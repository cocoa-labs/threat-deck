import { afterEach, expect, it, vi } from 'vitest';

const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@/lib/redis/client', () => ({ redis: redisMock, isRedisConnected: () => true }));

import { dataProvenance } from './provenance';
import { getCached, setCache } from './rate-limiter';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('does not renew the source age or in-memory expiry on repeated Redis hits', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  await setCache('cve:release-test', [{ id: 'verified' }], 1);
  const serialized = redisMock.set.mock.calls[0]?.[1];
  expect(typeof serialized).toBe('string');
  redisMock.get.mockResolvedValue(serialized);
  vi.setSystemTime(1900);
  expect(dataProvenance(await getCached('cve:release-test')).fetchedAt).toBe(1000);
  redisMock.get.mockRejectedValue(new Error('Redis unavailable'));
  vi.setSystemTime(2001);
  expect(await getCached('cve:release-test')).toBeNull();
});
