import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { AUDIT_ACTIONS, auditFailure } from '@/lib/audit';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { budgetedAIFetch } from '@/lib/security/budget';
import type { ToolCall } from '@/lib/types';
import { MemoryManager } from './memory';
import { MODE_TOOL_BUDGET, stripAllModeMarkers } from './mode-config';
import { buildSystemPrompt } from './prompts';
import { ToolResultCompressor } from './tool-compressor';
import { ToolRegistry } from './tool-registry';
import type { AgentResult, InvokeParams } from './types';

/**
 * Rescue env vars that the parent shell may have set to an empty string —
 * which Next.js dotenv loaders refuse to override, leaving the real value in
 * `.env.local` unused. Most common case: running `npm run dev` from inside a
 * Claude Code / Cursor / dev-tool terminal that sets `ANTHROPIC_API_KEY=""`
 * to force its own auth flow.
 *
 * Only runs once per process. Only rescues a key if `process.env[key]` is
 * empty AND `.env.local` provides a non-empty value. No-op in deployments
 * where there's no parent-shell collision (Vercel, Fly, Docker).
 *
 * Scoped intentionally narrow: only `ANTHROPIC_API_KEY` for now. Add more
 * keys if other Cocoa AI services hit the same collision pattern.
 */
const RESCUE_KEYS = ['ANTHROPIC_API_KEY'] as const;
let envRescueApplied = false;
function rescueEnvFromDotenvLocal(): void {
  if (envRescueApplied) return;
  envRescueApplied = true;
  try {
    const path = join(process.cwd(), '.env.local');
    const raw = readFileSync(path, 'utf8');
    for (const key of RESCUE_KEYS) {
      const current = process.env[key];
      if (current && current.trim().length > 0) continue;
      const match = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
      const value = match?.[1]?.trim();
      if (value && value.length > 0) {
        process.env[key] = value;
        console.warn(
          `[env] Rescued ${key} from .env.local (parent shell had it set to empty string)`,
        );
      }
    }
  } catch {
    // .env.local not readable — let the downstream missing-key error stand.
  }
}

// IMPORTANT: ANTHROPIC_API_KEY is read at REQUEST time in `getClient()`, not
// at module-load time. Next.js/Turbopack populates `.env.local` into
// `process.env` lazily; module-level capture can get `undefined` that would
// otherwise be present by the time a route handler runs. MODEL and
// MAX_TOOL_TURNS are safe to read at module load because they have hard-coded
// defaults that always work.
const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
const MAX_TOOL_TURNS = Number(process.env.AGENT_MAX_TOOL_TURNS) || 10;

/**
 * Create Anthropic client instance.
 *
 * Reads ANTHROPIC_API_KEY at CALL time (not module-load time) so we always
 * see the latest process.env. If the key is missing, throws a clear error
 * that the streamAgent catch will categorize as `config_missing_api_key`
 * and surface to the user as "Max unavailable - ANTHROPIC_API_KEY not
 * configured" rather than the cryptic SDK "Could not resolve authentication
 * method" message.
 */
function getClient(): Anthropic {
  rescueEnvFromDotenvLocal();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      'ANTHROPIC_API_KEY missing — set it in .env.local and restart (apiKey not configured)',
    );
  }
  return new Anthropic({
    fetch: budgetedAIFetch,
    apiKey,
    timeout: 600_000, // 10 min for extended analysis
    maxRetries: 3,
  });
}

/* ─── SSE error categorization ─── */

type AgentErrorCategory =
  | 'config_missing_api_key'
  | 'auth_invalid'
  | 'rate_limited'
  | 'upstream_outage'
  | 'aborted'
  | 'context_overflow'
  | 'unknown';

/**
 * Categorize an exception from the Anthropic SDK or our own stream loop into
 * a stable enum the client can render with a useful, actionable message.
 *
 * Heuristics ordered from most-specific to most-generic. Don't return
 * 'unknown' before checking everything else.
 */
