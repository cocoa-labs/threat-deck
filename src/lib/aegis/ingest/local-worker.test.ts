// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runCollectionPass, startAegisCollection } from './local-worker';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
  ingest: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({ db: { connect: mocks.connect } }));
vi.mock('./index', () => ({ runAegisIngest: mocks.ingest }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.query.mockResolvedValue({ rows: [{ acquired: true }] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it.each(['false', ''])('does not start collection without explicit opt-in (%s)', (flag) => {
  vi.stubEnv('ENABLE_AEGIS_INGEST', flag);
  startAegisCollection()();
  expect(mocks.connect).not.toHaveBeenCalled();
});
it('does not collect into a demonstration installation', () => {
  vi.stubEnv('ENABLE_AEGIS_INGEST', 'true');
  vi.stubEnv('ENABLE_DEMO_DATA', 'true');
  startAegisCollection()();
  expect(mocks.connect).not.toHaveBeenCalled();
});
it('skips a concurrent collector without unlocking its lock', async () => {
  mocks.query.mockResolvedValue({ rows: [{ acquired: false }] });
  await runCollectionPass();
  expect(mocks.ingest).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.release).toHaveBeenCalledOnce();
});
it('releases its lock on source failure and waits before retrying', async () => {
  vi.stubEnv('ENABLE_AEGIS_INGEST', 'true');
  vi.stubEnv('ENABLE_DEMO_DATA', 'false');
  mocks.ingest.mockRejectedValue(new Error('source unavailable'));
  const stop = startAegisCollection();
  await vi.advanceTimersByTimeAsync(100);
  expect(mocks.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock(749103)');
  expect(mocks.release).toHaveBeenCalledOnce();
  expect(mocks.ingest).toHaveBeenCalledOnce();
  stop();
  await vi.advanceTimersByTimeAsync(3600_000);
  expect(mocks.ingest).toHaveBeenCalledOnce();
});
