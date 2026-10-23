'use client';

import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChannelSelector } from '@/components/panels/ChannelSelector';
import { CRTFrame } from '@/components/panels/CRTFrame';
import { FreshnessTelltale } from '@/components/panels/FreshnessTelltale';
import { useSlotId } from '@/components/panels/PanelSlot';
import { usePanelsStore } from '@/lib/store/panels-store';
import type { PanelId, SlotId } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import type { Freshness } from '@/lib/utils/freshness';

/* ─── Props ─── */

interface PanelShellProps {
  id: PanelId;
  title: string;
  subtitle?: string;
  span?: 1 | 2;
  slotId?: SlotId;
  lastUpdated?: number | null;
  freshness?: Freshness;
  noPadding?: boolean;
  className?: string;
  children: React.ReactNode;
}

/* ─── Helpers ─── */

function formatAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/* ─── PanelShell ─── */

export function PanelShell({
  id,
  title,
  subtitle,
  slotId: slotIdProp,
  lastUpdated,
  freshness,
  noPadding,
  className,
  children,
}: PanelShellProps) {
  const contextSlotId = useSlotId();
  const slotId = slotIdProp ?? contextSlotId;

  const fullscreenSlot = usePanelsStore((s) => s.fullscreenSlot);
  const setFullscreenSlot = usePanelsStore((s) => s.setFullscreenSlot);
  const toggleLeftColumn = usePanelsStore((s) => s.toggleLeftColumn);
  const toggleRightColumn = usePanelsStore((s) => s.toggleRightColumn);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [agoText, setAgoText] = useState(() => (lastUpdated != null ? formatAgo(lastUpdated) : ''));
  const titleBtnRef = useRef<HTMLButtonElement>(null);

  const isFullscreen = slotId != null && fullscreenSlot === slotId;

  const dateLabel =
    subtitle ??
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short' }).toUpperCase();

  useEffect(() => {
    if (lastUpdated == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync "ago" text on prop change + start refresh interval
    setAgoText(formatAgo(lastUpdated));
    const timerId = setInterval(() => setAgoText(formatAgo(lastUpdated)), 5_000);
    return () => clearInterval(timerId);
  }, [lastUpdated]);

  const handleFullscreenToggle = useCallback(() => {
    if (!slotId) return;
    setFullscreenSlot(isFullscreen ? null : slotId);
  }, [slotId, isFullscreen, setFullscreenSlot]);

  return (
    <CRTFrame className={cn('h-full', className)}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-3"
        style={{
          height: 'var(--panel-header)',
          borderBottom: '1px solid rgba(var(--crt-glow-rgb), 0.15)',
        }}
      >
        {/* Title — clickable for channel selector */}
        <div className="flex items-center gap-1.5 min-w-0">
          {slotId ? (
            <button
              type="button"
              ref={titleBtnRef}
              onClick={() => setSelectorOpen(!selectorOpen)}
              className="flex items-center gap-1 cursor-pointer transition-colors hover:text-[var(--text-primary)] group"
            >
              <span
                className="text-[10px] font-mono font-semibold uppercase tracking-[0.15em] transition-colors"
                style={{ color: 'var(--crt-glow)' }}
              >
                {title}
                <span className="text-[var(--text-muted)]">{' \u2014 '}</span>
                <span className="text-[var(--text-dim)] font-normal">{dateLabel}</span>
              </span>
              <ChevronDown
                size={10}
                className={cn(
                  'text-[var(--text-muted)] transition-all group-hover:text-[var(--text-secondary)]',
                  selectorOpen && 'rotate-180',
                )}
              />
            </button>
          ) : (
            <span
              className="text-[10px] font-mono font-semibold uppercase tracking-[0.15em]"
              style={{ color: 'var(--crt-glow)' }}
            >
              {title}
              <span className="text-[var(--text-muted)]">{' \u2014 '}</span>
              <span className="text-[var(--text-dim)] font-normal">{dateLabel}</span>
            </span>
          )}
        </div>

        {/* Center: freshness telltale + last-updated */}
        {(freshness || (lastUpdated != null && agoText)) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {lastUpdated != null && agoText && (
              <span className="font-mono text-[9px] leading-none text-[var(--text-dim)]">
                {agoText}
              </span>
            )}
            {freshness && <FreshnessTelltale freshness={freshness} />}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-0.5">
          {/* Column collapse toggle — only for top hero slots */}
          {slotId === 'left-1' && (
            <button
              type="button"
              onClick={toggleLeftColumn}
              className="collapse-column-btn flex h-5 w-5 items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--crt-glow)]"
              aria-label="Collapse left column"
              title="Collapse left column (\u2318[)"
            >
              <ChevronLeft size={12} />
            </button>
          )}
          {slotId === 'right-1' && (
            <button
              type="button"
              onClick={toggleRightColumn}
              className="collapse-column-btn flex h-5 w-5 items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--crt-glow)]"
              aria-label="Collapse right column"
              title="Collapse right column (\u2318])"
            >
              <ChevronRight size={12} />
            </button>
          )}
          {/* Fullscreen toggle */}
          {slotId && (
            <button
              type="button"
              onClick={handleFullscreenToggle}
              className="flex h-5 w-5 items-center justify-center text-[var(--text-dim)] transition-colors hover:text-[var(--crt-glow)]"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
        </div>
      </div>

      {/* Channel selector — portaled to body to escape overflow clipping */}
      {selectorOpen && slotId && (
        <ChannelSelector
          slotId={slotId}
          currentPanelId={id}
          anchorRef={titleBtnRef}
          onClose={() => setSelectorOpen(false)}
        />
      )}

      {/* Content */}
      <div
        className={cn(
          'flex-1',
          noPadding ? 'flex flex-col min-h-0 overflow-hidden' : 'overflow-y-auto p-3',
        )}
      >
        {children}
      </div>
    </CRTFrame>
  );
}
