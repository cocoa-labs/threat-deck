'use client';

import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cpu,
  Database,
  Eye,
  Globe,
  Radio,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { Badge } from '@/components/ui/Badge';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { useAgentStore } from '@/lib/store/agent-store';
import type { AgentStatus, Conversation, ToolCall } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { extractBluf } from '@/lib/utils/extract-bluf';
import { highlightMonetary } from '@/lib/utils/highlight-monetary';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Tool category config ─── */

type ToolCategoryConfig = { color: string; icon: typeof Search };

const TOOL_CATEGORIES = {
  search: { color: 'text-[var(--color-info)]', icon: Search },
  fetch: { color: 'text-[var(--color-info)]', icon: Globe },
  query: { color: 'text-[var(--color-positive)]', icon: Database },
  analyze: { color: 'text-[var(--color-warning)]', icon: Cpu },
  monitor: { color: 'text-[var(--color-cyber)]', icon: Radio },
  default: { color: 'text-[var(--text-dim)]', icon: Activity },
} as const satisfies Record<string, ToolCategoryConfig>;

function getToolCategory(toolName: string): ToolCategoryConfig {
  const lower = toolName.toLowerCase();
  if (lower.includes('search') || lower.includes('find')) return TOOL_CATEGORIES.search;
  if (lower.includes('fetch') || lower.includes('scrape') || lower.includes('rss'))
    return TOOL_CATEGORIES.fetch;
  if (lower.includes('query') || lower.includes('db') || lower.includes('data'))
    return TOOL_CATEGORIES.query;
  if (lower.includes('analyze') || lower.includes('brief') || lower.includes('summarize'))
    return TOOL_CATEGORIES.analyze;
  if (lower.includes('monitor') || lower.includes('alert') || lower.includes('watch'))
    return TOOL_CATEGORIES.monitor;
  return TOOL_CATEGORIES.default;
}

/* ─── Status indicator ─── */

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; pulse: boolean }> = {
  idle: { label: 'IDLE', color: 'bg-[var(--agent-idle)]', pulse: false },
  thinking: { label: 'THINKING', color: 'bg-[var(--agent-thinking)]', pulse: true },
  acting: { label: 'ACTING', color: 'bg-[var(--agent-acting)]', pulse: true },
  error: { label: 'ERROR', color: 'bg-[var(--agent-error)]', pulse: false },
};

/* ─── Format timestamp ─── */

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/* ─── Summarize tool input ─── */

function summarizeInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return '';

  // Pick the most descriptive field
  const descriptive = entries.find(([k]) =>
    ['query', 'symbol', 'url', 'topic', 'category', 'message', 'text', 'prompt'].includes(k),
  );

  if (descriptive) {
    const val = String(descriptive[1]);
    return val.length > 50 ? `${val.slice(0, 47)}...` : val;
  }

  // Fallback: show first entry
  const first = entries[0];
  if (!first) return '';
  const [key, val] = first;
  const strVal = typeof val === 'string' ? val : JSON.stringify(val);
  const display = `${key}: ${strVal}`;
  return display.length > 50 ? `${display.slice(0, 47)}...` : display;
}

/* ─── Tool Call Entry ─── */

