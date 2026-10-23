'use client';

import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type MetricTickerItem,
  type TickerItem,
  useBottomNewsTickerData,
  useBottomThreatActivityTickerData,
  useTopThreatTickerData,
  useTopVulnerabilityTickerData,
} from '@/lib/hooks/use-ticker-data';
import type { Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── 3-tier severity color system ───
 * RED    = critical / high   → urgent warnings
 * AMBER  = medium            → attention / notable
 * GREEN  = low / info        → general information
 */

type Tier = 'red' | 'amber' | 'green';

function severityTier(severity: Severity): Tier {
  if (severity === 'critical' || severity === 'high') return 'red';
  if (severity === 'medium') return 'amber';
  return 'green';
}

function tierTextClass(tier: Tier): string {
  switch (tier) {
    case 'red':
      return 'text-[var(--color-negative)]';
    case 'amber':
      return 'text-[var(--color-warning)]';
    case 'green':
      return 'text-[var(--color-positive)]';
  }
}

function tierDotClass(tier: Tier): string {
  switch (tier) {
    case 'red':
      return 'bg-[var(--color-negative)] shadow-[var(--shadow-glow-negative)]';
    case 'amber':
      return 'bg-[var(--color-warning)] shadow-[0_0_6px_var(--color-warning)]';
    case 'green':
      return 'bg-[var(--color-positive)] shadow-[var(--shadow-glow-positive)]';
  }
}

function tierBgClass(tier: Tier): string {
  switch (tier) {
    case 'red':
      return 'bg-[color-mix(in_srgb,var(--color-negative)_8%,transparent)]';
    case 'amber':
      return 'bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)]';
    case 'green':
      return 'bg-[color-mix(in_srgb,var(--color-positive)_5%,transparent)]';
  }
}

function toneTextClass(tone: MetricTickerItem['tone']): string {
  switch (tone) {
    case 'positive':
      return 'text-[var(--color-positive)]';
    case 'negative':
      return 'text-[var(--color-negative)]';
    case 'neutral':
      return 'text-[var(--text-secondary)]';
  }
}

function SourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity',
        'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-info)] rounded',
        'shrink-0 ml-0.5',
      )}
      tabIndex={0}
      aria-label={label}
      title={label}
    >
      <ExternalLink size={10} aria-hidden="true" />
    </a>
  );
}

function MarqueeRow({
  children,
  direction,
  duration,
  height,
  borderTop = false,
  ariaLabel,
}: {
  children: React.ReactNode;
  direction: 'normal' | 'reverse';
  duration: number;
  height: number;
  borderTop?: boolean;
  ariaLabel: string;
}) {
  const [paused, setPaused] = useState(false);
  const animation = direction === 'normal' ? 'ticker-scroll' : 'ticker-scroll-reverse';

  return (
    <section
      aria-label={ariaLabel}
      className={cn('overflow-hidden', borderTop && 'border-t border-[rgba(255,255,255,0.04)]')}
      style={{ height }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className={cn(
          'ticker-track flex items-center whitespace-nowrap h-full',
          paused && 'ticker-paused',
        )}
        style={{
          animation: `${animation} ${duration}s linear infinite`,
        }}
      >
        {children}
      </div>
    </section>
  );
}

/* ─── Headline Ticker (threat/news rows) ─── */

function HeadlineTicker({
  items,
  direction,
  ariaLabel,
}: {
  items: TickerItem[];
  direction: 'normal' | 'reverse';
  ariaLabel: string;
}) {
  const renderItems = useMemo(() => [...items, ...items], [items]);
  const duration = useMemo(() => Math.max(36, items.length * 6), [items.length]);

  return (
    <MarqueeRow direction={direction} duration={duration} height={34} ariaLabel={ariaLabel}>
      {renderItems.map((item, idx) => {
        const tier = severityTier(item.severity);
        return (
          <span key={`${item.id}-${idx}`} className="inline-flex items-center">
            {idx > 0 && (
              <span className="px-3 text-[9px] opacity-20 text-[var(--text-dim)]" aria-hidden>
                |
              </span>
            )}
            <span
              className={cn(
                'group inline-flex items-center gap-2 text-[11px] font-mono font-medium tracking-wide',
                'transition-colors rounded px-2 py-0.5',
                tierTextClass(tier),
                tierBgClass(tier),
              )}
            >
              <span
                className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', tierDotClass(tier))}
              />
              {item.source && (
                <span className="text-[9px] opacity-50 uppercase tracking-widest">
                  {item.source}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  if (item.analyzePrompt)
                    prefillAgent(item.analyzePrompt, {
                      sourcePanel: 'ticker',
                      dataType: `${item.kind}_ticker`,
                      trendData: {
                        text: item.fullText ?? item.text,
                        severity: item.severity,
                        source: item.source,
                        sourceUrl: item.url,
                        url: item.url,
                      },
                      timestamp: item.timestamp,
                    });
                }}
                className={cn(
                  'hover:brightness-125 cursor-pointer',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-info)] rounded',
                  !item.analyzePrompt && 'cursor-default',
                )}
                tabIndex={item.analyzePrompt ? 0 : -1}
              >
                {item.text}
              </button>
              {item.timestamp && (
                <span className="text-[9px] opacity-40 ml-0.5">{item.timestamp}</span>
              )}
              {item.url && <SourceLink url={item.url} label="Open source article" />}
            </span>
          </span>
        );
      })}
    </MarqueeRow>
  );
}

