'use client';

import { ExternalLink } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useMarketData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { SectorData } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatPriceChange } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Sector abbreviations ─── */

const SECTOR_ABBR: Record<string, string> = {
  Technology: 'TECH',
  Healthcare: 'HLTH',
  Financials: 'FIN',
  'Consumer Discretionary': 'DISC',
  'Consumer Staples': 'STPL',
  Energy: 'ENRG',
  Industrials: 'INDU',
  Materials: 'MTRL',
  'Real Estate': 'RLST',
  'Communication Services': 'COMM',
  Utilities: 'UTIL',
  'Information Technology': 'TECH',
};

/* ─── Color intensity based on change magnitude ─── */

function getHeatmapStyle(changePct: number): { bg: string; text: string } {
  const absChange = Math.abs(changePct);

  if (changePct > 0) {
    // Green shades - intensity based on magnitude
    if (absChange >= 3) return { bg: 'rgba(68, 255, 136, 0.35)', text: 'var(--color-positive)' };
    if (absChange >= 2) return { bg: 'rgba(68, 255, 136, 0.25)', text: 'var(--color-positive)' };
    if (absChange >= 1) return { bg: 'rgba(68, 255, 136, 0.15)', text: 'var(--color-positive)' };
    if (absChange >= 0.5) return { bg: 'rgba(68, 255, 136, 0.08)', text: 'var(--color-positive)' };
    return { bg: 'rgba(68, 255, 136, 0.04)', text: 'var(--text-dim)' };
  }

  if (changePct < 0) {
    // Red shades - intensity based on magnitude
    if (absChange >= 3) return { bg: 'rgba(255, 68, 68, 0.35)', text: 'var(--color-negative)' };
    if (absChange >= 2) return { bg: 'rgba(255, 68, 68, 0.25)', text: 'var(--color-negative)' };
    if (absChange >= 1) return { bg: 'rgba(255, 68, 68, 0.15)', text: 'var(--color-negative)' };
    if (absChange >= 0.5) return { bg: 'rgba(255, 68, 68, 0.08)', text: 'var(--color-negative)' };
    return { bg: 'rgba(255, 68, 68, 0.04)', text: 'var(--text-dim)' };
  }

  return { bg: 'var(--bg-hover)', text: 'var(--text-muted)' };
}

/* ─── Shimmer ─── */

function ShimmerBox() {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-sm)] p-2 animate-pulse bg-[var(--bg-hover)] min-h-[52px]">
      <div className="h-2.5 w-10 rounded bg-[var(--bg-elevated)]" />
      <div className="h-2 w-8 mt-1 rounded bg-[var(--bg-elevated)]" />
    </div>
  );
}

/* ─── Sector Box ─── */

function SectorBox({ sector }: { sector: SectorData }) {
  const { text } = formatPriceChange(sector.changePct);
  const style = getHeatmapStyle(sector.changePct);
  const abbr =
    SECTOR_ABBR[sector.name] ??
    sector.symbol?.replace('XL', '') ??
    sector.name.slice(0, 4).toUpperCase();
  const direction = sector.changePct >= 0 ? 'up' : 'down';

  return (
    <button
      type="button"
      className={cn(
        'relative group flex flex-col items-center justify-center rounded-[var(--radius-sm)] p-1.5 min-h-[52px]',
        'border border-transparent transition-all hover:border-[var(--border-focus)] cursor-pointer',
      )}
      style={{ backgroundColor: style.bg }}
      onClick={() =>
        prefillAgent(
          `Analyze the ${sector.name} sector which is ${direction} ${Math.abs(sector.changePct).toFixed(2)}% today. What's driving this sector's performance and what are the implications?`,
          {
            sourcePanel: 'heatmap',
            dataType: 'sector_performance',
            trendData: {
              name: sector.name,
              symbol: sector.symbol,
              changePct: sector.changePct,
              sourceUrl: `https://finance.yahoo.com/quote/${sector.symbol}`,
            },
          },
        )
      }
    >
      {sector.symbol && (
        <a
          href={`https://finance.yahoo.com/quote/${sector.symbol}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1 right-1 text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors opacity-0 group-hover:opacity-100"
        >
          <ExternalLink size={8} />
        </a>
      )}

      {/* Abbreviation */}
      <span className="text-[10px] font-mono font-bold tracking-wide text-[var(--text-primary)]">
        {abbr}
      </span>

      {/* Change % */}
      <span
        className="text-[10px] font-mono font-semibold tabular-nums mt-0.5"
        style={{ color: style.text }}
      >
        {text}
      </span>

      {/* Full name */}
      <span className="text-[7px] font-mono text-[var(--text-muted)] mt-0.5 text-center leading-tight truncate max-w-full">
        {sector.name}
      </span>
    </button>
  );
}

/* ─── SectorHeatmapPanel ─── */

export function SectorHeatmapPanel() {
  const { isLoading } = useMarketData();
  const sectors = useDataStore((s) => s.sectors);

  const hasData = sectors.length > 0;

  return (
    <PanelShell id="heatmap" title="SECTOR HEATMAP" span={1}>
      {isLoading && !hasData ? (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <ShimmerBox key={i} />
          ))}
        </div>
      ) : !hasData ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            No sector data available
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {sectors.slice(0, 12).map((sector) => (
            <SectorBox key={sector.symbol} sector={sector} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