function ToolCallEntry({ call }: { call: ToolCall }) {
  const category = getToolCategory(call.name);
  const Icon = category.icon;

  return (
    <div
      className="flex items-start gap-2 py-1 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] border-l-2"
      style={{
        borderLeftColor: `var(--${category.color.includes('info') ? 'badge-blue' : category.color.includes('positive') ? 'badge-green' : category.color.includes('warning') ? 'badge-amber' : category.color.includes('cyber') ? 'badge-purple' : 'text-dim'})`,
      }}
    >
      {/* Timestamp */}
      <span className="text-[9px] font-mono text-[var(--text-dim)] tabular-nums shrink-0 mt-0.5">
        {formatLogTime(call.timestamp)}
      </span>

      {/* Tool icon */}
      <Icon size={10} className={cn('shrink-0 mt-0.5', category.color)} />

      {/* Tool name + input */}
      <div className="min-w-0 flex-1">
        <span className={cn('text-[9px] font-mono font-bold', category.color)}>{call.name}</span>
        {call.input && Object.keys(call.input).length > 0 && (
          <p className="text-[8px] font-mono text-[var(--text-dim)] truncate mt-0.5">
            {summarizeInput(call.input)}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Conversation status dot ─── */

const CONV_STATUS_CONFIG = {
  active: { color: 'bg-[var(--agent-acting)]', pulse: true },
  completed: { color: 'bg-[var(--color-positive)]', pulse: false },
  error: { color: 'bg-[var(--agent-error)]', pulse: false },
} as const;

/* ─── Conversation Entry ─── */

function ConversationEntry({ conversation }: { conversation: Conversation }) {
  const [expanded, setExpanded] = useState(false);
  const setDrawerOpen = useAgentStore((s) => s.setDrawerOpen);
  const statusCfg = CONV_STATUS_CONFIG[conversation.status];
  const bluf = conversation.response ? extractBluf(conversation.response) : null;

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-b-0">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 py-1.5 px-1 rounded transition-colors hover:bg-[var(--bg-hover)] text-left overflow-hidden min-w-0"
      >
        {/* Expand chevron */}
        {expanded ? (
          <ChevronDown size={10} className="text-[var(--text-muted)] shrink-0" />
        ) : (
          <ChevronRight size={10} className="text-[var(--text-muted)] shrink-0" />
        )}

        {/* Status dot */}
        <div className="relative flex items-center shrink-0">
          <div className={cn('h-1.5 w-1.5 rounded-full', statusCfg.color)} />
          {statusCfg.pulse && (
            <div
              className={cn(
                'absolute h-1.5 w-1.5 rounded-full animate-ping opacity-50',
                statusCfg.color,
              )}
            />
          )}
        </div>

        {/* Timestamp */}
        <span className="text-[8px] font-mono text-[var(--text-muted)] tabular-nums shrink-0">
          {formatLogTime(conversation.startedAt)}
        </span>

        {/* Query text */}
        <span className="text-[9px] font-mono text-[var(--text-secondary)] truncate flex-1 min-w-0">
          {highlightMonetary(conversation.query)}
        </span>

        {/* Tool call count */}
        {conversation.toolCalls.length > 0 && (
          <Badge variant="cyan" size="xs">
            {conversation.toolCalls.length}t
          </Badge>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="pl-5 pr-1 pb-2 space-y-1.5">
          {/* Tool calls */}
          {conversation.toolCalls.length > 0 && (
            <div className="space-y-0">
              {conversation.toolCalls.map((call, i) => (
                <ToolCallEntry key={`${call.timestamp}-${i}`} call={call} />
              ))}
            </div>
          )}

          {/* BLUF preview */}
          {bluf && (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1.5">
              <p className="text-[8px] font-mono text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                {highlightMonetary(bluf)}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDrawerOpen(true);
              }}
              className="flex items-center gap-1 text-[8px] font-mono text-[var(--crt-glow)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Eye size={9} />
              View full
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prefillAgent(`Update: ${conversation.query}`, {
                  sourcePanel: 'agentActivity',
                  dataType: 'conversation_rerun',
                  trendData: { originalQuery: conversation.query },
                });
              }}
              className="flex items-center gap-1 text-[8px] font-mono text-[var(--crt-glow)] hover:text-[var(--text-primary)] transition-colors"
            >
              <RefreshCw size={9} />
              Re-run
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── AgentActivityPanel ─── */

export function AgentActivityPanel() {
  const status = useAgentStore((s) => s.status);
  const streamingText = useAgentStore((s) => s.streamingText);
  const isStreaming = useAgentStore((s) => s.isStreaming);
  const toolCallLog = useAgentStore((s) => s.toolCallLog);
  const pendingApprovals = useAgentStore((s) => s.pendingApprovals);
  const conversations = useAgentStore((s) => s.conversations);

  const statusConfig = STATUS_CONFIG[status];
  const historicConversations = conversations.filter((c) => c.status !== 'active');

  return (
    <PanelShell id="agentActivity" title={`${AGENT_IDENTITY.name.toUpperCase()} ACTIVITY`} span={1}>
      {/* Status bar */}
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--border-subtle)]">
        {/* Agent status */}
        <Badge
          variant={
            status === 'idle'
              ? 'blue'
              : status === 'thinking'
                ? 'amber'
                : status === 'acting'
                  ? 'green'
                  : 'red'
          }
          size="sm"
        >
          {statusConfig.label}
        </Badge>

        {/* Pending approvals badge */}
        {pendingApprovals.length > 0 && (
          <div className="flex items-center gap-1 rounded-full bg-[var(--color-warning)]/15 border border-[var(--color-warning)]/25 px-2 py-0.5">
            <AlertCircle size={9} className="text-[var(--color-warning)]" />
            <span className="text-[8px] font-mono font-bold text-[var(--color-warning)] tabular-nums">
              {pendingApprovals.length} pending
            </span>
          </div>
        )}
      </div>

      {/* Streaming text preview */}
      {isStreaming && streamingText && (
        <div className="mb-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Badge variant="green" size="xs">
              STREAMING
            </Badge>
          </div>
          <p className="text-[var(--text-xs)] font-mono text-[var(--text-secondary)] line-clamp-3 leading-relaxed">
            {streamingText.slice(-200)}
          </p>
        </div>
      )}

      {/* Active streaming tool calls */}
      {isStreaming && toolCallLog.length > 0 && (
        <div className="mb-2">
          <div className="text-[8px] font-mono font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
            Active Tools
          </div>
          <div className="space-y-0">
            {toolCallLog.map((call, i) => (
              <ToolCallEntry key={`${call.timestamp}-${i}`} call={call} />
            ))}
          </div>
        </div>
      )}

      {/* Conversation history */}
      {historicConversations.length === 0 && !isStreaming ? (
        <div className="flex flex-col h-full min-h-[60px] items-center justify-center gap-1.5">
          <Activity size={16} className="text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono text-[var(--text-muted)]">No activity yet</span>
        </div>
      ) : (
        !isStreaming && (
          <div className="space-y-0">
            {historicConversations.map((conv) => (
              <ConversationEntry key={conv.id} conversation={conv} />
            ))}
          </div>
        )
      )}

      {/* Show history below active streaming */}
      {isStreaming && historicConversations.length > 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] space-y-0">
          <div className="text-[8px] font-mono font-semibold uppercase tracking-wider text-[var(--text-dim)] mb-1">
            History
          </div>
          {historicConversations.map((conv) => (
            <ConversationEntry key={conv.id} conversation={conv} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
