/**
 * Tests for the Anthropic SDK wrapper used by all four generators.
 * Mocks the SDK so we exercise the JSON-extraction + shape-validation paths
 * without burning API budget.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Anthropic SDK module BEFORE importing the wrapper.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  },
}));

// Mock audit so we don't need a live DB for parse-failure paths.
vi.mock('@/lib/audit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit')>('@/lib/audit');
  return {
    ...actual,
    recordAudit: vi.fn(async () => {}),
  };
});

const { generateThread } = await import('./llm');

const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  }
});

describe('generateThread — happy path', () => {
  it('parses pure JSON response into a ThreadDraft', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            tweets: [
              { text: 'masthead #AICyber', link: 'https://example.com' },
              { text: 'second tweet 🧵 1/2' },
            ],
            canonicalHashtag: '#AICyber',
          }),
        },
      ],
    });

    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.tweets).toHaveLength(2);
    expect(r.draft.tweets[0]!.text).toBe('masthead #AICyber');
    expect(r.draft.tweets[0]!.link).toBe('https://example.com');
    expect(r.draft.canonicalHashtag).toBe('#AICyber');
  });

  it('strips ```json fences if the model wraps the response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '```json\n{"tweets":[{"text":"hello"}],"canonicalHashtag":"#AICyber"}\n```',
        },
      ],
    });

    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });

    expect(r.ok).toBe(true);
  });
});

describe('generateThread — failure paths', () => {
  it('returns llm_failed when ANTHROPIC_API_KEY is unset', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('llm_failed');
    expect(r.details).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('returns llm_failed on SDK error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('upstream 503'));
    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('llm_failed');
    expect(r.details).toMatch(/upstream 503/);
  });

  it('returns llm_invalid_output on empty response', async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '' }] });
    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('llm_invalid_output');
  });

  it('returns llm_invalid_output on malformed JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'this is not JSON at all' }],
    });
    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('llm_invalid_output');
  });

  it('returns llm_invalid_output when tweets array is missing', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"canonicalHashtag":"#AICyber"}' }],
    });
    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('llm_invalid_output');
  });

  it('returns llm_invalid_output when a tweet has empty text', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '{"tweets":[{"text":""}],"canonicalHashtag":"#AICyber"}',
        },
      ],
    });
    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('llm_invalid_output');
  });
});

describe('generateThread — link sanitization', () => {
  it('drops non-http link values silently (model hallucinated)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '{"tweets":[{"text":"hello #AICyber","link":"javascript:alert(1)"}],"canonicalHashtag":"#AICyber"}',
        },
      ],
    });
    const r = await generateThread({
      systemPrompt: 'sys',
      userPrompt: 'usr',
      maxTokens: 200,
      draftType: 'daily_brief',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.tweets[0]!.link).toBeUndefined();
  });
});
