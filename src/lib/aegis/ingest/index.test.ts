import { describe, expect, it, vi } from 'vitest';
import type { IngestSummary } from './ingest-cves';

describe('runAegisIngest', () => {
  it('aggregates all ingest summaries', async () => {
    vi.resetModules();
    vi.doMock('./ingest-cves', () => ({
      ingestCves: async () => ({ source: 'cves', upserted: 3, ok: true }),
    }));
    vi.doMock('./ingest-kev', () => ({
      ingestKev: async () => ({ source: 'kev', upserted: 1, ok: true }),
    }));
    vi.doMock('./ingest-iocs', () => ({
      ingestIocs: async () => ({ source: 'iocs', upserted: 2, ok: true }),
    }));
    vi.doMock('./ingest-advisories', () => ({
      ingestAdvisories: async () => ({ source: 'advisories', upserted: 0, ok: true }),
    }));
    vi.doMock('./ingest-breaches', () => ({
      ingestBreaches: async () => ({ source: 'breaches', upserted: 0, ok: true }),
    }));
    const { runAegisIngest } = await import('./index');
    const res = await runAegisIngest();
    expect(res.ok).toBe(true);
    expect(res.totalUpserted).toBe(6);
  });
});

describe('publishIngestNudges', () => {
  it('is a no-op when Redis is disconnected', async () => {
    vi.resetModules();
    const publish = vi.fn(async () => 0);
    vi.doMock('@/lib/redis/client', () => ({
      isRedisConnected: () => false,
      redis: { publish },
    }));
    const { publishIngestNudges } = await import('./index');
    await publishIngestNudges([{ source: 'cves', upserted: 3, ok: true }]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes only for ok && upserted > 0 sources', async () => {
    vi.resetModules();
    const publish = vi.fn(async () => 1);
    vi.doMock('@/lib/redis/client', () => ({
      isRedisConnected: () => true,
      redis: { publish },
    }));
    const { publishIngestNudges, AEGIS_PUSH_CHANNEL } = await import('./index');

    const sources: IngestSummary[] = [
      { source: 'cves', upserted: 3, ok: true }, // published
      { source: 'kev', upserted: 0, ok: true }, // skipped: nothing changed
      { source: 'iocs', upserted: 5, ok: false }, // skipped: source failed
      { source: 'breaches', upserted: 2, ok: true }, // published
    ];
    await publishIngestNudges(sources);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledWith(
      AEGIS_PUSH_CHANNEL,
      JSON.stringify({ channel: 'cves', type: 'refresh', count: 3 }),
    );
    expect(publish).toHaveBeenCalledWith(
      AEGIS_PUSH_CHANNEL,
      JSON.stringify({ channel: 'breaches', type: 'refresh', count: 2 }),
    );
  });

  it('swallows publish errors (never throws)', async () => {
    vi.resetModules();
    const publish = vi.fn(async () => {
      throw new Error('redis down mid-publish');
    });
    vi.doMock('@/lib/redis/client', () => ({
      isRedisConnected: () => true,
      redis: { publish },
    }));
    const { publishIngestNudges } = await import('./index');
    await expect(
      publishIngestNudges([{ source: 'cves', upserted: 1, ok: true }]),
    ).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
