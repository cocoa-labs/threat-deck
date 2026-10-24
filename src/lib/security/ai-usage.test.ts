import { describe, expect, it } from 'vitest';
import { AIUsageObserver, estimateAIReservation } from './ai-usage';

const request = { model: 'claude-sonnet-4-6' };
const usage = {
  input_tokens: 1000,
  output_tokens: 20,
  cache_creation_input_tokens: 1000,
  cache_read_input_tokens: 2000,
  cache_creation: { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 500 },
};
function jsonCost(value: unknown) {
  const observer = new AIUsageObserver('application/json', request);
  observer.push(new TextEncoder().encode(JSON.stringify(value)));
  observer.finish();
  return observer.cost();
}

describe('provider usage settlement', () => {
  it('charges reported tokens and cache usage rather than the requested output ceiling', () => {
    const cost = jsonCost({ type: 'message', model: request.model, usage });
    expect(cost).toBeCloseTo(0.008775, 8);
    expect(estimateAIReservation(request, 1000, 32768)).toBeCloseTo(0.61752, 6);
  });
  it('preserves arbitrary chunk boundaries and uses cumulative stream output only once', () => {
    const observer = new AIUsageObserver('text/event-stream', request);
    const events = [
      {
        type: 'message_start',
        message: { model: request.model, usage: { ...usage, output_tokens: 1 } },
      },
      { type: 'content_block_delta', delta: { text: 'café 世界' } },
      { type: 'message_delta', usage: { output_tokens: 10 } },
      { type: 'message_delta', usage: { output_tokens: 20 } },
      { type: 'message_stop' },
    ];
    const bytes = new TextEncoder().encode(
      events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''),
    );
    for (let i = 0; i < bytes.length; i++) observer.push(bytes.subarray(i, i + 1));
    observer.finish();
    expect(observer.cost()).toBeCloseTo(0.008775, 8);
  });
  it('retains the reservation when a stream is interrupted or reports an error', () => {
    for (const ending of ['', 'data: {"type":"error"}\n\ndata: {"type":"message_stop"}\n\n']) {
      const observer = new AIUsageObserver('text/event-stream', request);
      observer.push(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: 'message_start', message: { model: request.model, usage } })}\n\n${ending}`,
        ),
      );
      observer.finish();
      expect(observer.cost()).toBeUndefined();
    }
  });
  it.each([
    { type: 'message', model: 'unknown-model', usage },
    { type: 'message', model: request.model, usage: { input_tokens: 1 } },
    { type: 'message', model: request.model, usage: { ...usage, output_tokens: -1 } },
    {
      type: 'message',
      model: request.model,
      usage: { ...usage, server_tool_use: { web_search_requests: 1 } },
    },
  ])('does not invent a settled price for unknown usage: %j', (message) => {
    expect(jsonCost(message)).toBeUndefined();
  });
});
