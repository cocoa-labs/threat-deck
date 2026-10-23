import type Anthropic from '@anthropic-ai/sdk';
import {
  clearConversationExchanges,
  getAgentMemory,
  getRecentExchanges,
  insertConversationExchange,
  writeAgentMemory,
} from '@/lib/db/queries/agent';
import type { ToolCall } from '@/lib/types';
import type { Exchange, MemoryEntry, MemoryState } from './types';

const MAX_BUFFER_EXCHANGES = 10;
const MAX_ROLLING_SUMMARY_CHARS = 2000;
const RECENT_EXCHANGE_LIMIT = 10;

/**
 * MemoryManager - Buffer + semantic memory system.
 * Ported from Klammer Studio Python `tools/conversation_memory.py`.
 *
 * Manages:
 * - Buffer: Recent exchanges (in-memory, sliding window)
 * - Rolling summary: Compressed history of older exchanges
 * - Persistent memory: Key learnings stored in PostgreSQL
 * - Conversation exchanges: Persisted to DB for cross-request continuity
 */
export class MemoryManager {
  private userId: string;
  private exchanges: Exchange[] = [];
  private rollingSummary = '';
  private persistedMemories: MemoryEntry[] = [];

  private constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Load memory for a user from the database.
   * Loads both persistent memories and recent conversation exchanges in parallel.
   */
  static async load(userId: string): Promise<MemoryManager> {
    const manager = new MemoryManager(userId);

    // Skip DB load for non-UUID user IDs (e.g. 'anonymous', 'system')
    // agent_memory.user_id is UUID — passing a plain string causes a PostgreSQL type error
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    if (!isUuid) {
      return manager;
    }

    try {
      const [memories, exchangeRows] = await Promise.all([
        getAgentMemory({ userId, limit: 20 }),
        getRecentExchanges({ userId, limit: RECENT_EXCHANGE_LIMIT }),
      ]);

      manager.persistedMemories = memories.map((m) => ({
        topic: m.topic,
        content: m.content,
        importance: m.importance as 'low' | 'medium' | 'high',
        timestamp: m.created_at,
      }));

      // exchangeRows returned newest-first, reverse for chronological order
      manager.exchanges = exchangeRows.reverse().map((row) => ({
        userMessage: row.user_message,
        assistantResponse: row.assistant_response,
        toolCalls: Array.isArray(row.tool_calls)
          ? (row.tool_calls as { name: string; input: unknown; output: unknown }[])
          : [],
        timestamp: new Date(row.created_at).getTime(),
      }));
    } catch (err) {
      console.warn(
        '[MemoryManager] Failed to load from DB, using empty context:',
        err instanceof Error ? err.message : err,
      );
      manager.persistedMemories = [];
      manager.exchanges = [];
    }

    return manager;
  }

  /**
   * Get the current memory state for prompt building.
   */
  getState(): MemoryState {
    return {
      rollingSummary: this.rollingSummary,
      recentExchanges: this.exchanges,
      persistedMemories: this.persistedMemories,
    };
  }

  getRollingSummary(): string {
    return this.rollingSummary;
  }

  /**
   * Get messages formatted for the Anthropic API.
   * Returns recent exchanges as message pairs (up to 10).
   */
  getMessagesForAPI(): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = [];
    const MAX_MESSAGE_CHARS = 4000; // ~1000 tokens per message

    for (const exchange of this.exchanges.slice(-RECENT_EXCHANGE_LIMIT)) {
      if (exchange.userMessage) {
        messages.push({
          role: 'user',
          content: exchange.userMessage.slice(0, MAX_MESSAGE_CHARS),
        });
        messages.push({
          role: 'assistant',
          content:
            exchange.assistantResponse.length > MAX_MESSAGE_CHARS
              ? `${exchange.assistantResponse.slice(0, MAX_MESSAGE_CHARS)}\n\n[Response truncated for context management]`
              : exchange.assistantResponse,
        });
      }
    }

