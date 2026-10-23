import { afterEach, expect, it, vi } from 'vitest';
import { capabilityStatus } from '@/lib/security/capabilities';
import { demoData } from './fallback';
import { dataProvenance, stampProvenance } from './provenance';

afterEach(() => vi.unstubAllEnvs());
it('has no implicit synthetic fallback, regardless of credentials', () => {
  vi.stubEnv('ENABLE_DEMO_DATA', undefined);
  expect(demoData([{ id: 'sample' }])).toEqual([]);
  expect(dataProvenance([]).state).toBe('unavailable');
});
it('labels explicitly enabled synthetic records and prevents their external publication', () => {
  vi.stubEnv('ENABLE_DEMO_DATA', 'true');
  for (const flag of [
    'ENABLE_X_PUBLISHING',
    'ENABLE_OUTBOUND_EMAIL',
    'ENABLE_AUTOMATION',
    'ENABLE_PUBLIC_FEED',
  ])
    vi.stubEnv(flag, 'true');
  const sample = demoData([{ id: 'sample' }]);
  expect(sample[0]).toHaveProperty('isFallback', true);
  expect(dataProvenance(sample).state).toBe('demo');
  expect(capabilityStatus()).toMatchObject({
    x: false,
    email: false,
    automation: false,
    publicFeed: false,
  });
});
it('preserves source acquisition time through serialization, polling and secondary caches', () => {
  const data = stampProvenance([{ id: 'real' }], 1000, 2000);
  const cached = JSON.parse(JSON.stringify(data));
  stampProvenance(cached, 1900, 2900);
  expect(dataProvenance(cached, 1900)).toEqual({ state: 'live', fetchedAt: 1000, expiresAt: 2000 });
  expect(dataProvenance(cached, 2001).state).toBe('stale');
});
it('never labels a mixed demo/live response or a stale snapshot live', () => {
  vi.stubEnv('ENABLE_DEMO_DATA', 'true');
  const real = stampProvenance([{ id: 'real' }], 1000, 5000);
  expect(dataProvenance([...real, ...demoData([{ id: 'sample' }])], 2000).state).toBe('demo');
  expect(dataProvenance({ data: real, stale: true }, 2000).state).toBe('stale');
  expect(dataProvenance({ timestamp: Date.now(), data: [{ id: 'unknown' }] }).state).toBe(
    'unavailable',
  );
});
