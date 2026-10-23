import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

const PRESENT = 'CVE-2099-0001';
const ABSENT = 'CVE-2099-0002';

async function cleanup() {
  await query(`DELETE FROM aegis_kev WHERE cve_id = ANY($1)`, [[PRESENT, ABSENT]]);
  await query(`DELETE FROM aegis_cves WHERE cve_id = ANY($1)`, [[PRESENT, ABSENT]]);
}

beforeEach(async () => {
  await cleanup();
  await query(`INSERT INTO aegis_cves (cve_id, published_at) VALUES ($1, '2099-01-01 00:00:00')`, [
    PRESENT,
  ]);
});

afterEach(cleanup);

describe('ingestKev', () => {
  it('upserts KEV for present CVE, soft-skips absent', async () => {
    vi.resetModules();
    vi.doMock('@/lib/data/collectors/cve-feed', () => ({
      fetchKevCatalog: async () => [
        { cveId: PRESENT, addedToKevAt: '2099-02-01', vulnerabilityName: 'X' },
        { cveId: ABSENT, addedToKevAt: '2099-02-01', vulnerabilityName: 'Y' },
      ],
    }));
    const { ingestKev } = await import('./ingest-kev');
    const res = await ingestKev();
    expect(res.ok).toBe(true);

    const k = await query(`SELECT 1 FROM aegis_kev WHERE cve_id = $1`, [PRESENT]);
    expect(k.rowCount).toBe(1);

    const absent = await query(`SELECT 1 FROM aegis_kev WHERE cve_id = $1`, [ABSENT]);
    expect(absent.rowCount).toBe(0);

    // is_kev flip on the present CVE
    const flipped = await query<{ is_kev: boolean }>(
      `SELECT is_kev FROM aegis_cves WHERE cve_id = $1`,
      [PRESENT],
    );
    expect(flipped.rows[0]?.is_kev).toBe(true);

    vi.doUnmock('@/lib/data/collectors/cve-feed');
  });
});
