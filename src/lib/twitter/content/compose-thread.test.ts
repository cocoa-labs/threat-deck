import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./llm', () => ({ generateThread: vi.fn() }));

import { buildXThreadDirective, composeThread } from './compose-thread';
import { generateThread } from './llm';
import type { ThreadDraft } from './types';

const mockGenerate = vi.mocked(generateThread);

function thread(n: number): ThreadDraft {
  const tweets = Array.from({ length: n }, (_, i) => ({
    text: i === 0 ? 'Masthead observation #AICyber' : `Tweet ${i + 1} body`,
  }));
  return { tweets, canonicalHashtag: '#AICyber' };
}

function genOk(draft: ThreadDraft) {
  return { ok: true as const, draft, rawJson: JSON.stringify(draft) };
}

beforeEach(() => {
  mockGenerate.mockReset();
});

describe('composeThread', () => {
  it('composes a thread of the requested tweet count', async () => {
    mockGenerate.mockResolvedValueOnce(genOk(thread(5)));
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'thread',
      tweetCount: 5,
      maxTokens: 1000,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.draft.tweets).toHaveLength(5);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('retries once when the model returns the wrong tweet count', async () => {
    mockGenerate.mockResolvedValueOnce(genOk(thread(4))).mockResolvedValueOnce(genOk(thread(5)));
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'thread',
      tweetCount: 5,
      maxTokens: 1000,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.draft.tweets).toHaveLength(5);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('enforces a single tweet for shape=single', async () => {
    mockGenerate.mockResolvedValueOnce(genOk(thread(1)));
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'single',
      maxTokens: 320,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.draft.tweets).toHaveLength(1);
  });

  it('fails when the count is still wrong after the retry', async () => {
    mockGenerate.mockResolvedValue(genOk(thread(3))); // always 3, asked for 5
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'thread',
      tweetCount: 5,
      maxTokens: 1000,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('thread_validation_failed');
      expect(res.details).toMatch(/expected 5/);
    }
  });

  it('does not enforce a count for an autonomous thread (no tweetCount)', async () => {
    mockGenerate.mockResolvedValueOnce(genOk(thread(7)));
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'thread',
      maxTokens: 1200,
      draftType: 'daily_brief',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.draft.tweets).toHaveLength(7);
    expect(mockGenerate).toHaveBeenCalledTimes(1); // no count-fix retry
  });

  it('propagates an LLM failure', async () => {
    mockGenerate.mockResolvedValueOnce({ ok: false, reason: 'llm_failed', details: 'timeout' });
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'thread',
      tweetCount: 3,
      maxTokens: 1000,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('llm_failed');
  });

  it('retries with a JSON-only re-instruction when the first attempt returns no JSON, then succeeds', async () => {
    // Models sometimes refuse / emit prose instead of JSON (e.g. "no infosec
    // content in this brief"). The composer must re-instruct forcefully, not
    // hard-fail with an opaque parse error.
    mockGenerate
      .mockResolvedValueOnce({
        ok: false,
        reason: 'llm_invalid_output',
        details: 'failed to parse ThreadDraft JSON',
      })
      .mockResolvedValueOnce(genOk(thread(1)));
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'a markets-only brief with no cyber content',
      shape: 'single',
      maxTokens: 1000,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(true);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(String(mockGenerate.mock.calls[1]?.[0].userPrompt)).toMatch(/ONLY the JSON/i);
  });

  it('returns a clear, actionable failure when the model never returns JSON', async () => {
    mockGenerate.mockResolvedValue({
      ok: false,
      reason: 'llm_invalid_output',
      details: 'failed to parse ThreadDraft JSON',
    });
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'single',
      maxTokens: 1000,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(2); // exactly one JSON-retry
    if (!res.ok) {
      expect(res.reason).toBe('llm_invalid_output');
      expect(res.details).toMatch(/rephras/i);
    }
  });

  it('does NOT JSON-retry on a hard llm_failed (API error / timeout)', async () => {
    mockGenerate.mockResolvedValueOnce({ ok: false, reason: 'llm_failed', details: 'timeout' });
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'single',
      maxTokens: 1000,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(false);
    expect(mockGenerate).toHaveBeenCalledTimes(1); // no JSON-retry — it's an API failure, not a format one
  });

  it('propagates a validation failure (missing hashtag on T1)', async () => {
    const bad: ThreadDraft = {
      tweets: [{ text: 'no hashtag on this tweet' }],
      canonicalHashtag: '#AICyber',
    };
    mockGenerate.mockResolvedValueOnce(genOk(bad));
    const res = await composeThread({
      systemPrompt: 'SYS',
      contextBlock: 'CTX',
      shape: 'single',
      maxTokens: 320,
      draftType: 'agent_post',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('thread_validation_failed');
  });
});

describe('buildXThreadDirective', () => {
  it('thread with a count names the prose tweets and the closing tweet', () => {
    const d = buildXThreadDirective('thread', 5);
    expect(d).toMatch(/EXACTLY 5/);
    expect(d).toMatch(/1 through 4/);
    expect(d).toMatch(/🧵 5\/5/);
  });

  it('single asks for one tweet', () => {
    expect(buildXThreadDirective('single')).toMatch(/SINGLE tweet/);
  });

  it('thread without a count sizes to the stories (5-7)', () => {
    expect(buildXThreadDirective('thread')).toMatch(/5-7/);
  });
});
