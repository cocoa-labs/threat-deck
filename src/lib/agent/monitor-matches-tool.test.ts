/**
 * Tests for `get_monitor_matches`.
 *
 * The MONITORS panel has always offered "what has my X watchlist caught?" as a
 * click-to-agent action while Max had no tool that could read
 * `monitor_match_log` — so it answered from the raw catalogue instead of from
 * what actually matched. These lock in that the tool reads real hits, resolves
 * a watchlist by NAME (the operator says "Fortinet", not a UUID), and says
 * nothing-matched plainly rather than returning a plausible-looking empty shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { createMonitor, recordMonitorMatch } from '@/lib/db/queries/monitors';
import { upsertUser } from '@/lib/db/queries/users';
import { getMonitorMatchesTool } from './tool-handlers';

const OPERATOR = 'match-tool@example.org';
const NAME_PREFIX = 'test-match-tool';

interface ToolResult {
  matches: {
    monitor: string;
    matchedKeyword: string | null;
    source: string;
    title: string | null;
    sourceUrl: string | null;
  }[];
  total: number;
  scope?: string;
  error?: string;
  available?: string[];
  summary: string;
}

let monitorId = '';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM monitors WHERE name LIKE '${NAME_PREFIX}%'`);
  await query('DELETE FROM users WHERE email = $1', [OPERATOR]);
}

beforeEach(async () => {
  await cleanup();
  const user = await upsertUser({ email: OPERATOR });
  const monitor = await createMonitor({
    userId: user.id,
    name: `${NAME_PREFIX} Fortinet exposure`,
    keywords: ['fortinet'],
    severity: 'high',
    sources: ['news'],
  });
  monitorId = monitor.id;
  await recordMonitorMatch({
    monitorId,
    source: 'news',
    itemId: 'n1',
    matchedKeyword: 'fortinet',
    itemTitle: 'Fortinet patches FortiOS',
    itemUrl: 'https://example.org/fortinet',
  });
});

afterEach(cleanup);

describe('get_monitor_matches', () => {
  it('returns real recorded hits with a citable source url', async () => {
    const r = (await getMonitorMatchesTool({ operatorEmail: OPERATOR })) as ToolResult;

    expect(r.total).toBe(1);
    expect(r.matches[0]).toMatchObject({
      matchedKeyword: 'fortinet',
      source: 'news',
      title: 'Fortinet patches FortiOS',
      sourceUrl: 'https://example.org/fortinet',
    });
  });

  it('resolves a watchlist by partial name, not just by id', async () => {
    const byPartial = (await getMonitorMatchesTool({
      operatorEmail: OPERATOR,
      monitor: 'fortinet',
    })) as ToolResult;
    const byId = (await getMonitorMatchesTool({
      operatorEmail: OPERATOR,
      monitor: monitorId,
    })) as ToolResult;

    expect(byPartial.total).toBe(1);
    expect(byId.total).toBe(1);
    expect(byPartial.scope).toContain('Fortinet exposure');
  });

  it('names the watchlists that DO exist when the requested one does not', async () => {
    const r = (await getMonitorMatchesTool({
      operatorEmail: OPERATOR,
      monitor: 'palo alto',
    })) as ToolResult;

    expect(r.error).toBe('unknown_monitor');
    expect(r.total).toBe(0);
    expect(r.available?.[0]).toContain('Fortinet exposure');
    // The agent must be able to say what the operator actually has.
    expect(r.summary).toContain('Fortinet exposure');
  });

  it('says nothing matched plainly rather than implying activity', async () => {
    await query(`DELETE FROM monitor_match_log WHERE monitor_id = $1`, [monitorId]);

    const r = (await getMonitorMatchesTool({
      operatorEmail: OPERATOR,
      monitor: 'fortinet',
    })) as ToolResult;

    expect(r.total).toBe(0);
    expect(r.summary).toContain('No recorded hits');
  });

  it('refuses without an operator rather than reading someone else’s watchlists', async () => {
    const r = (await getMonitorMatchesTool({})) as ToolResult;
    expect(r.total).toBe(0);
    expect(r.matches).toEqual([]);
    expect(r.summary).toContain('No signed-in operator');
  });

  it('caps the limit', async () => {
    const r = (await getMonitorMatchesTool({
      operatorEmail: OPERATOR,
      limit: 5_000,
    })) as ToolResult;
    // Only one hit exists; the point is it does not throw on an absurd limit.
    expect(r.total).toBe(1);
  });
});
