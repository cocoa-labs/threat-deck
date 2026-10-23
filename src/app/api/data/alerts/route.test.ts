/**
 * Tests for the ALERTS board read window.
 *
 * Caught in live verification: the first cut read `Number(searchParams.get(...))`
 * and branched on `Number.isFinite`. `Number(null)` is 0, not NaN, so an absent
 * param looked like an explicit value and the default window NEVER applied —
 * the 2024 seed rows stayed on the board exactly as before. Assert the three
 * cases directly against the real database.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { GET } from './route';

const MARKER = 'test-alert-window';

interface AlertsResponse {
  data: { id: string; title?: string; createdAt: string }[];
  count: number;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_pipeline_alerts WHERE headline LIKE '${MARKER}%'`);
}

async function seed(suffix: string, publishedAt: string): Promise<void> {
  await query(
    `INSERT INTO aegis_pipeline_alerts
       (alert_type, entity_kind, entity_id, severity, headline, published_at, status)
     VALUES ('new_cve', 'cve', $1, 'high', $2, $3, 'new')`,
    [`CVE-WINDOW-${Math.floor(Math.random() * 1e9)}`, `${MARKER}-${suffix}`, publishedAt],
  );
}

async function get(qs: string): Promise<AlertsResponse> {
  const res = await GET(new Request(`http://localhost:3002/api/data/alerts${qs}`));
  return (await res.json()) as AlertsResponse;
}

const titles = (r: AlertsResponse) =>
  r.data.map((a) => a.title).filter((t): t is string => !!t?.startsWith(MARKER));

beforeEach(cleanup);
afterEach(cleanup);

describe('GET /api/data/alerts — recency window', () => {
  beforeEach(async () => {
    await seed('fresh', new Date(Date.now() - 3_600_000).toISOString()); // 1h ago
    await seed('ancient', '2024-05-30T00:00:00Z');
  });

  it('applies the default week window when no param is given', async () => {
    const found = titles(await get('?limit=200'));
    expect(found).toContain(`${MARKER}-fresh`);
    // The regression: this used to pass through and sit on the board forever.
    expect(found).not.toContain(`${MARKER}-ancient`);
  });

  it('honours an explicit narrower window', async () => {
    const found = titles(await get('?limit=200&since_hours=1'));
    expect(found).not.toContain(`${MARKER}-fresh`);
  });

  it('treats since_hours=0 as the archive view — no window at all', async () => {
    const found = titles(await get('?limit=200&since_hours=0'));
    expect(found).toContain(`${MARKER}-ancient`);
  });

  it('falls back to the default when the param is garbage', async () => {
    const found = titles(await get('?limit=200&since_hours=banana'));
    expect(found).toContain(`${MARKER}-fresh`);
    expect(found).not.toContain(`${MARKER}-ancient`);
  });
});
