/**
 * Tests for the watchlist match READ path.
 *
 * `monitor_match_log` was written from day one and its detail was never read:
 * `recentMonitorMatches()` had zero callers, so the operator could see that a
 * watchlist had N hits but never which items they were. These cover the reads
 * that surface them, the ownership scoping that protects them, and the
 * retention that bounds them.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import {
  createMonitor,
  pruneMonitorMatches,
  recentMatchesForOperator,
  recentMonitorMatches,
  recordMonitorMatch,
} from './monitors';
import { upsertUser } from './users';

const OWNER = 'match-read-owner@example.org';
const OTHER = 'match-read-other@example.org';
const NAME_PREFIX = 'test-match-read';

let ownerId = '';
let otherId = '';
let monitorId = '';

async function cleanup(): Promise<void> {
  // monitor_match_log cascades on monitors.
  await query(`DELETE FROM monitors WHERE name LIKE '${NAME_PREFIX}%'`);
  await query('DELETE FROM users WHERE email = ANY($1)', [[OWNER, OTHER]]);
}

beforeEach(async () => {
  await cleanup();
  ownerId = (await upsertUser({ email: OWNER })).id;
  otherId = (await upsertUser({ email: OTHER })).id;
  const monitor = await createMonitor({
    userId: ownerId,
    name: `${NAME_PREFIX}-fortinet`,
    keywords: ['fortinet'],
    severity: 'high',
    sources: ['news'],
  });
  monitorId = monitor.id;
});

afterEach(cleanup);

async function seedMatch(itemId: string, title: string): Promise<void> {
  const isNew = await recordMonitorMatch({
    monitorId,
    source: 'news',
    itemId,
    matchedKeyword: 'fortinet',
    itemTitle: title,
    itemUrl: `https://example.org/${itemId}`,
  });
  expect(isNew).toBe(true);
}

describe('recentMonitorMatches', () => {
  it('returns the recorded hits with their detail', async () => {
    await seedMatch('n1', 'Fortinet patches FortiOS');

    const rows = await recentMonitorMatches(monitorId, ownerId);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      monitor_name: `${NAME_PREFIX}-fortinet`,
      source: 'news',
      matched_keyword: 'fortinet',
      item_title: 'Fortinet patches FortiOS',
      item_url: 'https://example.org/n1',
    });
    // JSON-serializable (rule #1) — the route hands this straight to the client.
    expect(typeof rows[0]?.fired_at).toBe('string');
  });

  it('is owner-scoped — another operator cannot read these hits by id', async () => {
    await seedMatch('n1', 'Fortinet patches FortiOS');

    // The monitor id is a real, valid id; only the ownership join stops it.
    expect(await recentMonitorMatches(monitorId, otherId)).toEqual([]);
  });

  it('honours the limit', async () => {
    await seedMatch('n1', 'one');
    await seedMatch('n2', 'two');
    await seedMatch('n3', 'three');

    expect(await recentMonitorMatches(monitorId, ownerId, 2)).toHaveLength(2);
  });

  it('returns nothing for a watchlist that has never matched', async () => {
    expect(await recentMonitorMatches(monitorId, ownerId)).toEqual([]);
  });
});

describe('recentMatchesForOperator', () => {
  it('spans every watchlist the operator owns', async () => {
    await seedMatch('n1', 'Fortinet patches FortiOS');
    const second = await createMonitor({
      userId: ownerId,
      name: `${NAME_PREFIX}-citrix`,
      keywords: ['citrix'],
      severity: 'medium',
      sources: ['news'],
    });
    await recordMonitorMatch({
      monitorId: second.id,
      source: 'cve',
      itemId: 'CVE-2026-1',
      matchedKeyword: 'citrix',
      itemTitle: 'Citrix NetScaler flaw',
    });

    const rows = await recentMatchesForOperator(ownerId);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.monitor_name).sort()).toEqual([
      `${NAME_PREFIX}-citrix`,
      `${NAME_PREFIX}-fortinet`,
    ]);
  });

  it('never leaks another operator’s hits', async () => {
    await seedMatch('n1', 'Fortinet patches FortiOS');
    expect(await recentMatchesForOperator(otherId)).toEqual([]);
  });
});

describe('pruneMonitorMatches', () => {
  it('drops hits past the retention window and keeps recent ones', async () => {
    await seedMatch('recent', 'recent hit');
    await seedMatch('ancient', 'ancient hit');
    await query(
      `UPDATE monitor_match_log SET fired_at = NOW() - INTERVAL '200 days'
        WHERE monitor_id = $1 AND item_id = 'ancient'`,
      [monitorId],
    );

    const deleted = await pruneMonitorMatches(90);

    expect(deleted).toBeGreaterThanOrEqual(1);
    const remaining = await recentMonitorMatches(monitorId, ownerId);
    expect(remaining.map((r) => r.item_id)).toEqual(['recent']);
  });

  it('deletes nothing when everything is inside the window', async () => {
    await seedMatch('n1', 'recent hit');
    expect(await pruneMonitorMatches(90)).toBe(0);
  });
});
