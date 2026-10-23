import type Anthropic from '@anthropic-ai/sdk';
import { toolEnabled, validateToolInput } from '@/lib/security/tool-policy';
import type { ToolCategory, ToolDefinition } from './types';

/**
 * Per-invocation context injected into tool inputs at execution time. Lets
 * route handlers thread the authenticated session into pure tool handlers
 * (e.g. `email_conversation` resolving "email me" → the operator's inbox)
 * without Claude having to populate — or being able to spoof — these fields.
 */
export type ToolExecutionContext = {
  /** The operator's authenticated session email. */
  operatorEmail?: string | null;
};

/** Merge server-trusted context onto Claude's tool input (server values win). */
function applyContext(
  input: Record<string, unknown>,
  context?: ToolExecutionContext,
): Record<string, unknown> {
  const { operatorEmail: _untrusted, ...merged } = input;
  merged.operatorEmail = context?.operatorEmail ?? null;
  return merged;
}

/**
 * ToolRegistry - Singleton tool management system.
 * Ported from Klammer Studio Python `tools/tool_registry.py`.
 *
 * Responsibilities:
 * - Register/retrieve tool definitions for the Anthropic API
 * - Execute tool handlers with cooldown enforcement
 * - Apply prompt caching (cache_control on last tool)
 * - Gate approval-required tools
 */
class ToolRegistryImpl {
  private tools = new Map<string, ToolDefinition>();
  private lastExecution = new Map<string, number>();
  private invocationStart = 0;

  /** Call at the start of each agent invoke/stream to allow intra-invocation re-calls. */
  beginInvocation(): void {
    this.invocationStart = Date.now();
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  registerBatch(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get tool definitions formatted for the Anthropic API.
   * Applies cache_control to the last tool for prompt caching.
   */
  getToolDefinitions(): Anthropic.Tool[] {
    const defs = [...this.tools.values()]
      .filter((t) => this.isEnabled(t))
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));

    // Apply cache_control to last tool (from Klammer's prompt caching pattern)
    if (defs.length > 0) {
      const last = defs[defs.length - 1]!;
      (last as Record<string, unknown>).cache_control = { type: 'ephemeral' };
    }

    return defs;
  }

  /**
   * Execute a tool by name with cooldown and approval gates.
   */
  async execute(
    name: string,
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { error: `Unknown tool: ${name}` };
    }

    if (!this.isEnabled(tool)) return { error: 'tool_disabled' };
    if (!validateToolInput(tool, input)) return { error: 'invalid_tool_input' };

    // Cooldown check — bypass within current invocation
    if (tool.cooldownSeconds > 0) {
      const lastRun = this.lastExecution.get(name) ?? 0;
      const withinCurrentInvocation = lastRun >= this.invocationStart && this.invocationStart > 0;
      if (!withinCurrentInvocation) {
        const elapsed = (Date.now() - lastRun) / 1000;
        if (elapsed < tool.cooldownSeconds) {
          return {
            error: `Tool "${name}" in cooldown. Wait ${(tool.cooldownSeconds - elapsed).toFixed(1)}s`,
          };
        }
      }
    }

    // ─── Approval gate ───
    //
    // There is NO queue behind this flag. It used to return a cheerful
    // `{ requires_approval: true, message: 'This action requires human
    // approval before execution.' }` — but that object was produced here and
    // consumed nowhere: no row was written, no operator was ever prompted, and
    // the model simply read the blob and reported the action as queued. Two
    // tools sat behind it for months doing nothing at all.
    //
    // So it fails LOUD now. A tool that declares `requiresApproval: true` is
    // misconfigured, not protected.
    //
    // The working human-in-the-loop pattern is the outbound drafts queue:
    // the handler does its real work by STAGING a draft
    // (`aegis_outbound_drafts` — see `src/lib/twitter/content/staging.ts`),
    // registers with `requiresApproval: false`, and the operator reviews,
    // edits, and approves in ApprovalQueueSection before anything is
    // published. `post_to_x` is the reference implementation.
    if (tool.requiresApproval) {
      return {
        error: `Tool "${name}" is registered requiresApproval:true, but no approval queue is wired to that flag — nothing was executed and nothing was queued. Do NOT report this action as pending or completed. This is a configuration bug: stage the work into the outbound drafts queue instead (see post_to_x).`,
      };
    }

    this.lastExecution.set(name, Date.now());

    try {
      return await tool.handler(applyContext(input, context));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { error: `Tool "${name}" failed: ${message}` };
    }
  }

  /**
   * Execute bypassing approval gate (for approved actions).
   */
  async executeBypassApproval(
    name: string,
    input: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown> {
    // Legacy approval records cannot authorize tools. Only the reviewed draft
    // publisher performs external actions. Keep compatibility without a bypass.
    return this.execute(name, input, context);
  }

  getTokenBudget(name: string): number {
    return this.tools.get(name)?.tokenBudget ?? 5000;
  }

  getToolByName(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getToolsByCategory(category: ToolCategory): ToolDefinition[] {
    return [...this.tools.values()].filter((t) => t.category === category);
  }

  getAllTools(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  private isEnabled(tool: ToolDefinition): boolean {
    return toolEnabled(tool);
  }
}

export const ToolRegistry = new ToolRegistryImpl();
