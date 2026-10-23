/**
 * Round-trip tests for the alert spine against the real database.
 *
 * Follows the seed-and-clean pattern in
 * `src/app/feed/cyber-wire.rss/route.test.ts` — a marker in the headline scopes
 * every row this file creates so cleanup can't touch real alerts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import {
  insertPipelineAlert,
  listPipelineAlerts,
  setPipelineAlertStatus,
  updatePipelineAlert,
} from './pipeline-alerts';

const MARKER = 'test-spine-alerts';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_pipeline_alerts WHERE headline LIKE '${MARKER}%'`);
}

async function seed(overrides?: {
  severity?: string;
  entityId?: string;
  suffix?: string;
}): Promise<number> {
  const inserted = await insertPipelineAlert({
    alertType: 'new_kev',
    entityKind: 'cve',
    entityId: overrides?.entityId ?? `CVE-TEST-${Math.floor(Math.random() * 1e9)}`,
    severity: overrides?.severity ?? 'critical',
    headline: `${MARKER}${overrides?.suffix ?? ''}`,
  });
  expect(inserted).not.toBeNull();
  return (inserted as { id: number }).id;
}

beforeEach(cleanup);
afterEach(cleanup);

describe('pipeline-alerts round trip', () => {
  it('inserts an alert as status=new and reads it back on the active board', async () => {
    const id = await seed({ suffix: '-basic' });

    const rows = await listPipelineAlerts({ limit: 200 });
    const found = rows.find((r) => r.id === id);

    expect(found).toBeDefined();
    expect(found?.status).toBe('new');
    expect(found?.alert_type).toBe('new_kev');
    expect(found?.severity).toBe('critical');
    // published_at is cast back to text so API responses stay serializable.
    expect(typeof found?.published_at).toBe('string');
  });

  it('enriches an existing alert with the agent summary without losing the headline', async () => {
    const id = await seed({ suffix: '-enrich' });

    await updatePipelineAlert(id, { summary: 'CISA added it to the catalogue.' });

    const found = (await listPipelineAlerts({ limit: 200 })).find((r) => r.id === id);
    expect(found?.summary).toBe('CISA added it to the catalogue.');
    expect(found?.headline).toBe(`${MARKER}-enrich`);
  });

  it('is a no-op when the patch has no fields', async () => {
    const id = await seed({ suffix: '-noop' });
    await updatePipelineAlert(id, {});
    const found = (await listPipelineAlerts({ limit: 200 })).find((r) => r.id === id);
    expect(found?.headline).toBe(`${MARKER}-noop`);
  });

  it('acknowledging moves the alert to triaging and stamps triaged_at', async () => {
    const id = await seed({ suffix: '-ack' });

    const updated = await setPipelineAlertStatus(id, 'triaging');
    expect(updated?.status).toBe('triaging');

    const { rows } = await query<{ triaged_at: string | null }>(
      'SELECT triaged_at FROM aegis_pipeline_alerts WHERE id = $1',
      [id],
    );
    expect(rows[0]?.triaged_at).not.toBeNull();
  });

  it('drops resolved alerts off the default board but keeps them queryable', async () => {
    const id = await seed({ suffix: '-resolved' });
    await setPipelineAlertStatus(id, 'resolved');

    const active = await listPipelineAlerts({ limit: 200 });
    expect(active.find((r) => r.id === id)).toBeUndefined();

    const withResolved = await listPipelineAlerts({ statuses: ['resolved'], limit: 200 });
    expect(withResolved.find((r) => r.id === id)).toBeDefined();
  });

  it('filters by severity', async () => {
    const critical = await seed({ severity: 'critical', suffix: '-crit' });
    const medium = await seed({ severity: 'medium', suffix: '-med' });

    const rows = await listPipelineAlerts({ severities: ['critical'], limit: 200 });
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(critical);
    expect(ids).not.toContain(medium);
  });

  it('returns null rather than throwing when the status target does not exist', async () => {
    expect(await setPipelineAlertStatus(-1, 'triaging')).toBeNull();
  });

  // The client watchers re-diff their feed on every poll, so the same advisory
  // resurfaces as "new" minutes later. Without this the ALERTS board stacks the
  // same alert three times in ten minutes — observed in live data.
  it('reuses the existing row for the same entity instead of duplicating it', async () => {
    const entityId = `CVE-TEST-DEDUP-${Math.floor(Math.random() * 1e9)}`;

    const first = await insertPipelineAlert({
      alertType: 'new_kev',
      entityKind: 'cve',
      entityId,
      severity: 'critical',
      headline: `${MARKER}-dedup`,
    });
    const second = await insertPipelineAlert({
      alertType: 'new_kev',
      entityKind: 'cve',
      entityId,
      severity: 'critical',
      headline: `${MARKER}-dedup-again`,
    });

    expect(first?.created).toBe(true);
    expect(second?.created).toBe(false);
    // Same id back, so the KEV → breaking-tweet gate still has an alert_id.
    expect(second?.id).toBe(first?.id);

    const rows = await listPipelineAlerts({ limit: 200 });
    expect(rows.filter((r) => r.entity_id === entityId)).toHaveLength(1);
  });

  it('does not dedup across different alert types or entity kinds', async () => {
    const entityId = `CVE-TEST-KINDS-${Math.floor(Math.random() * 1e9)}`;
    const base = {
      entityId,
      severity: 'high',
      headline: `${MARKER}-kinds`,
    };

    const a = await insertPipelineAlert({ ...base, alertType: 'new_kev', entityKind: 'cve' });
    const b = await insertPipelineAlert({ ...base, alertType: 'new_patch', entityKind: 'cve' });
    const c = await insertPipelineAlert({ ...base, alertType: 'new_kev', entityKind: 'advisory' });

    expect(a?.created).toBe(true);
    expect(b?.created).toBe(true);
    expect(c?.created).toBe(true);
    expect(new Set([a?.id, b?.id, c?.id]).size).toBe(3);
  });
});
