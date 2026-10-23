import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { _upsertCveRowForTests } from './ingest-cves';

const ID = 'CVE-2099-99999';
async function cleanup() {
  await query(`DELETE FROM aegis_cves WHERE cve_id = $1`, [ID]);
}
beforeEach(cleanup);
afterEach(cleanup);

describe('_upsertCveRowForTests', () => {
  it('inserts then updates idempotently', async () => {
    const inserted = await _upsertCveRowForTests({
      cveId: ID,
      publishedAt: '2099-01-01T00:00:00.000',
      lastModifiedAt: '2099-01-02T00:00:00.000',
      summary: 'test',
      cweId: 'CWE-79',
      score: 9.8,
      vector: 'AV:N',
      severity: 'critical',
      sourceUrl: 'x',
    });
    expect(inserted).toBe(true);
    const again = await _upsertCveRowForTests({
      cveId: ID,
      publishedAt: '2099-01-01T00:00:00.000',
      lastModifiedAt: '2099-01-03T00:00:00.000',
      summary: 'test2',
      cweId: 'CWE-79',
      score: 9.8,
      vector: 'AV:N',
      severity: 'critical',
      sourceUrl: 'x',
    });
    expect(again).toBe(false); // update, not insert
    const row = await query<{ summary: string }>(
      `SELECT summary FROM aegis_cves WHERE cve_id = $1`,
      [ID],
    );
    expect(row.rows[0]?.summary).toBe('test2');
  });
});
