/**
 * Tests for the post_to_x agent-tool handler. After the Phase-14.x rewrite the
 * handler COMPOSES (via the shared Cyber Wire composer) and STAGES a draft in
 * the approval queue — it never posts. We mock the composer, stageDraft, and
 * the media-resolution query to exercise the staging logic in isolation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadDraft } from '@/lib/twitter/content';

const mockCompose = vi.fn();
const mockStage = vi.fn();
const mockQuery = vi.fn();

vi.mock('@/lib/twitter/content', () => ({
  composeThread: (...a: unknown[]) => mockCompose(...a),
  buildXThreadDirective: () => 'DIRECTIVE',
  stageDraft: (...a: unknown[]) => mockStage(...a),
  GENERAL_POST_SYSTEM: 'GENERAL_POST_SYSTEM',
}));
vi.mock('@/lib/db/client', () => ({ query: (...a: unknown[]) => mockQuery(...a) }));
vi.mock('@/lib/audit', () => ({ AUDIT_ACTIONS: {}, recordAudit: vi.fn() }));

const { postToX } = await import('./outbound-tool-handlers');

function thread(n: number): ThreadDraft {
  return {
    tweets: Array.from({ length: n }, (_, i) => ({
      text: i === 0 ? 'Masthead observation #AICyber' : `Tweet ${i + 1}`,
    })),
    canonicalHashtag: '#AICyber',
  };
}

function rows(value: unknown[]): { rows: unknown[]; rowCount: number } {
  return { rows: value, rowCount: value.length };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStage.mockResolvedValue({ ok: true, draftId: 42 });
});

describe('postToX (composes + stages a draft for approval)', () => {
  it('requires content', async () => {
    const r = await postToX({});
    expect(r).toMatchObject({ ok: false, posted: false, error: 'empty_content' });
    expect(mockCompose).not.toHaveBeenCalled();
    expect(mockStage).not.toHaveBeenCalled();
  });

  it('composes + stages a 5-tweet thread (never posts)', async () => {
    mockCompose.mockResolvedValueOnce({ ok: true, draft: thread(5) });

    const r = await postToX({ content: 'the day in cyber', shape: 'thread', tweetCount: 5 });

    expect(r.ok).toBe(true);
    expect(r.posted).toBe(false);
    expect(r.tweetIds).toEqual([]);
    expect(r.summary).toMatch(/staged/i);

    expect(mockCompose).toHaveBeenCalledTimes(1);
    expect(mockCompose.mock.calls[0]![0]).toMatchObject({
      shape: 'thread',
      tweetCount: 5,
      draftType: 'agent_post',
      // The conversational path uses the topic-agnostic general prompt so it
      // posts ANY brief (markets/macro/mixed) in-voice instead of refusing.
      systemPrompt: 'GENERAL_POST_SYSTEM',
    });

    expect(mockStage).toHaveBeenCalledTimes(1);
    const stageArg = mockStage.mock.calls[0]![0];
    expect(stageArg).toMatchObject({
      channel: 'twitter',
      draftType: 'agent_post',
      agentMode: 'anchor',
    });
    expect(stageArg.draftPayload.tweets).toHaveLength(5);
  });

  it('stages a single voiced post for shape=single', async () => {
    mockCompose.mockResolvedValueOnce({ ok: true, draft: thread(1) });
    const r = await postToX({ content: 'this one CVE', shape: 'single' });
    expect(r.ok).toBe(true);
    expect(mockCompose.mock.calls[0]![0]).toMatchObject({ shape: 'single' });
    expect(mockStage.mock.calls[0]![0].draftPayload.tweets).toHaveLength(1);
  });

  it('always uses the general prompt but records the requested mode on the draft', async () => {
    mockCompose.mockResolvedValueOnce({ ok: true, draft: thread(8) });
    await postToX({ content: 'deep dive', shape: 'thread', mode: 'analyst' });
    expect(mockCompose.mock.calls[0]![0].systemPrompt).toBe('GENERAL_POST_SYSTEM');
    expect(mockStage.mock.calls[0]![0].agentMode).toBe('analyst');
  });

  it('attaches a ready media id to the draft (rides the final tweet)', async () => {
    mockCompose.mockResolvedValueOnce({ ok: true, draft: thread(3) });
    mockQuery.mockResolvedValueOnce(
      rows([{ id: '50', media_kind: 'image', blob_url: 'https://b/i.png', status: 'ready' }]),
    );

    const r = await postToX({ content: 'x', shape: 'thread', tweetCount: 3, attachMediaId: '50' });

    expect(r.ok).toBe(true);
    expect(r.mediaKind).toBe('image');
    const draft = mockStage.mock.calls[0]![0].draftPayload;
    expect(draft.mediaId).toBe('50');
    expect(draft.mediaKind).toBe('image');
  });

  it('stages without media (with a note) when the media is not ready', async () => {
    mockCompose.mockResolvedValueOnce({ ok: true, draft: thread(3) });
    mockQuery.mockResolvedValueOnce(rows([])); // not found / not ready

    const r = await postToX({ content: 'x', shape: 'thread', tweetCount: 3, attachMediaId: '999' });

    expect(r.ok).toBe(true);
    expect(mockStage.mock.calls[0]![0].draftPayload.mediaId).toBeUndefined();
    expect(r.summary).toMatch(/isn't ready/i);
  });

  it('does not stage when composition fails', async () => {
    mockCompose.mockResolvedValueOnce({ ok: false, reason: 'llm_failed', details: 'timeout' });
    const r = await postToX({ content: 'x', shape: 'thread', tweetCount: 3 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('llm_failed');
    expect(mockStage).not.toHaveBeenCalled();
  });
});