function categorizeAgentError(err: unknown): AgentErrorCategory {
  if (!(err instanceof Error)) return 'unknown';
  if (err.name === 'AbortError') return 'aborted';

  const msg = err.message ?? '';
  const status = (err as { status?: number }).status;

  if (msg.includes('authentication method') || msg.includes('apiKey')) {
    return 'config_missing_api_key';
  }
  if (status === 401 || status === 403) return 'auth_invalid';
  if (status === 429) return 'rate_limited';
  if (status && status >= 500) return 'upstream_outage';
  if (msg.includes('context length') || msg.includes('max_tokens')) {
    return 'context_overflow';
  }
  return 'unknown';
}

/**
 * Operator-facing message for a given error category. Tells the user (and
 * the on-call engineer scanning logs) what action is appropriate, not just
 * "please retry."
 */
function messageForCategory(category: AgentErrorCategory, raw: string): string {
  switch (category) {
    case 'config_missing_api_key':
      return `[${AGENT_IDENTITY.name} unavailable - ANTHROPIC_API_KEY not configured. Contact admin.]`;
    case 'auth_invalid':
      return `[${AGENT_IDENTITY.name} unavailable - API key rejected. Rotate the key.]`;
    case 'rate_limited':
      return '[Rate limited by Anthropic — retry in a moment.]';
    case 'upstream_outage':
      return '[Anthropic upstream error — retry in a moment.]';
    case 'context_overflow':
      return '[Context too large — start a new conversation.]';
    case 'aborted':
      return ''; // user cancelled — no message, the UI already knows
    case 'unknown':
      return `[${AGENT_IDENTITY.name} error: ${raw.slice(0, 120)}]`;
  }
}

/**
 * Invoke the agent with a task.
 * Implements the agentic loop pattern from Klammer Studio BaseAgent.chat().
 *
 * Flow:
 * 1. Load memory for the user
 * 2. Build system prompt (static/dynamic split for caching)
 * 3. Loop: call Claude -> process tool_use -> feed results back
 * 4. On end_turn: save exchange to memory and return
 */
