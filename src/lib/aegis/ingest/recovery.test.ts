import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestCves } from './ingest-cves';
import { ingestThreatActors } from './ingest-threat-actors';
import { ingestProvenance } from './provenance';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  cursor: vi.fn(),
  record: vi.fn(),
  nvd: vi.fn(),
  groups: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock('./cursor', () => ({ getCursor: mocks.cursor, recordRun: mocks.record }));
vi.mock('./nvd-client', () => ({ fetchNvdWindow: mocks.nvd }));
vi.mock('@/lib/data/collectors/mitre-attack', () => ({ fetchMitreAttackGroups: mocks.groups }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T20:00:00Z'));
  mocks.query.mockResolvedValue({ rows: [{ inserted: true }] });
  mocks.queryOne.mockResolvedValue(null);
  mocks.nvd.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('database-backed feed recovery', () => {
  it('bootstraps an empty database despite an orphaned historical cursor', async () => {
    mocks.cursor.mockResolvedValue('2026-06-01T00:00:00Z');
    mocks.queryOne.mockResolvedValue({ present: false });
    expect((await ingestCves()).ok).toBe(true);
    expect(mocks.nvd).toHaveBeenCalledWith('2026-10-22T20:00:00.000Z', '2026-10-23T20:00:00.000Z');
    expect(mocks.record).toHaveBeenCalledWith(
      'cves',
      expect.objectContaining({ ok: true, cursor: '2026-10-23T20:00:00.000Z' }),
    );
  });

  it('keeps the cursor on upstream failure and bounds catch-up windows', async () => {
    mocks.cursor.mockResolvedValue('2026-06-01T00:00:00Z');
    mocks.queryOne.mockResolvedValue({ present: true });
    mocks.nvd.mockRejectedValue(new Error('nvd_http_429'));
    expect((await ingestCves()).ok).toBe(false);
    expect(mocks.nvd).toHaveBeenCalledWith('2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z');
    expect(mocks.record).toHaveBeenCalledWith('cves', {
      ok: false,
      count: 0,
      error: 'nvd_http_429',
    });
  });

  it('imports MITRE profiles using their acquisition time without inventing scores or activity', async () => {
    const fetchedAt = Date.now() - 3600_000;
    mocks.groups.mockResolvedValue([
      {
        actorId: 'G0001',
        mitreGroupId: 'G0001',
        displayName: 'Example',
        actorType: 'apt',
        lastActiveAt: '2026-10-23',
        references: ['https://attack.mitre.org/groups/G0001/'],
        _provenance: { state: 'live', fetchedAt, expiresAt: fetchedAt + 86400_000 },
      },
    ]);
    const result = await ingestThreatActors();
    expect(result).toEqual({ source: 'threat-actors', upserted: 1, ok: true });
    expect(mocks.record).toHaveBeenCalledWith('threat-actors', {
      count: 1,
      ok: true,
      acquiredAt: fetchedAt,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, values] = mocks.query.mock.calls[0]!;
    expect(sql).not.toMatch(/scores|last_active_at/);
    expect(values).not.toContain('2026-10-23');
  });

  it.each([{ groups: [] }, { groups: [{ actorId: 'G0001', _demo: true }] }])(
    'does not persist unavailable or demonstration groups',
    async ({ groups }) => {
      mocks.groups.mockResolvedValue(groups);
      expect((await ingestThreatActors()).ok).toBe(false);
      expect(mocks.query).not.toHaveBeenCalled();
      expect(mocks.record).toHaveBeenCalledWith(
        'threat-actors',
        expect.objectContaining({ ok: false }),
      );
    },
  );

  it('preserves source time across polls and marks old cursor coverage as stale', async () => {
    mocks.queryOne.mockResolvedValue({
      last_success_at: '2026-10-23 19:00:00',
      last_cursor: '2026-10-23T19:00:00Z',
      last_error: null,
    });
    const first = await ingestProvenance('cves');
    vi.setSystemTime(new Date('2026-10-23T20:30:00Z'));
    expect(await ingestProvenance('cves')).toEqual(first);
    expect(first.state).toBe('live');
    mocks.queryOne.mockResolvedValue({
      last_success_at: '2026-10-23 20:30:00',
      last_cursor: '2026-06-01T00:00:00Z',
      last_error: null,
    });
    expect((await ingestProvenance('cves')).state).toBe('stale');
  });

  it('shows unavailable without acquisition evidence and stale after an ingestion failure', async () => {
    expect((await ingestProvenance('threat-actors')).state).toBe('unavailable');
    mocks.queryOne.mockResolvedValue({
      last_success_at: '2026-10-23T19:00:00Z',
      last_error: 'source_down',
    });
    expect((await ingestProvenance('threat-actors')).state).toBe('stale');
  });
});
