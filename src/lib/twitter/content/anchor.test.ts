/**
 * End-to-end tests for the anchor-mode generators (daily-brief + breaking).
 * Mocks the LLM module so we exercise the data assembly + staging path
 * deterministically. Seeds real rows in `aegis_pipeline_alerts` so the
 * SQL assemblers exercise their JOIN logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';
import { DEFAULT_HASHTAG } from './format';

// Mock the LLM wrapper BEFORE importing generators.
const mockGenerateThread = vi.fn();
vi.mock('./llm', () => ({
  generateThread: (...args: unknown[]) => mockGenerateThread(...args),
}));

// Mock audit + ws so we don't depend on a live audit pipeline or WS server.
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return { ...actual, recordAudit: vi.fn(async () => {}) };
});
vi.mock('@/lib/ws/server', () => ({ broadcast: vi.fn() }));

const { generateBreakingTweet, generateDailyBrief } = await import('./anchor');

const TEST_MARKER = 'test:anchor-9.4';

async function cleanup(): Promise<void> {
  // Drop alerts inserted by this suite (identified by a recognizable
  // headline prefix) and drafts created with the marker.
  await query(`DELETE FROM aegis_pipeline_alerts WHERE headline LIKE 'test-anchor-9.4 %'`);
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

async function seedAlert(opts: {
  severity: string;
  aiRelevance: number | null;
  headlineSuffix: string;
  entityId?: string;
  ageHours?: number;
}): Promise<number> {
  const publishedAt = new Date(Date.now() - (opts.ageHours ?? 1) * 3600 * 1000).toISOString();
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_pipeline_alerts
       (alert_type, entity_kind, entity_id, severity, headline, summary, published_at, ai_relevance)
     VALUES ('cve_disclosure', 'cve', $1, $2, $3, 'Test summary text', $4, $5)
     RETURNING id`,
    [
      opts.entityId ?? `TEST-CVE-${Math.floor(Math.random() * 1e9)}`,
      opts.severity,
      `test-anchor-9.4 ${opts.headlineSuffix}`,
      publishedAt,
      opts.aiRelevance,
    ],
  );
  return rows[0]!.id;
}

beforeEach(() => {
  mockGenerateThread.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('generateDailyBrief', () => {
  it('returns no_qualifying_items when fewer than 3 stories pass the threshold', async () => {
    await seedAlert({ severity: 'medium', aiRelevance: 0.1, headlineSuffix: 'low rel medium' });

    const r = await generateDailyBrief({ createdBy: TEST_MARKER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_qualifying_items');
    expect(mockGenerateThread).not.toHaveBeenCalled();
  });

  it('stages a draft when ≥3 AI-cyber stories qualify', async () => {
    await seedAlert({ severity: 'critical', aiRelevance: 0.9, headlineSuffix: 'apex' });
    await seedAlert({ severity: 'high', aiRelevance: 0.7, headlineSuffix: 'second' });
    await seedAlert({ severity: 'high', aiRelevance: 0.6, headlineSuffix: 'third' });

    mockGenerateThread.mockResolvedValueOnce({
      ok: true,
      draft: {
        tweets: [
          { text: `Daily AI Cyber Wire masthead ${DEFAULT_HASHTAG}` },
          { text: 'story 1 [CRITICAL]' },
          { text: 'story 2 [HIGH]' },
          { text: 'story 3 [HIGH]' },
          { text: 'CTA / closing 🧵 1/5' },
        ],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      rawJson: '...',
    });

    const r = await generateDailyBrief({ createdBy: TEST_MARKER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draftId).toBeGreaterThan(0);
    expect(r.tweetCount).toBe(5);
    expect(mockGenerateThread).toHaveBeenCalledOnce();

    // Verify the DB row landed as expected
    const { rows } = await query<{
      status: string;
      draft_type: string;
      agent_mode: string;
      ai_relevance: string;
      severity: string;
    }>(
      `SELECT status, draft_type, agent_mode, ai_relevance, severity
         FROM aegis_outbound_drafts WHERE id = $1`,
      [r.draftId],
    );
    expect(rows[0]!.status).toBe('drafted');
    expect(rows[0]!.draft_type).toBe('daily_brief');
    expect(rows[0]!.agent_mode).toBe('anchor');
    expect(Number(rows[0]!.ai_relevance)).toBe(0.9); // apex story's relevance
    expect(rows[0]!.severity).toBe('critical');
  });

  it('returns thread_validation_failed when the LLM omits the hashtag', async () => {
    await seedAlert({ severity: 'critical', aiRelevance: 0.9, headlineSuffix: 'a' });
    await seedAlert({ severity: 'high', aiRelevance: 0.7, headlineSuffix: 'b' });
    await seedAlert({ severity: 'high', aiRelevance: 0.6, headlineSuffix: 'c' });

    mockGenerateThread.mockResolvedValueOnce({
      ok: true,
      draft: {
        tweets: [{ text: 'masthead without the canonical hashtag' }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      rawJson: '...',
    });

    const r = await generateDailyBrief({ createdBy: TEST_MARKER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('thread_validation_failed');
  });

  it('propagates LLM failures without staging', async () => {
    await seedAlert({ severity: 'critical', aiRelevance: 0.9, headlineSuffix: 'a' });
    await seedAlert({ severity: 'high', aiRelevance: 0.7, headlineSuffix: 'b' });
    await seedAlert({ severity: 'high', aiRelevance: 0.6, headlineSuffix: 'c' });

    mockGenerateThread.mockResolvedValueOnce({
      ok: false,
      reason: 'llm_failed',
      details: 'simulated 503',
    });

    const r = await generateDailyBrief({ createdBy: TEST_MARKER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('llm_failed');

    const { rows } = await query(`SELECT id FROM aegis_outbound_drafts WHERE created_by = $1`, [
      TEST_MARKER,
    ]);
    expect(rows.length).toBe(0);
  });
});

describe('generateBreakingTweet', () => {
  it('returns no_qualifying_items for an unknown alert id', async () => {
    const r = await generateBreakingTweet({
      sourceAlertId: 999_999_999,
      createdBy: TEST_MARKER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_qualifying_items');
    expect(mockGenerateThread).not.toHaveBeenCalled();
  });

  it('stages a single-tweet draft when the alert exists', async () => {
    const alertId = await seedAlert({
      severity: 'critical',
      aiRelevance: 0.95,
      headlineSuffix: 'kev added',
    });
    mockGenerateThread.mockResolvedValueOnce({
      ok: true,
      draft: {
        tweets: [{ text: `[CRITICAL] Test breaking ${DEFAULT_HASHTAG}` }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      rawJson: '...',
    });

    const r = await generateBreakingTweet({ sourceAlertId: alertId, createdBy: TEST_MARKER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tweetCount).toBe(1);

    const { rows } = await query<{ draft_type: string; severity: string }>(
      `SELECT draft_type, severity FROM aegis_outbound_drafts WHERE id = $1`,
      [r.draftId],
    );
    expect(rows[0]!.draft_type).toBe('breaking');
    expect(rows[0]!.severity).toBe('critical');
  });

  it('rejects multi-tweet output for the breaking format', async () => {
    const alertId = await seedAlert({
      severity: 'critical',
      aiRelevance: 0.9,
      headlineSuffix: 'kev2',
    });
    // shape:'single' gives the model one count-fix retry before failing, so the
    // mock must answer both calls — keep returning the (wrong) 2-tweet draft.
    mockGenerateThread.mockResolvedValue({
      ok: true,
      draft: {
        tweets: [{ text: `t1 ${DEFAULT_HASHTAG}` }, { text: 't2' }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      rawJson: '...',
    });

    const r = await generateBreakingTweet({ sourceAlertId: alertId, createdBy: TEST_MARKER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('thread_validation_failed');
    expect(r.details).toMatch(/expected 1 tweet/);
  });
});
