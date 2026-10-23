import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { getCursor, recordRun } from './cursor';

const SRC = 'cves_test';
async function cleanup() {
  await query(`DELETE FROM aegis_ingest_runs WHERE source = $1`, [SRC]);
}
beforeEach(cleanup);
afterEach(cleanup);

describe('cursor', () => {
  it('returns null cursor for unseen source', async () => {
    expect(await getCursor(SRC)).toBeNull();
  });
  it('records a run and reads back the cursor', async () => {
    await recordRun(SRC, { cursor: '2026-06-06T00:00:00.000Z', count: 5, ok: true });
    expect(await getCursor(SRC)).toBe('2026-06-06T00:00:00.000Z');
  });
});
