'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { AgentStatusIndicator } from '@/components/agent/AgentStatusIndicator';
import { CocoaWordmark } from '@/components/brand/CocoaWordmark';
import { ConnectionStatus } from '@/components/layout/ConnectionStatus';
import { ForecastChips } from '@/components/layout/ForecastChips';
import { useAgentStore } from '@/lib/store/agent-store';
import { useDataStore } from '@/lib/store/data-store';
import { cn } from '@/lib/utils/cn';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Cyber ticker chip ─── */

function CyberChip({
  label,
  value,
  tone = 'default',
  onClick,
  title,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'critical' | 'warning';
  onClick?: () => void;
  title?: string;
}) {
  const valueClass = cn(
    'text-[11px] font-mono font-semibold tabular-nums',
    tone === 'critical' && 'text-[var(--severity-critical,_var(--color-negative))]',
    tone === 'warning' && 'text-[var(--color-warning)]',
    tone === 'default' && 'text-[var(--text-primary)]',
  );
  const inner = (
    <>
      <span className="text-[var(--text-secondary)] text-[10px] font-mono">{label}</span>
      <span className={valueClass}>{value}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="flex items-center gap-1.5 rounded bg-[var(--bg-elevated)] px-2 py-0.5 transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-info)]"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 bg-[var(--bg-elevated)] rounded px-2 py-0.5">
      {inner}
    </div>
  );
}

/* ─── Header ─── */

export function Header() {
  const [time, setTime] = useState('');
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const cves = useDataStore((s) => s.cves);
  const kev = useDataStore((s) => s.kev);
  const agentStatus = useAgentStore((s) => s.status);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration guard: set mounted after first client render
  useEffect(() => setMounted(true), []);

  // Clock tick
  useEffect(() => {
    function tick() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Cyber quick tickers — critical CVE count + KEV count
  const criticalCount = cves.filter((c) => c.severity === 'critical').length;
  const kevCount = kev.length;

  return (
    <header
      className="fixed top-0 right-0 flex items-center justify-between bg-[var(--bg-surface)]"
      style={{
        height: 'var(--header-height)',
        left: 'var(--sidebar-width)',
        zIndex: 'var(--z-header)',
        // Neon brand seam along the bottom of the header.
        borderBottom: '2px solid var(--brand-accent, #00ff41)',
        boxShadow: '0 1px 0 rgba(var(--brand-accent-rgb), 0.18)',
      }}
    >
      {/* Left: Brand + live indicator */}
      <div className="flex items-center gap-3 px-4">
        <CocoaWordmark sigilSize={18} wordmarkSize={16} systemTagSize={9} />
        <ConnectionStatus />
      </div>

      {/* Center: Clock */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-mono text-[var(--text-secondary)]">
          {time}
          <span className="ml-1 text-[var(--text-dim)]">ET</span>
        </span>
      </div>

      {/* Right: Quick tickers + agent status */}
      <div className="flex items-center gap-1 px-4">
        <CyberChip
          label="CRIT"
          value={criticalCount}
          tone="critical"
          title="Ask Max about critical CVEs"
          onClick={() =>
            prefillAgent(
              `What are the ${criticalCount} critical CVEs driving today's threat level?`,
              {
                sourcePanel: 'header',
                dataType: 'critical_cves',
              },
            )
          }
        />
        <CyberChip
          label="KEV"
          value={kevCount}
          tone="warning"
          title="Ask Max about known-exploited vulnerabilities"
          onClick={() =>
            prefillAgent(
              `Summarize the ${kevCount} known-exploited vulnerabilities on the CISA KEV list right now.`,
              { sourcePanel: 'header', dataType: 'kev' },
            )
          }
        />

        {/* Phase 11.D.12 — Forecast risk + trend chips. Click → AgentDrawer
            prefill explaining the headline number. */}
        <ForecastChips />

        {/* Separator */}
        <div className="mx-2 h-4 w-px bg-[var(--border-default)]" />

        {/* Theme toggle */}
        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-dim)] transition-colors hover:text-[var(--crt-glow)]"
            aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {resolvedTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        )}

        {/* Agent status */}
        <div className="flex items-center gap-1.5">
          <AgentStatusIndicator />
          <span className="text-[10px] font-mono uppercase text-[var(--text-dim)]">
            {agentStatus}
          </span>
        </div>
      </div>
    </header>
  );
}
