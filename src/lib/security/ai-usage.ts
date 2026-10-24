/** Prices for the shipped models, USD per million tokens (2026-10-23).
 * https://platform.claude.com/docs/en/about-claude/pricing
 * Unknown models keep their admission estimate instead of claiming precise usage.
 */
interface AIRequest {
  model?: string;
  inference_geo?: string;
  speed?: string;
}

function modelPrice(model: unknown): { input: number; output: number } | undefined {
  if (typeof model !== 'string') return undefined;
  if (/^claude-sonnet-4-[56](?:-\d{8})?$/.test(model)) return { input: 3, output: 15 };
  if (/^claude-haiku-4-5(?:-\d{8})?$/.test(model)) return { input: 1, output: 5 };
  if (/^claude-opus-4-[5-8](?:-\d{8})?$/.test(model)) return { input: 5, output: 25 };
  return undefined;
}

function multiplier(request: AIRequest): number {
  return (request.inference_geo === 'us' ? 1.1 : 1) * (request.speed === 'fast' ? 6 : 1);
}

export function estimateAIReservation(request: AIRequest, bytes: number, output: number): number {
  const price = modelPrice(request.model) ?? { input: 30, output: 150 };
  // Bytes bound ordinary text tokens. Allow image/tool overhead and 1h cache writes.
  return Math.max(
    0.000001,
    (((bytes + 20_000) * price.input * 2 + output * price.output) * multiplier(request)) /
      1_000_000,
  );
}

function tokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Observe provider usage without changing or delaying any streamed content.
 * The caller bounds the entire response to 16 MiB. Partial/malformed responses
 * retain the reservation; cumulative SSE usage is merged, never summed.
 */
export class AIUsageObserver {
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private usage: Record<string, unknown> = {};
  private model: unknown;
  private complete = false;
  private invalid = false;
  private readonly streaming: boolean;

  constructor(
    contentType: string,
    private readonly request: AIRequest,
  ) {
    this.streaming = contentType.includes('text/event-stream');
    this.model = request.model;
  }

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    if (this.streaming) this.lines();
  }

  private lines(): void {
    let end = this.buffer.indexOf('\n');
    while (end >= 0) {
      const line = this.buffer.slice(0, end).trimEnd();
      this.buffer = this.buffer.slice(end + 1);
      if (line.startsWith('data:')) this.parse(line.slice(5).trim());
      end = this.buffer.indexOf('\n');
    }
  }

  private parse(text: string): void {
    try {
      const event = JSON.parse(text);
      if (event.type === 'error') this.invalid = true;
      if (event.type === 'message_stop') this.complete = true;
      const message = event.type === 'message_start' ? event.message : event;
      if (message?.model) this.model = message.model;
      if (message?.usage && typeof message.usage === 'object')
        this.usage = { ...this.usage, ...message.usage };
      if (!this.streaming && event.type === 'message') this.complete = true;
    } catch {
      this.invalid = true;
    }
  }

  finish(): void {
    this.buffer += this.decoder.decode();
    if (this.streaming) {
      this.buffer += '\n';
      this.lines();
    } else this.parse(this.buffer);
  }

  cost(): number | undefined {
    const price = modelPrice(this.model);
    if (!this.complete || this.invalid || !price) return undefined;
    const input = tokens(this.usage.input_tokens);
    const output = tokens(this.usage.output_tokens);
    const created = tokens(this.usage.cache_creation_input_tokens ?? 0);
    const read = tokens(this.usage.cache_read_input_tokens ?? 0);
    if (input === undefined || output === undefined || created === undefined || read === undefined)
      return undefined;
    const cache = this.usage.cache_creation as Record<string, unknown> | undefined;
    const longCache = tokens(cache?.ephemeral_1h_input_tokens ?? 0);
    if (longCache === undefined || longCache > created) return undefined;
    // Server-side tools may have separate charges; retain the estimate if present.
    const serverTools = this.usage.server_tool_use;
    if (serverTools && Object.values(serverTools).some((n) => n !== 0)) return undefined;
    return (
      (((input + (created - longCache) * 1.25 + longCache * 2 + read * 0.1) * price.input +
        output * price.output) *
        multiplier(this.request)) /
      1_000_000
    );
  }
}
