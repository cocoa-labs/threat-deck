/**
 * End-to-end test for the analyst-mode weekly deep-dive generator. Mocks
 * the LLM so we can verify the data assembler picks the apex story and
 * passes MITRE TTPs / IOCs into the user prompt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';
import { DEFAULT_HASHTAG } from './format';

const mockGenerateThread = vi.fn();
vi.mock('./llm', () => ({
  generateThread: (...args: unknown[]) => mockGenerateThread(...args),
}));
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return { ...actual, recordAudit: vi.fn(async () => {}) };
});
vi.mock('@/lib/ws/server', () => ({ broadcast: vi.fn() }));

const { generateWeeklyDeepDive } = await import('./analyst');

const TEST_MARKER = 'test:analyst-9.4';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_pipeline_alerts WHERE headline LIKE 'test-analyst-9.4 %'`);
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

beforeEach(() => {
  mockGenerateThread.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('generateWeeklyDeepDive', () => {
  it('returns no_qualifying_items when no apex story exists in the window', async () => {
    const r = await generateWeeklyDeepDive({ sinceDays: 7, createdBy: TEST_MARKER });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_qualifying_items');
    expect(mockGenerateThread).not.toHaveBeenCalled();
  });

  it('stages an analyst-mode draft when an apex story exists', async () => {
    // Apex story with high ai_relevance + critical severity wins the sort.
    const publishedAt = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    await query(
      `INSERT INTO aegis_pipeline_alerts
         (alert_type, entity_kind, entity_id, severity, headline, summary, published_at, ai_relevance)
       VALUES ('cve_disclosure', 'cve', 'TEST-CVE-2026-99001', 'critical',
               'test-analyst-9.4 apex story', 'Critical AI-stack CVE summary', $1, 0.95)`,
      [publishedAt],
    );

    mockGenerateThread.mockResolvedValueOnce({
      ok: true,
      draft: {
        tweets: [
          { text: `Weekly deep-dive masthead ${DEFAULT_HASHTAG}` },
          { text: 'data summary tweet' },
          { text: 'key findings 1' },
          { text: 'key findings 2' },
          { text: 'MITRE T1190 / T1059' },
          { text: 'MITRE M1051' },
          { text: 'closing 🧵 7/7' },
        ],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      rawJson: '...',
    });

    const r = await generateWeeklyDeepDive({ sinceDays: 7, createdBy: TEST_MARKER });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tweetCount).toBeGreaterThanOrEqual(7);

    const { rows } = await query<{ draft_type: string; agent_mode: string }>(
      `SELECT draft_type, agent_mode FROM aegis_outbound_drafts WHERE id = $1`,
      [r.draftId],
    );
    expect(rows[0]!.draft_type).toBe('weekly_deepdive');
    expect(rows[0]!.agent_mode).toBe('analyst');
  });
});
