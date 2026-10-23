'use client';

import type { UnifiedMarkerResult } from '@/lib/hooks/use-unified-marker';
import { TooltipAgentIntel } from './TooltipAgentIntel';
import { TooltipBase } from './TooltipBase';
import { TooltipCongress } from './TooltipCongress';
import { TooltipContract } from './TooltipContract';
import { TooltipNews } from './TooltipNews';
import { TooltipWhale } from './TooltipWhale';

export { TooltipCluster } from './TooltipCluster';

/** Dispatches to the correct tooltip template based on marker type and raw data.
 *  Accepts `now` timestamp to avoid impure Date.now() calls during render. */
export function getTooltipContent(result: UnifiedMarkerResult, now: number) {
  if (!result) return null;

  if (result.type === 'agent') {
    const m = result.marker;
    const elapsed = (now - m.createdAt) / 1000;
    const remaining = Math.max(0, m.ttl - elapsed);
    return (
      <div>
        <p className="text-xs font-semibold text-[var(--text-primary)] leading-snug mb-1">
          {m.label}
        </p>
        <TooltipAgentIntel
          severity={m.severity}
          confidence={m.confidence}
          description={m.description}
          remainingSeconds={remaining}
        />
      </div>
    );
  }

  const { marker, hotspot } = result;
  const raw = marker.rawData;

  // Determine source-specific content
  let sourceContent: React.ReactNode = null;

  if (raw?.txSymbol) {
    sourceContent = (
      <TooltipWhale
        txSymbol={raw.txSymbol}
        blockchain={raw.blockchain}
        amountUsd={raw.amountUsd}
        fromAddress={raw.fromAddress}
        toAddress={raw.toAddress}
      />
    );
  } else if (raw?.member) {
    sourceContent = (
      <TooltipCongress
        member={raw.member}
        party={raw.party}
        chamber={raw.chamber}
        transactionType={raw.transactionType}
        tradeSymbol={raw.tradeSymbol}
        tradeAmount={raw.tradeAmount}
      />
    );
  } else if (raw?.contractor) {
    sourceContent = (
      <TooltipContract
        contractor={raw.contractor}
        agency={raw.agency}
        contractAmount={raw.contractAmount}
      />
    );
  } else if (raw?.newsSource) {
    sourceContent = <TooltipNews newsSource={raw.newsSource} publishedAt={raw.publishedAt} />;
  }

  // Description (truncated for tooltip)
  const desc = hotspot?.description ?? marker.description ?? '';
  const truncatedDesc = desc.length > 100 ? `${desc.slice(0, 100)}...` : desc;

  return (
    <div>
      <TooltipBase
        label={marker.label}
        severity={marker.severity}
        category={marker.category}
        timestamp={marker.timestamp}
      />
      {truncatedDesc && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--text-dim)]">{truncatedDesc}</p>
      )}
      {sourceContent}
    </div>
  );
}
