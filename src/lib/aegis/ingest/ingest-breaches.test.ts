import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const URL = 'https://breach.test/disclosure-xyz';

async function cleanup() {
  await query(`DELETE FROM aegis_breach_disclosures WHERE source_url = $1`, [URL]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('ingestBreaches', () => {
  it('inserts on first run, app-dedups by source_url on second run', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/collectors/breach-feed', () => ({
      fetchHibpBreaches: async () => [
        {
          id: 1,
          disclosedAt: '2026-06-06T00:00:00Z',
          source: 'hibp',
          sourceUrl: URL,
          breachType: 'Email addresses; Passwords',
          recordsCompromised: 1_000_000,
          attestationQuality: 'high',
          notes: 'Synthetic breach for ingest test.',
        },
      ],
    }));
    const { ingestBreaches } = await import('./ingest-breaches');

    // First run inserts exactly one.
    const res1 = await ingestBreaches();
    expect(res1.ok).toBe(true);
    const r1 = await query<{ count: string }>(
      `SELECT count(*) AS count FROM aegis_breach_disclosures WHERE source_url = $1`,
      [URL],
    );
    expect(Number(r1.rows[0]?.count)).toBe(1);

    // Second run must NOT duplicate (no UNIQUE constraint → app-level dedup).
    const res2 = await ingestBreaches();
    expect(res2.ok).toBe(true);
    const r2 = await query<{ count: string }>(
      `SELECT count(*) AS count FROM aegis_breach_disclosures WHERE source_url = $1`,
      [URL],
    );
    expect(Number(r2.rows[0]?.count)).toBe(1);

    vi.doUnmock('@/lib/data/collectors/breach-feed');
  });

  it('skips a breach with an invalid disclosed_at', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/collectors/breach-feed', () => ({
      fetchHibpBreaches: async () => [
        {
          id: 1,
          disclosedAt: 'not-a-date',
          source: 'hibp',
          sourceUrl: URL,
          recordsCompromised: 5,
        },
      ],
    }));
    const { ingestBreaches } = await import('./ingest-breaches');

    const res = await ingestBreaches();
    expect(res.ok).toBe(true);
    const r = await query(`SELECT 1 FROM aegis_breach_disclosures WHERE source_url = $1`, [URL]);
    expect(r.rowCount).toBe(0);

    vi.doUnmock('@/lib/data/collectors/breach-feed');
  });
});
