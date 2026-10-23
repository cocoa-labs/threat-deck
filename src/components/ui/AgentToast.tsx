'use client';

import { AlertTriangle, CheckCircle2, Info, Loader2, ShieldAlert, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { AutonomousResultItem, XPostJobItem } from '@/lib/store/agent-store';
import { useAgentStore } from '@/lib/store/agent-store';
import type { Severity } from '@/lib/types';

/**
 * Panel context per activation trigger. Every registered trigger must appear
 * here — `buildPrefill` early-returns on a miss and throws away `eventData`,
 * so an unmapped key means clicking that toast hands Max a bare truncated
 * prompt with no CVE id, no source, and no panel to correlate against. Only
 * `news.breaking` and `monitor.keyword_match` were mapped before, which meant
 * every cyber trigger — the ones that matter most — fell through.
 */
export const TRIGGER_CONTEXT_MAP: Record<string, { sourcePanel: string; dataType: string }> = {
  'news.breaking': { sourcePanel: 'news', dataType: 'breaking_news' },
  'monitor.keyword_match': { sourcePanel: 'monitors', dataType: 'keyword_match' },
  'cve.kev_added': { sourcePanel: 'kevAlerts', dataType: 'kev' },
  'breach.disclosed': { sourcePanel: 'breachDisclosure', dataType: 'breach' },
  'patch.released': { sourcePanel: 'patchTracker', dataType: 'patch' },
  'advisory.published': { sourcePanel: 'patchTracker', dataType: 'advisory' },
  'schedule.morning_brief': { sourcePanel: 'agentBrief', dataType: 'schedule' },
  'schedule.midday_scan': { sourcePanel: 'agentBrief', dataType: 'schedule' },
  'schedule.close_summary': { sourcePanel: 'agentBrief', dataType: 'schedule' },
  'schedule.overnight_scan': { sourcePanel: 'agentBrief', dataType: 'schedule' },
};

const SEVERITY_CONFIG: Record<
  Severity,
  { icon: typeof Zap; color: string; autoDismissMs: number | null }
> = {
  critical: { icon: ShieldAlert, color: 'var(--severity-critical)', autoDismissMs: null },
  high: { icon: AlertTriangle, color: 'var(--severity-high)', autoDismissMs: null },
  medium: { icon: Zap, color: 'var(--severity-medium)', autoDismissMs: 10_000 },
  low: { icon: Info, color: 'var(--severity-low)', autoDismissMs: 10_000 },
  info: { icon: Info, color: 'var(--severity-info)', autoDismissMs: 8_000 },
};

function ToastItem({
  id,
  headline,
  severity,
  timestamp,
  onDismiss,
  onClick,
}: {
  id: string;
  headline: string;
  severity: Severity;
  timestamp: number;
  onDismiss: (id: string) => void;
  onClick: () => void;
}) {
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (config.autoDismissMs) {
      timerRef.current = setTimeout(() => onDismiss(id), config.autoDismissMs);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id, config.autoDismissMs, onDismiss]);

  const age = Date.now() - timestamp;
  const ageStr =
    age < 60_000
      ? 'just now'
      : age < 3_600_000
        ? `${Math.floor(age / 60_000)}m ago`
        : `${Math.floor(age / 3_600_000)}h ago`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: intentional div[role=button] — contains nested <button> (dismiss), cannot use <button> per HTML spec (BUG-007)
    <div
      role="button"
      tabIndex={0}
      className="flex items-start gap-2 p-3 rounded border cursor-pointer animate-[crt-data-enter_300ms_ease-out] text-left"
      style={{
        background: 'var(--bg-surface)',
        borderColor: `color-mix(in srgb, ${config.color} 40%, transparent)`,
        boxShadow: `0 0 8px color-mix(in srgb, ${config.color} 20%, transparent)`,
        maxWidth: 380,
      }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <Icon size={16} style={{ color: config.color, flexShrink: 0, marginTop: 2 }} />
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-mono font-semibold leading-tight truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {headline}
        </div>
        <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>
          {severity.toUpperCase()} &middot; {ageStr}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(id);
        }}
        className="text-[var(--text-dim)] hover:text-[var(--text-primary)] flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

const X_POST_STATUS: Record<
  XPostJobItem['status'],
  { label: string; color: string; sticky: boolean }
> = {
  queued: { label: 'Posting to X…', color: 'var(--severity-info)', sticky: true },
  generating_image: {
    label: 'Generating infographic…',
    color: 'var(--severity-info)',
    sticky: true,
  },
  posting: { label: 'Posting to X…', color: 'var(--severity-info)', sticky: true },
  posted: { label: 'Posted to X ✓', color: 'var(--severity-low)', sticky: false },
  needs_reconnect: { label: 'Reconnect X to post', color: 'var(--severity-high)', sticky: true },
  failed: { label: 'X post failed', color: 'var(--severity-high)', sticky: true },
};