    return messages;
  }

  /**
   * Record a completed exchange, persist to DB, and manage buffer pressure.
   */
  async completeExchange(
    userMessage: string,
    responseText: string,
    toolCalls: ToolCall[],
    origin: 'agent' | 'companion' = 'agent',
  ): Promise<void> {
    const exchange: Exchange = {
      userMessage,
      assistantResponse: responseText,
      toolCalls: toolCalls.map((tc) => ({
        name: tc.name,
        input: tc.input,
        output: tc.output,
      })),
      timestamp: Date.now(),
    };

    this.exchanges.push(exchange);

    // Fire-and-forget: persist to DB
    insertConversationExchange({
      userId: this.userId,
      userMessage,
      assistantResponse: responseText,
      toolCalls: toolCalls.map((tc) => ({ name: tc.name, input: tc.input })),
      origin,
    }).catch((err) => {
      console.warn(
        '[MemoryManager] Failed to persist exchange:',
        err instanceof Error ? err.message : err,
      );
    });

    // Fire-and-forget: significance-based extraction
    this.maybeExtractSignificantLearning(exchange).catch(() => {
      // Significance extraction is best-effort
    });

    // Buffer pressure management
    if (this.exchanges.length > MAX_BUFFER_EXCHANGES) {
      await this.compressOldExchanges();
    }
  }

  /**
   * Write a learning to persistent memory.
   */
  async writeMemory(params: {
    topic: string;
    content: string;
    importance?: 'low' | 'medium' | 'high';
  }): Promise<void> {
    try {
      await writeAgentMemory({
        userId: this.userId,
        topic: params.topic,
        content: params.content,
        importance: params.importance ?? 'medium',
      });

      this.persistedMemories.unshift({
        topic: params.topic,
        content: params.content,
        importance: params.importance ?? 'medium',
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Database may not be available
    }
  }

  /**
   * Clear all conversation exchanges (in-memory + DB).
   */
  async clearExchanges(): Promise<void> {
    this.exchanges = [];
    this.rollingSummary = '';
    try {
      await clearConversationExchanges({ userId: this.userId });
    } catch {
      // DB may not be available
    }
  }

  /**
   * Auto-extract significant learnings to agent_memory.
   * Criteria:
   * - Brief generated: toolCalls includes generate_brief AND response > 500 chars
   * - Heavy tool use: 3+ tool calls
   * - User explicit: user message contains "remember this", "save this", "note this"
   */
  private async maybeExtractSignificantLearning(exchange: Exchange): Promise<void> {
    const toolNames = exchange.toolCalls.map((tc) => tc.name);
    const hasBrief =
      toolNames.includes('generate_brief') && exchange.assistantResponse.length > 500;
    const heavyToolUse = exchange.toolCalls.length >= 3;
    const userExplicit = /\b(remember this|save this|note this)\b/i.test(exchange.userMessage);

    if (!hasBrief && !heavyToolUse && !userExplicit) return;

    // Build a concise learning from the exchange
    const topic = userExplicit ? 'user_note' : hasBrief ? 'brief_summary' : 'analysis_result';

    const importance: 'low' | 'medium' | 'high' = userExplicit
      ? 'high'
      : hasBrief
        ? 'medium'
        : 'low';

    // Extract first 300 chars of the response as the learning content
    const snippet = exchange.assistantResponse.slice(0, 300).replace(/\n+/g, ' ').trim();
    const content = `[${new Date(exchange.timestamp).toISOString()}] Query: "${exchange.userMessage.slice(0, 100)}" — ${snippet}`;

    await this.writeMemory({ topic, content, importance });
  }

  /**
   * Compress oldest exchanges into the rolling summary.
   */
  private async compressOldExchanges(): Promise<void> {
    const toCompress = this.exchanges.splice(0, this.exchanges.length - MAX_BUFFER_EXCHANGES + 2);

    if (toCompress.length === 0) return;

    const summaryParts: string[] = [];
    if (this.rollingSummary) {
      summaryParts.push(this.rollingSummary);
    }

    for (const exchange of toCompress) {
      const toolNames = exchange.toolCalls.map((tc) => tc.name).join(', ');
      const snippet = exchange.assistantResponse.slice(0, 200);
      summaryParts.push(
        `[${new Date(exchange.timestamp).toISOString()}] Tools: ${toolNames || 'none'}. Response: ${snippet}`,
      );
    }

    this.rollingSummary = summaryParts.join('\n').slice(0, MAX_ROLLING_SUMMARY_CHARS);
  }
}
