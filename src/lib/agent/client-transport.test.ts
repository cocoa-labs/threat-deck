// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_MAX_OUTPUT_TOKENS } from '@/lib/security/ai-policy';
import { budgetedAIFetch } from '@/lib/security/budget';
import { invokeAgent, streamAgent } from './client';
import type { InvokeParams } from './types';

vi.unmock('@/lib/security/budget');
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({ db: { connect: mocks.connect, query: mocks.query } }));
vi.mock('@/lib/audit', () => ({ AUDIT_ACTIONS: {}, auditFailure: vi.fn() }));
vi.mock('./memory', () => ({
  MemoryManager: {
    load: async () => ({
      getState: () => ({}),
      getMessagesForAPI: () => [],
      completeExchange: mocks.complete,
    }),
  },
}));
vi.mock('./prompts', () => ({
  buildSystemPrompt: () => ({ staticBlock: 'Test', dynamicBlock: 'Test' }),
}));
vi.mock('./tool-registry', () => ({
  ToolRegistry: { getToolDefinitions: () => [], beginInvocation: vi.fn() },
}));

const params = {
  task: 'Synthetic request',
  trigger: 'user',
  userId: 'test-operator',
  context: {},
} as InvokeParams;
const message = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: 'LOCAL_OK' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 2, output_tokens: 2 },
};
function streamedResponse() {
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'LOCAL_OK' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 2 },
    },
    { type: 'message_stop' },
  ];
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-test-key');
  vi.stubEnv('ENABLE_AI', 'true');
  vi.stubEnv('ANTHROPIC_DAILY_CAP_USD', '50');
  mocks.query.mockResolvedValue({ rows: [{ spent: '0', active: '0' }] });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('agent → actual SDK → budget transport', () => {
  it.each([false, true])(
    'admits the standard agent output ceiling (streaming=%s)',
    async (streaming) => {
      const provider = vi.fn(async (_url, init) => {
        expect(JSON.parse(init.body).max_tokens).toBe(AI_MAX_OUTPUT_TOKENS);
        return streaming ? streamedResponse() : Response.json(message);
      });
      vi.stubGlobal('fetch', provider);
      if (streaming) {
        const events = await Array.fromAsync(streamAgent(params));
        expect(
          events
            .filter((e) => e.type === 'text')
            .map((e) => e.data)
            .join(''),
        ).toBe('LOCAL_OK');
        expect(events.at(-1)?.type).toBe('done');
      } else expect((await invokeAgent(params)).text).toBe('LOCAL_OK');
      expect(provider).toHaveBeenCalledTimes(1);
      expect(mocks.complete).toHaveBeenCalledTimes(1);
      expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('settled_usd = $2'), [
        expect.any(String),
        0.000036,
      ]);
      expect(mocks.query).toHaveBeenCalledWith(
        expect.stringContaining('released_at'),
        expect.any(Array),
      );
    },
  );

  it.each([
    ['budget_exceeded', { spent: '50', active: '0' }, /spending cap/],
    ['provider_concurrency_exceeded', { spent: '0', active: '4' }, /already running/],
  ])('reports %s once without SDK retries or a second stream failure', async (_code, row, text) => {
    mocks.query.mockResolvedValue({ rows: [row] });
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const events = await Array.fromAsync(streamAgent(params));
    expect(events).toEqual([
      { type: 'error', data: expect.stringMatching(text) },
      { type: 'done', data: '' },
    ]);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('fails closed with an actionable database error', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('synthetic database failure'));
    const provider = vi.fn();
    vi.stubGlobal('fetch', provider);
    const events = await Array.fromAsync(streamAgent(params));
    expect(events[0]?.data).toMatch(/budget checks are unavailable/);
    expect(provider).not.toHaveBeenCalled();
  });

  it('supports countTokens without exempting generation from admission', async () => {
    const provider = vi.fn(async () => Response.json({ input_tokens: 20 }));
    vi.stubGlobal('fetch', provider);
    const client = new Anthropic({
      apiKey: 'synthetic',
      fetch: budgetedAIFetch,
      maxRetries: 3,
      timeout: 600_000,
    });
    await expect(
      client.messages.countTokens({ model: 'test', messages: [{ role: 'user', content: 'Test' }] }),
    ).resolves.toEqual({ input_tokens: 20 });
    await expect(
      client.messages.create({ model: 'test', max_tokens: 64000, messages: [] }),
    ).rejects.toThrow('invalid_output_budget');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });
});

it('settles a provider rejection at zero before retrying', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: 'Synthetic rejection' } },
        { status: 400 },
      ),
    ),
  );
  const response = await budgetedAIFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100 }),
  });
  await response.text();
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('settled_usd = $2'), [
    expect.any(String),
    0,
  ]);
});