/* ─── Metric Ticker (CVE/market rows) ─── */

function MetricTicker({
  items,
  direction,
  ariaLabel,
}: {
  items: MetricTickerItem[];
  direction: 'normal' | 'reverse';
  ariaLabel: string;
}) {
  const renderItems = useMemo(() => [...items, ...items], [items]);
  const duration = useMemo(() => Math.max(30, items.length * 4), [items.length]);

  return (
    <MarqueeRow
      direction={direction}
      duration={duration}
      height={26}
      borderTop
      ariaLabel={ariaLabel}
    >
      {renderItems.map((item, idx) => (
        <span key={`${item.id}-${idx}`} className="inline-flex items-center">
          {idx > 0 && (
            <span className="px-2 text-[8px] opacity-15 text-[var(--text-dim)]" aria-hidden>
              &bull;
            </span>
          )}
          <span className="group inline-flex items-center">
            <button
              type="button"
              onClick={() => {
                if (item.analyzePrompt)
                  prefillAgent(item.analyzePrompt, {
                    sourcePanel: 'ticker',
                    dataType: `${item.kind}_ticker`,
                    trendData: {
                      symbol: item.symbol,
                      value: item.value,
                      detail: item.detail,
                      severity: item.severity,
                      source: item.source,
                      sourceUrl: item.url,
                      url: item.url,
                    },
                  });
              }}
              className={cn(
                'inline-flex items-center gap-1.5 text-[10px] font-mono tracking-wide px-1.5 py-px rounded',
                'transition-colors hover:brightness-125 cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-info)]',
              )}
              tabIndex={0}
            >
              <span className="text-[var(--text-secondary)] font-semibold">{item.symbol}</span>

              <span className="text-[var(--text-primary)] opacity-80">{item.value}</span>

              <span className={cn('font-semibold', toneTextClass(item.tone))}>
                {item.tone === 'positive' ? '▲ ' : item.tone === 'negative' ? '▼ ' : ''}
                {item.detail}
              </span>
            </button>
            {item.url && <SourceLink url={item.url} label={`Open ${item.symbol} source`} />}
          </span>
        </span>
      ))}
    </MarqueeRow>
  );
}

/* ─── TickerBand Frames ─── */

function TickerBandFrame({
  placement,
  children,
}: {
  placement: 'top' | 'bottom';
  children: React.ReactNode;
}) {
  const top = placement === 'top';

  return (
    <div
      className={cn(
        'fixed right-0 overflow-hidden bg-[var(--bg-primary)]',
        top ? 'border-b border-[var(--border-default)]' : 'border-t border-[var(--border-default)]',
      )}
      style={{
        height: top ? 'var(--top-ticker-height)' : 'var(--bottom-ticker-height)',
        top: top ? 'var(--header-height)' : undefined,
        bottom: top ? undefined : 0,
        left: 'var(--sidebar-width)',
        zIndex: 'var(--z-ticker)',
        boxShadow: top ? '0 1px 8px rgba(0,0,0,0.4)' : '0 -1px 8px rgba(0,0,0,0.4)',
      }}
    >
      {children}
    </div>
  );
}

export function TopTickerBand() {
  const threatItems = useTopThreatTickerData();
  const vulnerabilityItems = useTopVulnerabilityTickerData();

  return (
    <TickerBandFrame placement="top">
      <HeadlineTicker items={threatItems} direction="normal" ariaLabel="Top threat news ticker" />
      <MetricTicker
        items={vulnerabilityItems}
        direction="reverse"
        ariaLabel="Top CVE and KEV ticker"
      />
    </TickerBandFrame>
  );
}

export function BottomTickerBand() {
  const newsItems = useBottomNewsTickerData();
  const threatActivityItems = useBottomThreatActivityTickerData();

  return (
    <TickerBandFrame placement="bottom">
      <HeadlineTicker items={newsItems} direction="reverse" ariaLabel="World context news ticker" />
      <MetricTicker
        items={threatActivityItems}
        direction="normal"
        ariaLabel="IOC and advisory activity ticker"
      />
    </TickerBandFrame>
  );
}

export function TickerBand() {
  return <TopTickerBand />;
}
