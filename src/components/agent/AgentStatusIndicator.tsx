'use client';

import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { useAgentStore } from '@/lib/store/agent-store';
import type { AgentStatus } from '@/lib/types';
import { cn } from '@/lib/utils/cn';

/* ─── Status configuration ─── */

const STATUS_CONFIG: Record<AgentStatus, { color: string; animation: string; label: string }> = {
  idle: {
    color: 'var(--agent-idle)',
    animation: 'animate-pulse',
    label: `${AGENT_IDENTITY.name} idle`,
  },
  thinking: {
    color: 'var(--agent-thinking)',
    animation: 'animate-spin',
    label: `${AGENT_IDENTITY.name} thinking`,
  },
  acting: {
    color: 'var(--agent-acting)',
    animation: 'animate-ping',
    label: `${AGENT_IDENTITY.name} acting`,
  },
  error: {
    color: 'var(--agent-error)',
    animation: '',
    label: `${AGENT_IDENTITY.name} error`,
  },
};

/* ─── AgentStatusIndicator ─── */

export function AgentStatusIndicator({ size = 8 }: { size?: number }) {
  const status = useAgentStore((s) => s.status);
  const config = STATUS_CONFIG[status];

  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      role="img"
      title={config.label}
      aria-label={config.label}
    >
      {/* Outer animation ring */}
      {status !== 'error' && (
        <span
          className={cn(
            'absolute inset-0 rounded-full opacity-75',
            status === 'idle' && 'animate-pulse',
            status === 'thinking' && 'animate-spin',
            status === 'acting' && 'animate-ping',
          )}
          style={{ backgroundColor: config.color }}
        />
      )}
      {/* Inner dot */}
      <span
        className="relative inline-flex rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: config.color,
        }}
      />
    </span>
  );
}
