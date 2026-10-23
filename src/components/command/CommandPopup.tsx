'use client';

import { ExternalLink } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Popup } from 'react-map-gl/mapbox';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { useMapStore } from '@/lib/store/map-store';
import type { Hotspot, Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { relativeTime } from '@/lib/utils/geo';
import { prefillAgent } from '@/lib/utils/panel-actions';

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

interface Props {
  hotspots: Hotspot[];
}

export function CommandPopup({ hotspots }: Props) {
  const commandPopupData = useMapStore((s) => s.commandPopupData);
  const setCommandPopupData = useMapStore((s) => s.setCommandPopupData);
  const selectHotspot = useMapStore((s) => s.selectHotspot);
  const selectMarker = useMapStore((s) => s.selectMarker);
  const markers = useMapStore((s) => s.markers);

  // Look up the full GlobeMarker for rawData access
  const fullMarker = useMemo(() => {
    if (!commandPopupData) return null;
    return markers.find((m) => m.id === commandPopupData.markerId) ?? null;
  }, [commandPopupData, markers]);

  const handleAskMax = useCallback(() => {
    if (!commandPopupData) return;

    // Build rich context prompt
    const rawParts: string[] = [];
    if (fullMarker?.rawData?.member) {
      const rd = fullMarker.rawData;
      rawParts.push(
        `Congress: ${rd.member} (${rd.party}) ${rd.transactionType} ${rd.tradeSymbol} ${rd.tradeAmount}`,
      );
    }
    if (fullMarker?.rawData?.contractor) {
      const rd = fullMarker.rawData;
      rawParts.push(
        `Contract: ${rd.contractor} for ${rd.agency}, $${((rd.contractAmount ?? 0) / 1_000_000).toFixed(1)}M`,
      );
    }
    if (fullMarker?.rawData?.txSymbol) {
      const rd = fullMarker.rawData;
      rawParts.push(`Whale: ${rd.txSymbol} $${((rd.amountUsd ?? 0) / 1_000_000).toFixed(1)}M`);
    }

    const contextStr = rawParts.length > 0 ? ` Context: ${rawParts.join('. ')}.` : '';
    const prompt = `Analyze "${commandPopupData.label}".${contextStr} Provide context, key data points, and actionable intelligence.`;

    prefillAgent(prompt, {
      sourcePanel: 'command',
      dataType: commandPopupData.source,
      trendData: {
        label: commandPopupData.label,
        severity: commandPopupData.severity,
        category: commandPopupData.category,
        lat: commandPopupData.lat,
        lon: commandPopupData.lon,
        ...(fullMarker?.rawData ?? {}),
        sourceUrl: fullMarker?.url,
      },
      timestamp: fullMarker?.timestamp ?? undefined,
    });
    setCommandPopupData(null);
  }, [commandPopupData, fullMarker, setCommandPopupData]);

  const handleExpand = useCallback(() => {
    if (!commandPopupData) return;

    const hotspotId = commandPopupData.markerId.replace('hotspot-', '');
    const hotspot = hotspots.find((h) => h.id === hotspotId);
    if (hotspot) {
      selectHotspot(hotspot);
      selectMarker(commandPopupData.markerId);
    }
    setCommandPopupData(null);
  }, [commandPopupData, hotspots, selectHotspot, selectMarker, setCommandPopupData]);

  const handleClose = useCallback(() => {
    setCommandPopupData(null);
  }, [setCommandPopupData]);

  if (!commandPopupData) return null;

  const badgeClasses = SEVERITY_BADGE[commandPopupData.severity] ?? SEVERITY_BADGE.info;
  const raw = fullMarker?.rawData;

  return (
    <Popup
      longitude={commandPopupData.lon}
      latitude={commandPopupData.lat}
      anchor="bottom"
      closeButton={false}
      closeOnClick={false}
      offset={24}
      className="klammer-popup"
    >
      <div className="min-w-[200px] max-w-[300px] rounded-lg border border-[#00ffaa33] bg-[#0a1628ee] p-3 shadow-lg backdrop-blur-sm">
        {/* Header with close */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-xs font-semibold text-[#ccddcc] leading-snug font-mono">
            {commandPopupData.label}
          </h4>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#556666] transition-colors hover:text-[#aaccaa]"
            aria-label="Close popup"
          >
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M8 2L2 8M2 2L8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Badges + timestamp */}
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider font-mono',
              badgeClasses,
            )}
          >
            {commandPopupData.severity}
          </span>
          <span className="text-[9px] font-mono uppercase tracking-wider text-[#557755]">
            {commandPopupData.category}
          </span>
          {fullMarker?.timestamp && (
            <span className="text-[9px] font-mono text-[#445544]">
              {relativeTime(fullMarker.timestamp)}
            </span>
          )}
        </div>

        {/* Description */}
        {commandPopupData.description && (
          <p className="mt-2 text-[10px] leading-relaxed text-[#667766] font-mono">
            {commandPopupData.description.length > 150
              ? `${commandPopupData.description.slice(0, 150)}...`
              : commandPopupData.description}
          </p>
        )}

        {/* Source-specific rawData details */}
        {raw?.member && (
          <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[#778877]">
            <p>
              <span className="text-[#556655]">Member:</span> {raw.member} ({raw.party}-
              {raw.chamber})
            </p>
            <p>
              <span className="text-[#556655]">Trade:</span> {raw.transactionType} {raw.tradeSymbol}{' '}
              — {raw.tradeAmount}
            </p>
          </div>
        )}
        {raw?.contractor && (
          <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[#778877]">
            <p>
              <span className="text-[#556655]">Contractor:</span> {raw.contractor}
            </p>
            <p>
              <span className="text-[#556655]">Agency:</span> {raw.agency}
            </p>
            {raw.contractAmount != null && (
              <p>
                <span className="text-[#556655]">Value:</span> $
                {(raw.contractAmount / 1_000_000).toFixed(1)}M
              </p>
            )}
          </div>
        )}
        {raw?.txSymbol && (
          <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[#778877]">
            <p>
              <span className="text-[#556655]">Asset:</span> {raw.txSymbol} on {raw.blockchain}
            </p>
            {raw.amountUsd != null && (
              <p>
                <span className="text-[#556655]">Value:</span> $
                {(raw.amountUsd / 1_000_000).toFixed(1)}M
              </p>
            )}
          </div>
        )}
        {raw?.newsSource && (
          <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[#778877]">
            <p>
              <span className="text-[#556655]">Source:</span> {raw.newsSource}
            </p>
          </div>
        )}

        {/* Coordinates */}
        <div className="mt-2 flex gap-3 text-[9px] text-[#445544] font-mono">
          <span>
            {Math.abs(commandPopupData.lat).toFixed(2)}
            {commandPopupData.lat >= 0 ? 'N' : 'S'}
          </span>
          <span>
            {Math.abs(commandPopupData.lon).toFixed(2)}
            {commandPopupData.lon >= 0 ? 'E' : 'W'}
          </span>
        </div>

        {/* Source link */}
        {fullMarker?.url && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[9px] font-mono text-[#445544] uppercase">source</span>
            <a
              href={fullMarker.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[9px] text-[#00ff41] hover:underline truncate max-w-[140px]"
            >
              <ExternalLink size={8} />
              source reference
            </a>
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleAskMax}
            className="flex flex-1 items-center justify-center gap-1.5 rounded border border-[#00ffaa33] bg-[#00ffaa08] px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#00ffaa] transition-colors hover:bg-[#00ffaa15]"
          >
            {AGENT_IDENTITY.askLabel}
          </button>
          <button
            type="button"
            onClick={handleExpand}
            className="flex items-center justify-center gap-1 rounded border border-[#00ffaa22] bg-[#00ffaa05] px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#557755] transition-colors hover:text-[#00ffaa] hover:bg-[#00ffaa10]"
          >
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 9V6M1 9H4M1 9L4 6M9 1V4M9 1H6M9 1L6 4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </Popup>
  );
}
