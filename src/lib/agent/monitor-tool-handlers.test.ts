/**
 * Tests for the watchlist agent tools, against the real database.
 *
 * The regression these lock down: `create_alert_rule` — the tool these replace
 * — returned `{ created: true, ...echo of its own input }` and wrote nothing,
 * so Max reported a monitoring rule that did not exist. Every assertion here is
 * about the tool telling the truth: it writes a real row when it says it did,
 * and it says `created: false` when it didn't.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { createMonitorTool, listMonitorsTool } from './tool-handlers';

const OPERATOR = 'monitor-tool-test@example.org';
const NAME_PREFIX = 'test-monitor-tools';

interface CreateResult {
  created: boolean;
  existing?: boolean;
  monitorId?: string;
  name?: string;
  keywords?: string[];
  severity?: string;
  sources?: string[];
  error?: string;
  summary: string;
}

interface ListResult {
  monitors: { id: string; name: string; keywords: string[]; enabled: boolean }[];
  total: number;
  summary: string;
}

async function cleanup(): Promise<void> {
  await query(`DELETE FROM monitors WHERE name LIKE '${NAME_PREFIX}%'`);
  await query('DELETE FROM users WHERE email = $1', [OPERATOR]);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('create_monitor', () => {
  it('writes a real row and reports it honestly', async () => {
    const result = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-fortinet`,
      keywords: ['fortinet', 'fortios'],
      severity: 'high',
      sources: ['cve', 'kev'],
    })) as CreateResult;

    expect(result.created).toBe(true);
    expect(result.monitorId).toBeTruthy();
    expect(result.keywords).toEqual(['fortinet', 'fortios']);
    expect(result.severity).toBe('high');
    expect(result.sources).toEqual(['cve', 'kev']);

    // The claim must be backed by an actual row — this is the whole point.
    const { rows } = await query<{ name: string; keywords: string[]; enabled: boolean }>(
      'SELECT name, keywords, enabled FROM monitors WHERE id = $1',
      [result.monitorId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(`${NAME_PREFIX}-fortinet`);
    expect(rows[0]?.enabled).toBe(true);
  });

  it('creates the owning user row on first touch (JWT sessions never do)', async () => {
    await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-owner`,
      keywords: ['x'],
    });

    const { rows } = await query<{ email: string }>('SELECT email FROM users WHERE email = $1', [
      OPERATOR,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('defaults severity to medium and scans all five feeds', async () => {
    const result = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-defaults`,
      keywords: ['lockbit'],
    })) as CreateResult;

    expect(result.severity).toBe('medium');
    expect(result.sources).toEqual(['cve', 'kev', 'breach', 'news', 'tweet']);
  });

  it('drops model-supplied sources and severities that are not in the vocab', async () => {
    const result = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-invalid`,
      keywords: ['x'],
      severity: 'apocalyptic',
      sources: ['cve', 'reddit', 'darkweb'],
    })) as CreateResult;

    expect(result.created).toBe(true);
    expect(result.severity).toBe('medium');
    expect(result.sources).toEqual(['cve']);
  });

  it('reports the existing monitor instead of stacking a duplicate name', async () => {
    const first = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-dupe`,
      keywords: ['citrix'],
    })) as CreateResult;

    const second = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-DUPE`, // case-insensitive
      keywords: ['citrix', 'netscaler'],
    })) as CreateResult;

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.monitorId).toBe(first.monitorId);
    expect(second.summary).toContain('ALREADY WATCHING');

    const { rows } = await query('SELECT id FROM monitors WHERE name ILIKE $1', [
      `${NAME_PREFIX}-dupe`,
    ]);
    expect(rows).toHaveLength(1);
  });

  it('refuses without an operator rather than writing an unowned row', async () => {
    const result = (await createMonitorTool({
      name: `${NAME_PREFIX}-noop`,
      keywords: ['x'],
    })) as CreateResult;

    expect(result.created).toBe(false);
    expect(result.error).toBe('no_operator');
    expect(result.summary).toContain('NOT CREATED');

    const { rows } = await query('SELECT id FROM monitors WHERE name = $1', [
      `${NAME_PREFIX}-noop`,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('refuses without keywords — an empty watch would never match anything', async () => {
    const result = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-nokw`,
      keywords: [],
    })) as CreateResult;

    expect(result.created).toBe(false);
    expect(result.error).toBe('missing_keywords');
  });

  it('refuses without a name', async () => {
    const result = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: '   ',
      keywords: ['x'],
    })) as CreateResult;

    expect(result.created).toBe(false);
    expect(result.error).toBe('missing_name');
  });

  it('ignores non-string keyword entries from a malformed tool call', async () => {
    const result = (await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-mixed`,
      keywords: ['okta', 42, null, '  ', 'auth0'],
    })) as CreateResult;

    expect(result.created).toBe(true);
    expect(result.keywords).toEqual(['okta', 'auth0']);
  });
});

describe('list_monitors', () => {
  it('returns the operator’s monitors', async () => {
    await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-a`,
      keywords: ['a'],
    });
    await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-b`,
      keywords: ['b'],
    });

    const result = (await listMonitorsTool({ operatorEmail: OPERATOR })) as ListResult;

    expect(result.total).toBe(2);
    expect(result.monitors.map((m) => m.name).sort()).toEqual([
      `${NAME_PREFIX}-a`,
      `${NAME_PREFIX}-b`,
    ]);
  });

  it('says so plainly when nothing is being watched', async () => {
    const result = (await listMonitorsTool({ operatorEmail: OPERATOR })) as ListResult;
    expect(result.total).toBe(0);
    expect(result.summary).toContain('No watchlist monitors');
  });

  it('returns empty without an operator rather than leaking another owner’s rows', async () => {
    await createMonitorTool({
      operatorEmail: OPERATOR,
      name: `${NAME_PREFIX}-owned`,
      keywords: ['x'],
    });

    const result = (await listMonitorsTool({})) as ListResult;
    expect(result.total).toBe(0);
    expect(result.monitors).toEqual([]);
  });
});
