import type Anthropic from '@anthropic-ai/sdk';

// ─── Tool System ───

export enum ToolCategory {
  DATA_RETRIEVAL = 'data_retrieval',
  ANALYSIS = 'analysis',
  ACTION = 'action',
  MEMORY = 'memory',
  INTERNAL = 'internal',
  MAP_CONTROL = 'map_control',
  TV_CONTROL = 'tv_control',
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool['input_schema'];
  handler: (input: Record<string, unknown>) => Promise<unknown>;
  tokenBudget: number;
  category: ToolCategory;
  requiresApproval: boolean;
  cooldownSeconds: number;
  featureFlag?: string;
}

// ─── Compressor ───

export enum StoragePolicy {
  FULL = 'full',
  SUMMARY = 'summary',
  MINIMAL = 'minimal',
}

export interface CompressionResult {
  data: unknown;
  policy: StoragePolicy;
  originalSize: number;
  compressedSize: number;
}

// ─── Memory ───

export interface MemoryEntry {
  topic: string;
  content: string;
  importance: 'low' | 'medium' | 'high';
  timestamp: string;
}

export interface MemoryState {
  rollingSummary: string;
  recentExchanges: Exchange[];
  persistedMemories: MemoryEntry[];
}

export interface Exchange {
  userMessage: string;
  assistantResponse: string;
  toolCalls: { name: string; input: unknown; output: unknown }[];
  timestamp: number;
}

// ─── Activation ───

export interface ActivationTrigger {
  type: 'event' | 'schedule' | 'user';
  source: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  data: Record<string, unknown>;
}

// ─── Agent Invocation ───

export interface InvokeParams {
  trigger: 'event' | 'schedule' | 'user';
  context: import('@/lib/types').AgentContext;
  task: string;
  messageContent?: Anthropic.MessageParam['content'];
  userId: string;
  stream?: boolean;
  responseMode?: 'concise' | 'standard';
  signal?: AbortSignal;
  origin?: 'agent' | 'companion';
  /**
   * The operator's authenticated session email. Injected into tool execution
   * context so side-effecting tools (e.g. email_conversation) can resolve
   * "email me" to the operator's inbox without Claude supplying the address.
   */
  operatorEmail?: string | null;
  recentMessages?: { role: string; content: string }[];
  toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
  /**
   * Three-mode posture lock for this invocation (Phase 14). `null` or absent
   * means AUTO — the in-prompt auto-promotion rules drive mode selection.
   * When set, the matching MODE LOCKED addendum is injected into the system
   * prompt and the tool-turn cap is clamped via MODE_TOOL_BUDGET.
   */
  effectiveMode?: import('./mode-config').AgentMode | null;
}

export interface AgentResult {
  text: string;
  toolCalls: import('@/lib/types').ToolCall[];
  model: string;
  tokensInput?: number;
  tokensOutput?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  durationMs?: number;
}

// ─── Autonomous ───

export interface AutonomousResult {
  id: string;
  trigger: ActivationTrigger;
  task: string;
  result: AgentResult;
  severity: 'low' | 'medium' | 'high' | 'critical';
  headline: string;
  timestamp: number;
  dismissed: boolean;
}