/** Toast for a background "Post to X" job — shows live progress, then the result. */
function XPostToastItem({
  job,
  onDismiss,
}: {
  job: XPostJobItem;
  onDismiss: (jobToken: string) => void;
}) {
  const cfg = X_POST_STATUS[job.status];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!cfg.sticky) {
      timerRef.current = setTimeout(() => onDismiss(job.jobToken), 12_000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cfg.sticky, job.jobToken, onDismiss]);

  const inProgress =
    job.status === 'queued' || job.status === 'generating_image' || job.status === 'posting';
  const tweetUrl = job.tweetIds[0] ? `https://x.com/i/status/${job.tweetIds[0]}` : null;

  return (
    <div
      className="flex items-start gap-2 p-3 rounded border animate-[crt-data-enter_300ms_ease-out]"
      style={{
        background: 'var(--bg-surface)',
        borderColor: `color-mix(in srgb, ${cfg.color} 40%, transparent)`,
        boxShadow: `0 0 8px color-mix(in srgb, ${cfg.color} 20%, transparent)`,
        maxWidth: 380,
      }}
    >
      {inProgress ? (
        <Loader2
          size={16}
          className="animate-spin"
          style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }}
        />
      ) : job.status === 'posted' ? (
        <CheckCircle2 size={16} style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }} />
      ) : (
        <AlertTriangle size={16} style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }} />
      )}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-mono font-semibold leading-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          {cfg.label}
        </div>
        <div className="text-[10px] font-mono mt-0.5 truncate" style={{ color: 'var(--text-dim)' }}>
          {job.primaryTextPreview}
        </div>
        {job.status === 'posted' && tweetUrl && (
          <a
            href={tweetUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-mono mt-1 inline-block"
            style={{ color: cfg.color, textDecoration: 'underline' }}
          >
            View on X →
          </a>
        )}
        {job.status === 'needs_reconnect' && (
          <a
            href="/api/twitter/oauth/start"
            className="text-[10px] font-mono mt-1 inline-block"
            style={{ color: cfg.color, textDecoration: 'underline' }}
          >
            Reconnect X →
          </a>
        )}
        {job.status === 'failed' && job.errorMessage && (
          <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-dim)' }}>
            {job.errorMessage}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(job.jobToken)}
        className="text-[var(--text-dim)] hover:text-[var(--text-primary)] flex-shrink-0"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function buildPrefill(result: AutonomousResultItem): string {
  const prompt = `Follow up on this autonomous analysis: ${result.text.slice(0, 200)}...`;

  if (!result.eventData) return prompt;

  const mapping = TRIGGER_CONTEXT_MAP[result.triggerSource];
  if (!mapping) return prompt;

  const context = {
    sourcePanel: mapping.sourcePanel,
    dataType: mapping.dataType,
    trendData: result.eventData,
    timestamp: new Date(result.timestamp).toISOString(),
  };

  return `${prompt}\n\n<context>${JSON.stringify(context)}</context>`;
}

export function AgentToast() {
  const results = useAgentStore((s) => s.autonomousResults);
  const dismissResult = useAgentStore((s) => s.dismissAutonomousResult);
  const setPrefill = useAgentStore((s) => s.setPrefill);
  const xPostJobs = useAgentStore((s) => s.xPostJobs);
  const dismissXPostJob = useAgentStore((s) => s.dismissXPostJob);
  const alertsEnabled = useAgentStore((s) => s.autonomousAlertsEnabled);

  // When alerts are muted, suppress autonomous toasts entirely — including any
  // lingering sticky critical/high ones. X-post job toasts are unrelated
  // (user-initiated posts) and stay visible.
  const visible = alertsEnabled ? results.filter((r) => !r.dismissed) : [];
  const visibleXPosts = xPostJobs.filter((j) => !j.dismissed);

  const handleClick = useCallback(
    (result: AutonomousResultItem) => {
      setPrefill(buildPrefill(result));
    },
    [setPrefill],
  );

  if (visible.length === 0 && visibleXPosts.length === 0) return null;

  return (
    <div
      className="fixed flex flex-col gap-2 pointer-events-auto"
      style={{
        // Anchor ABOVE the command bar (+ bottom ticker) so the toast stack never
        // overlaps the command-bar buttons — notably the "open Max" toggle. The bar
        // top sits at (command-bar-height + bottom-ticker-height) = 110px; +12px gap.
        bottom: 'calc(var(--command-bar-height) + var(--bottom-ticker-height) + 12px)',
        right: 16,
        zIndex: 70,
      }}
    >
      {visibleXPosts.slice(0, 3).map((job) => (
        <XPostToastItem key={job.jobToken} job={job} onDismiss={dismissXPostJob} />
      ))}
      {visible.slice(0, 5).map((r) => (
        <ToastItem
          key={r.id}
          id={r.id}
          headline={r.headline}
          severity={r.severity}
          timestamp={r.timestamp}
          onDismiss={dismissResult}
          onClick={() => handleClick(r)}
        />
      ))}
    </div>
  );
}
