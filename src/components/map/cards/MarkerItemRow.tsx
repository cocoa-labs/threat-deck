'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { GlobeMarker, Severity } from '@/lib/types';
import { categoryToHex } from '@/lib/utils/geo';
import { prefillAgent } from '@/lib/utils/panel-actions';

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-blue-500',
  info: 'bg-zinc-500',
};

export { SEVERITY_ORDER };

interface Props {
  marker: GlobeMarker;
}

export function MarkerItemRow({ marker }: Props) {
  const [hovered, setHovered] = useState(false);

  const handleAsk = () => {
    prefillAgent(`Analyze "${marker.label}". Provide context and actionable intelligence.`, {
      sourcePanel: 'map',
      dataType: marker.source,
      trendData: {
        label: marker.label,
        severity: marker.severity,
        category: marker.category,
        ...(marker.rawData ?? {}),
        sourceUrl: marker.url,
      },
      timestamp: marker.timestamp ?? undefined,
    });
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for ask button visibility
    <div
      className="flex items-center gap-1.5 py-1 px-1.5 rounded transition-colors hover:bg-[var(--bg-primary)]/50"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: categoryToHex(marker.category) }}
      />
      <span className="text-[10px] font-mono text-[var(--text-dim)] truncate flex-1">
        {marker.label}
      </span>
      <span
        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[marker.severity]}`}
      />
      {hovered && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleAsk();
          }}
          className="shrink-0 text-[9px] font-mono font-semibold text-[var(--color-info)] hover:text-[var(--color-info)]/80 transition-colors"
        >
          Ask
        </button>
      )}
      {hovered && marker.url && (
        <a
          href={marker.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-[var(--text-muted)] hover:text-[var(--color-info)] transition-colors"
        >
          <ExternalLink size={9} />
        </a>
      )}
    </div>
  );
}
