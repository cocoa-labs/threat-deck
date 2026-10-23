import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const VAL = 'http://malware.test/x';

async function cleanup() {
  await query(`DELETE FROM aegis_iocs WHERE value = $1`, [VAL]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('ingestIocs', () => {
  it('upserts an IOC by value (insert then update, no dupe)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/collectors/threat-iocs', () => ({
      fetchUrlhausIocs: async () => [
        { iocType: 'url', value: VAL, source: 'urlhaus', lastSeen: '2026-06-06', confidence: 0.8 },
      ],
      fetchMalwareBazaarSamples: async () => [],
      fetchThreatfoxIndicators: async () => [],
    }));
    const { ingestIocs } = await import('./ingest-iocs');

    // First run inserts.
    const res1 = await ingestIocs();
    expect(res1.ok).toBe(true);
    const r1 = await query(`SELECT 1 FROM aegis_iocs WHERE value = $1`, [VAL]);
    expect(r1.rowCount).toBe(1);

    // Second run UPSERTs — still exactly one row.
    const res2 = await ingestIocs();
    expect(res2.ok).toBe(true);
    const r2 = await query<{ count: string }>(
      `SELECT count(*) AS count FROM aegis_iocs WHERE value = $1`,
      [VAL],
    );
    expect(Number(r2.rows[0]?.count)).toBe(1);

    vi.doUnmock('@/lib/data/collectors/threat-iocs');
  });

  it('updates last_seen and confidence on conflict', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/collectors/threat-iocs', () => ({
      fetchUrlhausIocs: async () => [
        { iocType: 'url', value: VAL, source: 'urlhaus', lastSeen: '2026-06-06', confidence: 0.5 },
      ],
      fetchMalwareBazaarSamples: async () => [],
      fetchThreatfoxIndicators: async () => [],
    }));
    let mod = await import('./ingest-iocs');
    await mod.ingestIocs();

    vi.resetModules();
    vi.doMock('@/lib/data/collectors/threat-iocs', () => ({
      fetchUrlhausIocs: async () => [
        { iocType: 'url', value: VAL, source: 'urlhaus', lastSeen: '2026-06-07', confidence: 0.99 },
      ],
      fetchMalwareBazaarSamples: async () => [],
      fetchThreatfoxIndicators: async () => [],
    }));
    mod = await import('./ingest-iocs');
    await mod.ingestIocs();

    const r = await query<{ confidence: number }>(
      `SELECT confidence FROM aegis_iocs WHERE value = $1`,
      [VAL],
    );
    expect(r.rows[0]?.confidence).toBe(0.99);

    vi.doUnmock('@/lib/data/collectors/threat-iocs');
  });
});
