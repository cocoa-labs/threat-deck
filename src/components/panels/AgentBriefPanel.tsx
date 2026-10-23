'use client';

import { BookOpen, FileText, MessageSquare, Shield, Trash2, Zap } from 'lucide-react';
import { useCallback } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { Badge } from '@/components/ui/Badge';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { useAgentStore } from '@/lib/store/agent-store';
import type { BriefFormat, BriefSummary } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { highlightMonetary } from '@/lib/utils/highlight-monetary';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Format badge config ─── */

const FORMAT_CONFIG: Record<
  BriefFormat,
  { label: string; icon: typeof Zap; badgeVariant: 'amber' | 'blue' | 'purple' }
> = {
  flash: { label: 'FLASH', icon: Zap, badgeVariant: 'amber' },
  standard: { label: 'STANDARD', icon: FileText, badgeVariant: 'blue' },
  deep_dive: { label: 'EXTENDED', icon: BookOpen, badgeVariant: 'purple' },
  extended: { label: 'EXTENDED', icon: BookOpen, badgeVariant: 'purple' },
};

/* ─── Content preview helper ─── */

const SKIP_PATTERNS = /^(#+\s|---|\*?\*?BLUF|\*?\*?Classification|\|.*\|)/;

function getContentPreview(content: string): string {
  // Find the BLUF content first — it's the best summary
  const blufMatch = content.match(/\*?\*?BLUF:?\*?\*?\s*(.+)/i);
  if (blufMatch?.[1]) {
    const bluf = blufMatch[1].replace(/\*\*/g, '').trim();
    if (bluf.length > 20) return bluf.slice(0, 200);
  }

  // Fallback: first substantive lines that aren't headers/separators/tables
  return content
    .split('\n')
    .map((l) => l.replace(/\*\*/g, '').trim())
    .filter((l) => l.length > 10 && !SKIP_PATTERNS.test(l))
    .slice(0, 2)
    .join(' ')
    .slice(0, 200);
}

/* ─── Confidence Badge ─── */

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const isHigh = confidence.toLowerCase().includes('high') || parseInt(confidence, 10) >= 80;
  const isMedium =
    confidence.toLowerCase().includes('medium') ||
    (parseInt(confidence, 10) >= 50 && parseInt(confidence, 10) < 80);

  const variant = isHigh ? 'green' : isMedium ? 'amber' : 'muted';

  return (
    <Badge variant={variant} size="xs" icon={<Shield size={8} />}>
      {confidence}
    </Badge>
  );
}

function askAboutBrief(brief: BriefSummary) {
  prefillAgent(
    `Expand on this brief: "${brief.headline}". What changed and what should I watch next?`,
    {
      sourcePanel: 'agentBrief',
      dataType: 'brief',
      trendData: { headline: brief.headline, briefId: brief.id, format: brief.format },
    },
  );
}

/* ─── Brief Card ─── */

function BriefCard({
  brief,
  onClick,
  onDelete,
  onAsk,
}: {
  brief: BriefSummary;
  onClick?: () => void;
  onDelete?: () => void;
  onAsk?: () => void;
}) {
  const config = FORMAT_CONFIG[brief.format] ?? FORMAT_CONFIG.standard;
  const Icon = config.icon;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: conditionally interactive based on onClick prop
    <div
      className={cn('space-y-2', onClick && 'cursor-pointer hover:opacity-90')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
    >
      {/* Meta row: format badge + confidence + time + delete */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Format badge */}
        <Badge variant={config.badgeVariant} size="xs" icon={<Icon size={8} />}>
          {config.label}
        </Badge>

        {/* Confidence */}
        {brief.confidence && <ConfidenceBadge confidence={brief.confidence} />}

        {/* Timestamp */}
        <span className="text-[8px] font-mono text-[var(--text-muted)]">
          {formatRelativeTime(brief.timestamp)}
        </span>

        {/* Ask Max about this brief */}
        {onAsk && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAsk();
            }}
            className="p-0.5 rounded hover:bg-[var(--color-info)]/10 text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors"
            title="Ask about this brief"
          >
            <MessageSquare size={10} />
          </button>
        )}

        {/* Delete button */}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-0.5 rounded hover:bg-[var(--color-negative)]/10 text-[var(--text-muted)] hover:text-[var(--color-negative)] transition-colors"
            title="Delete brief"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>

      {/* Headline */}
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--text-primary)] leading-snug">
        {brief.headline}
      </h3>

      {/* Content preview */}
      {brief.content && (
        <p className="text-[9px] font-mono text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
          {highlightMonetary(getContentPreview(brief.content))}
        </p>
      )}
    </div>
  );
}

/* ─── AgentBriefPanel ─── */

export function AgentBriefPanel() {
  const recentBriefs = useAgentStore((s) => s.recentBriefs);
  const removeBrief = useAgentStore((s) => s.removeBrief);

  const latestBrief = recentBriefs.length > 0 ? recentBriefs[0] : null;

  const handleBriefClick = useCallback((brief: BriefSummary) => {
    if (brief.content) {
      const { setLatestResponse, setDrawerOpen } = useAgentStore.getState();
      setLatestResponse({ text: brief.content, toolCalls: [], model: '' });
      setDrawerOpen(true);
    }
  }, []);

  return (
    <PanelShell id="agentBrief" title={`${AGENT_IDENTITY.name.toUpperCase()} BRIEF`} span={1}>
      {!latestBrief ? (
        <div className="flex flex-col h-full min-h-[80px] items-center justify-center gap-2">
          <FileText size={20} className="text-[var(--text-muted)]" />
          <span className="text-[10px] font-mono text-[var(--text-muted)] text-center leading-relaxed">
            No briefs yet. Ask {AGENT_IDENTITY.name} to generate one.
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Latest brief */}
          <BriefCard
            brief={latestBrief}
            onClick={() => handleBriefClick(latestBrief)}
            onDelete={() => removeBrief(latestBrief.id)}
            onAsk={() => askAboutBrief(latestBrief)}
          />

          {/* Previous briefs (compact list) */}
          {recentBriefs.length > 1 && (
            <>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[8px] font-mono font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                  Previous
                </span>
                <div className="flex-1 h-px bg-[var(--border-subtle)]" />
              </div>

              <div className="space-y-1">
                {recentBriefs.slice(1, 4).map((brief) => {
                  const bConfig = FORMAT_CONFIG[brief.format] ?? FORMAT_CONFIG.standard;
                  const BIcon = bConfig.icon;

                  return (
                    // biome-ignore lint/a11y/useSemanticElements: nested delete button prevents using <button>
                    <div
                      key={brief.id}
                      className="group flex items-center gap-2 py-1 px-1 rounded hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                      onClick={() => handleBriefClick(brief)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') handleBriefClick(brief);
                      }}
                    >
                      <BIcon size={10} className="shrink-0 text-[var(--text-dim)]" />
                      <span className="text-[var(--text-xs)] text-[var(--text-secondary)] truncate flex-1">
                        {brief.headline}
                      </span>
                      <span className="text-[8px] font-mono text-[var(--text-muted)] shrink-0">
                        {formatRelativeTime(brief.timestamp)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBrief(brief.id);
                        }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--color-negative)]/10 text-[var(--text-muted)] hover:text-[var(--color-negative)] transition-all"
                        title="Delete brief"
                      >
                        <Trash2 size={9} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </PanelShell>
  );
}