export async function invokeAgent(params: InvokeParams): Promise<AgentResult> {
  const startTime = Date.now();
  const anthropic = getClient();
  const memory = await MemoryManager.load(params.userId);
  const tools = ToolRegistry.getToolDefinitions();
  const mode = params.responseMode ?? 'standard';
  // Generous ceiling — prompt language controls brevity, max_tokens prevents hard cutoff.
  // Concise (panel clicks): prompt says 2-4 sentences; 4096 is just a safety net.
  // Standard (manual queries): prompt says be direct; 64000 ensures completion.
  const maxTokens = mode === 'concise' ? 4096 : 64000;
  const systemPrompt = buildSystemPrompt(
    params.context,
    memory.getState(),
    mode,
    undefined,
    params.effectiveMode ?? null,
  );

  // Static/dynamic split for prompt caching
  const system: Anthropic.MessageCreateParams['system'] = [
    {
      type: 'text',
      text: systemPrompt.staticBlock,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: systemPrompt.dynamicBlock,
    },
  ];

  // Use DB exchanges if available, otherwise fall back to client-provided recent messages
  const dbMessages = memory.getMessagesForAPI();
  const priorMessages =
    dbMessages.length > 0
      ? dbMessages
      : (params.recentMessages ?? []).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

  const messages: Anthropic.MessageParam[] = [
    ...priorMessages,
    { role: 'user', content: params.messageContent ?? params.task },
  ];

  // Allow intra-invocation re-calls of the same tool
  ToolRegistry.beginInvocation();

  // Agentic loop
  let turnCount = 0;
  const toolCalls: ToolCall[] = [];
  let tokensInput = 0;
  let tokensOutput = 0;
  let cacheCreation = 0;
  let cacheRead = 0;

  // Phase 14 — clamp by per-mode budget when locked. See streamAgent below.
  // Phase 14.5: defensive `?? MAX_TOOL_TURNS` — if an invalid mode somehow
  // bypasses parseLockedMode at the route boundary, MODE_TOOL_BUDGET[bad]
  // is undefined, Math.min(N, undefined) is NaN, and the agentic loop
  // never enters. The fallback degrades to the safe default cap.
  const turnCap =
    params.effectiveMode != null
      ? Math.min(MAX_TOOL_TURNS, MODE_TOOL_BUDGET[params.effectiveMode] ?? MAX_TOOL_TURNS)
      : MAX_TOOL_TURNS;

  while (turnCount < turnCap) {
    // Proactive token counting — truncate before hitting context limit
    if (messages.length > 6) {
      try {
        const tokenCount = await anthropic.messages.countTokens({
          model: MODEL,
          system,
          tools,
          messages,
        });
        if (tokenCount.input_tokens > 128_000) {
          console.log(
            `[Agent] Token count ${tokenCount.input_tokens} approaching limit, truncating`,
          );
          const keep = Math.max(2, messages.length - 4);
          messages.splice(0, messages.length - keep);
        }
      } catch {
        // countTokens not critical — proceed without it
      }
    }

    const response = await callWithRecovery(anthropic, {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      tools,
      messages,
      ...(turnCount === 0 && params.toolChoice ? { tool_choice: params.toolChoice } : {}),
    });

    tokensInput += response.usage.input_tokens;
    tokensOutput += response.usage.output_tokens;
    const cacheUsage = response.usage as unknown as Record<string, unknown>;
    cacheCreation += (cacheUsage.cache_creation_input_tokens as number) ?? 0;
    cacheRead += (cacheUsage.cache_read_input_tokens as number) ?? 0;

    if (response.stop_reason === 'end_turn') {
      // Phase 14.5 — strip any [[MODE:...]] marker from the response text
      // BEFORE persisting to memory or returning to callers. The model is
      // instructed to emit it on the first line of every response, and
      // marker pollution in conversation_exchanges would feed back into
      // future turns via priorMessages. Idempotent on already-clean text.
      const text = stripAllModeMarkers(
        response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join(''),
      );

      await memory.completeExchange(params.task, text, toolCalls, params.origin ?? 'agent');

      if (cacheRead > 0 || cacheCreation > 0) {
        console.log(`[Agent] Cache: ${cacheRead} read, ${cacheCreation} creation tokens`);
      }

      return {
        text,
        toolCalls,
        model: MODEL,
        tokensInput,
        tokensOutput,
        cacheCreationTokens: cacheCreation || undefined,
        cacheReadTokens: cacheRead || undefined,
        durationMs: Date.now() - startTime,
      };
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await ToolRegistry.execute(
            block.name,
            block.input as Record<string, unknown>,
            { operatorEmail: params.operatorEmail },
          );

          const budget = ToolRegistry.getTokenBudget(block.name);
          const compressed = ToolResultCompressor.compress(block.name, result, budget);

          toolCalls.push({
            name: block.name,
            input: block.input as Record<string, unknown>,
            output: compressed.data,
            timestamp: Date.now(),
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(compressed.data),
          });
        }
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
      turnCount++;
    } else {
      // max_tokens or unexpected stop reason — log for observability
      console.warn(
        `[Agent] Stop reason: ${response.stop_reason} (output_tokens: ${response.usage.output_tokens})`,
      );

      const text = stripAllModeMarkers(
        response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join(''),
      );

      // Save whatever we have to memory even on truncation
      if (text) {
        await memory.completeExchange(params.task, text, toolCalls, params.origin ?? 'agent');
      }

      return {
        text: text || `[${AGENT_IDENTITY.name} stopped: ${response.stop_reason}]`,
        toolCalls,
        model: MODEL,
        tokensInput,
        tokensOutput,
        cacheCreationTokens: cacheCreation || undefined,
        cacheReadTokens: cacheRead || undefined,
        durationMs: Date.now() - startTime,
      };
    }
  }

  return {
    text: `[${AGENT_IDENTITY.name} reached maximum tool turns. Analysis may be incomplete.]`,
    toolCalls,
    model: MODEL,
    tokensInput,
    tokensOutput,
    cacheCreationTokens: cacheCreation || undefined,
    cacheReadTokens: cacheRead || undefined,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Call Claude API with overflow recovery.
 * Ported from Klammer Studio `_call_claude_api_with_recovery()`.
 *
 * If the request is too large, truncate older messages and retry.
 * Fail-fast on double truncation (from Canvas pattern).
 */
async function callWithRecovery(
  client: Anthropic,
  params: Anthropic.MessageCreateParams,
  retryCount = 0,
): Promise<Anthropic.Message> {
  try {
    return (await client.messages.create(params)) as Anthropic.Message;
  } catch (err) {
    if (err instanceof Anthropic.APIError && err.status === 400 && retryCount === 0) {
      // Likely context overflow - truncate messages and retry
      const messages = params.messages as Anthropic.MessageParam[];
      if (messages.length > 2) {
        // Remove oldest exchange pair, keep first (system context) and last (current query)
        const truncated = [...messages.slice(Math.max(2, messages.length - 4))];
        return callWithRecovery(client, { ...params, messages: truncated }, retryCount + 1);
      }
    }
    throw err;
  }
}

/**
 * Stream the agent response using SSE.
 * Returns an async generator of text chunks.
 */
export async function* streamAgent(params: InvokeParams): AsyncGenerator<{
  type: 'text' | 'tool_use' | 'tool_result' | 'tool_start' | 'message_start' | 'done';
  data: string;
}> {
  const anthropic = getClient();
  const memory = await MemoryManager.load(params.userId);
  const tools = ToolRegistry.getToolDefinitions();
  const mode = params.responseMode ?? 'standard';
  const maxTokens = mode === 'concise' ? 4096 : 64000;
  const systemPrompt = buildSystemPrompt(
    params.context,
    memory.getState(),
    mode,
    undefined,
    params.effectiveMode ?? null,
  );

  const system: Anthropic.MessageCreateParams['system'] = [
    {
      type: 'text',
      text: systemPrompt.staticBlock,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: systemPrompt.dynamicBlock,
    },
  ];

  // Use DB exchanges if available, otherwise fall back to client-provided recent messages
  const dbMessages = memory.getMessagesForAPI();
  const streamPriorMessages =
    dbMessages.length > 0
      ? dbMessages
      : (params.recentMessages ?? []).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

  const messages: Anthropic.MessageParam[] = [
    ...streamPriorMessages,
    { role: 'user', content: params.messageContent ?? params.task },
  ];

  // Allow intra-invocation re-calls of the same tool
  ToolRegistry.beginInvocation();

  let turnCount = 0;
  const toolCalls: ToolCall[] = [];

  // Phase 14 — clamp the per-invocation tool-turn cap to the locked mode's
  // budget (anchor=2, analyst=6, fix-architect=8). The global MAX_TOOL_TURNS
  // remains a backstop, so the effective cap is the *smaller* of the two.
  // When no lock is in effect, this collapses to MAX_TOOL_TURNS.
  const turnCap =
    params.effectiveMode != null
      ? Math.min(MAX_TOOL_TURNS, MODE_TOOL_BUDGET[params.effectiveMode])
      : MAX_TOOL_TURNS;

  while (turnCount < turnCap) {
    // Check abort signal before API call
    if (params.signal?.aborted) return;

    // Proactive overflow protection: truncate if messages are too large
    if (messages.length > 6) {
      try {
        const tokenCount = await anthropic.messages.countTokens({
          model: MODEL,
          system,
          tools,
          messages,
        });
        // If over 80% of context window (~160K for sonnet), truncate
        if (tokenCount.input_tokens > 128_000) {
          console.log(
            `[Agent Stream] Token count ${tokenCount.input_tokens} approaching limit, truncating`,
          );
          const keep = Math.max(2, messages.length - 4);
          messages.splice(0, messages.length - keep);
        }
      } catch {
        // countTokens not critical — proceed without it
      }
    }

    let stream: Awaited<ReturnType<typeof anthropic.messages.stream>>;
    try {
      stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        tools,
        messages,
        ...(turnCount === 0 && params.toolChoice ? { tool_choice: params.toolChoice } : {}),
      });
    } catch (err) {
      // Overflow recovery on stream creation failure
      if (err instanceof Anthropic.APIError && err.status === 400 && messages.length > 2) {
        console.log('[Agent Stream] 400 error, truncating messages and retrying');
        const keep = Math.max(2, messages.length - 4);
        messages.splice(0, messages.length - keep);
        continue;
      }
      throw err;
    }

    try {
      for await (const event of stream) {
        if (event.type === 'message_start') {
          const msg = (event as Record<string, unknown>).message as
            | { model?: string; usage?: Record<string, unknown> }
            | undefined;
          if (msg) {
            yield {
              type: 'message_start' as const,
              data: JSON.stringify({
                model: msg.model,
                inputTokens: msg.usage?.input_tokens,
              }),
            };
          }
        } else if (event.type === 'content_block_start') {
          const block = (event as Record<string, unknown>).content_block as
            | { type: string; name?: string }
            | undefined;
          if (block?.type === 'tool_use' && block.name) {
            yield {
              type: 'tool_start' as const,
              data: JSON.stringify({ name: block.name }),
            };
          }
        } else if (event.type === 'content_block_delta') {
          const delta =
            'delta' in event
              ? ((event as Record<string, unknown>).delta as { type?: string; text?: string })
              : null;
          if (delta?.type === 'text_delta' && delta.text) {
            yield { type: 'text', data: delta.text };
          }
        }
      }
    } catch (streamErr) {
      const category = categorizeAgentError(streamErr);
      const rawMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      const userMsg = messageForCategory(category, rawMsg);

      console.error(`[Agent Stream] ${category}:`, rawMsg);

      // Fire-and-forget audit row so SECURITY can spot config/auth/upstream
      // patterns across the deployment. Aborts are user-initiated; don't audit.
      if (category !== 'aborted') {
        void auditFailure(AUDIT_ACTIONS.AGENT_INVOKE_FAILED, streamErr, {
          actorId: params.userId,
          targetKind: 'agent',
          details: { category, model: MODEL, turnCount },
        });
      }

      if (userMsg) yield { type: 'text', data: userMsg };
    }

    const finalMessage = await stream.finalMessage();

    // Track cache usage from streaming response
    const streamCacheUsage = finalMessage.usage as unknown as Record<string, unknown>;
    const streamCacheRead = (streamCacheUsage.cache_read_input_tokens as number) ?? 0;
    const streamCacheCreation = (streamCacheUsage.cache_creation_input_tokens as number) ?? 0;
    if (streamCacheRead > 0 || streamCacheCreation > 0) {
      console.log(
        `[Agent Stream] Cache: ${streamCacheRead} read, ${streamCacheCreation} creation tokens`,
      );
    }

    if (finalMessage.stop_reason === 'end_turn') {
      // Phase 14.5 — strip marker before persisting (see invokeAgent above).
      const text = stripAllModeMarkers(
        (finalMessage.content as Anthropic.ContentBlock[])
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join(''),
      );

      await memory.completeExchange(params.task, text, toolCalls, params.origin ?? 'agent');
      yield { type: 'done', data: '' };
      return;
    }

    if (finalMessage.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          // Check abort signal before tool execution
          if (params.signal?.aborted) return;

          yield {
            type: 'tool_use',
            data: JSON.stringify({ name: block.name, input: block.input }),
          };

          const result = await ToolRegistry.execute(
            block.name,
            block.input as Record<string, unknown>,
            { operatorEmail: params.operatorEmail },
          );

          const budget = ToolRegistry.getTokenBudget(block.name);
          const compressed = ToolResultCompressor.compress(block.name, result, budget);

          toolCalls.push({
            name: block.name,
            input: block.input as Record<string, unknown>,
            output: compressed.data,
            timestamp: Date.now(),
          });

          yield {
            type: 'tool_result' as const,
            data: JSON.stringify({ name: block.name, output: compressed.data }),
          };

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(compressed.data),
          });
        }
      }

      messages.push({ role: 'assistant', content: finalMessage.content });
      messages.push({ role: 'user', content: toolResults });
      turnCount++;
    } else {
      // max_tokens or unexpected stop — log and surface to client
      const truncatedText = stripAllModeMarkers(
        (finalMessage.content as Anthropic.ContentBlock[])
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join(''),
      );

      console.warn(
        `[Agent Stream] Stop reason: ${finalMessage.stop_reason} (output_tokens: ${finalMessage.usage.output_tokens})`,
      );

      // Save whatever we have to memory
      if (truncatedText) {
        await memory.completeExchange(
          params.task,
          truncatedText,
          toolCalls,
          params.origin ?? 'agent',
        );
      }

      yield {
        type: 'done',
        data: JSON.stringify({ stopReason: finalMessage.stop_reason }),
      };
      return;
    }
  }

  yield { type: 'done', data: '' };
}
