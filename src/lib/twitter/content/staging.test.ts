/**
 * Integration tests for the staging chokepoint. Exercises the real DB
 * insert against `aegis_outbound_drafts`; mocks the audit + WS broadcast
 * side effects so we can assert they fire without depending on a live
 * audit pipeline or WS server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db/client';

// Mock audit + ws BEFORE importing staging.ts so it picks up the mocks.
const mockRecordAudit = vi.fn();
const mockBroadcast = vi.fn();

vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return {
    ...actual,
    recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
  };
});

vi.mock('@/lib/ws/server', () => ({
  broadcast: (...args: unknown[]) => mockBroadcast(...args),
}));

const { stageDraft } = await import('./staging');
const { DEFAULT_HASHTAG } = await import('./format');

const TEST_MARKER = 'test:staging-9.4';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

beforeEach(() => {
  mockRecordAudit.mockReset();
  mockBroadcast.mockReset();
  return cleanup();
});
afterEach(cleanup);

describe('stageDraft — happy path', () => {
  it('inserts a row, returns id, audits, and broadcasts', async () => {
    const result = await stageDraft({
      channel: 'twitter',
      draftType: 'daily_brief',
      agentMode: 'anchor',
      headline: 'Test headline',
      previewText: 'Test preview',
      draftPayload: {
        tweets: [{ text: `Hello world ${DEFAULT_HASHTAG}` }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      aiRelevance: 0.85,
      severity: 'high',
      createdBy: TEST_MARKER,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow

    expect(result.draftId).toBeGreaterThan(0);
    expect(mockRecordAudit).toHaveBeenCalledOnce();
    expect(mockBroadcast).toHaveBeenCalledOnce();
    expect(mockBroadcast).toHaveBeenCalledWith('alerts', 'outbound:draft_added', {
      id: result.draftId,
      channel: 'twitter',
      severity: 'high',
    });

    const { rows } = await query<{ status: string; channel: string; ai_relevance: string }>(
      `SELECT status, channel, ai_relevance FROM aegis_outbound_drafts WHERE id = $1`,
      [result.draftId],
    );
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.status).toBe('drafted');
    expect(rows[0]!.channel).toBe('twitter');
    expect(Number(rows[0]!.ai_relevance)).toBe(0.85);
  });
});

describe('stageDraft — invalid_payload guards', () => {
  it('rejects unknown channel', async () => {
    const r = await stageDraft({
      // @ts-expect-error — deliberate bad input for guard test
      channel: 'slack',
      draftType: 'daily_brief',
      agentMode: 'anchor',
      headline: 'h',
      previewText: 'p',
      draftPayload: {
        tweets: [{ text: `t ${DEFAULT_HASHTAG}` }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      createdBy: TEST_MARKER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_payload');
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('rejects empty headline', async () => {
    const r = await stageDraft({
      channel: 'twitter',
      draftType: 'daily_brief',
      agentMode: 'anchor',
      headline: '',
      previewText: 'p',
      draftPayload: {
        tweets: [{ text: `t ${DEFAULT_HASHTAG}` }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      createdBy: TEST_MARKER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_payload');
  });

  it('rejects ai_relevance out of range', async () => {
    const r = await stageDraft({
      channel: 'twitter',
      draftType: 'daily_brief',
      agentMode: 'anchor',
      headline: 'h',
      previewText: 'p',
      draftPayload: {
        tweets: [{ text: `t ${DEFAULT_HASHTAG}` }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      aiRelevance: 1.5,
      createdBy: TEST_MARKER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_payload');
  });

  it('rejects a ThreadDraft missing the canonical hashtag on T1', async () => {
    const r = await stageDraft({
      channel: 'twitter',
      draftType: 'daily_brief',
      agentMode: 'anchor',
      headline: 'h',
      previewText: 'p',
      draftPayload: { tweets: [{ text: 'no hashtag here' }], canonicalHashtag: DEFAULT_HASHTAG },
      createdBy: TEST_MARKER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_payload');
    expect(r.error).toMatch(/canonical hashtag/);
  });
});

describe('stageDraft — fire-and-forget side effects do not block success', () => {
  it('returns ok even if broadcast throws', async () => {
    mockBroadcast.mockImplementationOnce(() => {
      throw new Error('ws unavailable');
    });
    const r = await stageDraft({
      channel: 'twitter',
      draftType: 'breaking',
      agentMode: 'anchor',
      headline: 'h',
      previewText: 'p',
      draftPayload: {
        tweets: [{ text: `breaking ${DEFAULT_HASHTAG}` }],
        canonicalHashtag: DEFAULT_HASHTAG,
      },
      createdBy: TEST_MARKER,
    });
    expect(r.ok).toBe(true);
  });
});
