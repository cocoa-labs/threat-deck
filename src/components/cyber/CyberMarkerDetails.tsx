'use client';

import { ExternalLink } from 'lucide-react';
import type { CyberGlobeMarker, Severity } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { getMarkerSourceUrl } from '@/lib/utils/cyber-markers';

const SEVERITY_BADGE_CLASSES: Record<Severity, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

interface CyberMarkerDetailsProps {
  marker: CyberGlobeMarker;
  variant?: 'compact' | 'panel';
  className?: string;
  onAnalyze?: () => void;
  onClose?: () => void;
  analyzeLabel?: string;
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        SEVERITY_BADGE_CLASSES[severity] ?? SEVERITY_BADGE_CLASSES.info,
      )}
    >
      {severity}
    </span>
  );
}

function CvssBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, (score / 10) * 100));
  const color =
    score >= 9
      ? 'bg-red-500'
      : score >= 7
        ? 'bg-orange-500'
        : score >= 4
          ? 'bg-amber-500'
          : 'bg-blue-500';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-zinc-500 uppercase tracking-wide">CVSS</span>
      <div className="h-1 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className={cn('h-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-zinc-300">{score.toFixed(1)}</span>
    </div>
  );
}

function CveBody({ marker }: { marker: CyberGlobeMarker }) {
  return (
    <>
      {marker.cveId && (
        <p className="text-[10px] font-mono text-zinc-300 tracking-wide">{marker.cveId}</p>
      )}
      {typeof marker.cvssScore === 'number' && <CvssBar score={marker.cvssScore} />}
      {typeof marker.epssPercentile === 'number' && (
        <p className="text-[10px] text-zinc-500">
          EPSS <span className="text-zinc-300 font-mono">{marker.epssPercentile.toFixed(0)}%</span>
        </p>
      )}
      {marker.kevStatus === 'kev_listed' && (
        <span className="inline-flex items-center rounded border border-red-500/40 bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300">
          CISA KEV
        </span>
      )}
      {marker.affectedVendors && marker.affectedVendors.length > 0 && (
        <p className="truncate text-[10px] text-zinc-400">
          {marker.affectedVendors.slice(0, 3).join(' . ')}
        </p>
      )}
    </>
  );
}

function BreachBody({ marker }: { marker: CyberGlobeMarker }) {
  return (
    <>
      {marker.victimOrg && (
        <p className="text-[10px] font-medium text-zinc-200">{marker.victimOrg}</p>
      )}
      {marker.victimIndustry && (
        <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{marker.victimIndustry}</p>
      )}
      {typeof marker.recordsCompromised === 'number' && (
        <p className="text-[10px] text-zinc-400">
          <span className="font-mono text-zinc-300">
            {marker.recordsCompromised.toLocaleString()}
          </span>{' '}
          records exposed
        </p>
      )}
      {marker.disclosedAt && (
        <p className="text-[9px] text-zinc-500">Disclosed {marker.disclosedAt.slice(0, 10)}</p>
      )}
    </>
  );
}

function ThreatActorBody({ marker }: { marker: CyberGlobeMarker }) {
  return (
    <>
      {marker.actorAliases && marker.actorAliases.length > 0 && (
        <p className="text-[10px] italic text-zinc-400">
          aka {marker.actorAliases.slice(0, 3).join(' / ')}
        </p>
      )}
      {marker.techniques && marker.techniques.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {marker.techniques.slice(0, 4).map((technique) => (
            <span
              key={technique}
              className="inline-flex rounded border border-violet-500/30 bg-violet-500/10 px-1 py-0.5 text-[9px] font-mono text-violet-300"
            >
              {technique}
            </span>
          ))}
        </div>
      )}
      {marker.lastActiveAt && (
        <p className="text-[9px] text-zinc-500">Last active {marker.lastActiveAt}</p>
      )}
    </>
  );
}

function AiIncidentBody({ marker }: { marker: CyberGlobeMarker }) {
  return (
    <>
      {marker.affectedVendors && marker.affectedVendors.length > 0 && (
        <p className="text-[10px] text-cyan-300">{marker.affectedVendors[0]}</p>
      )}
      {marker.description && (
        <p className="line-clamp-2 text-[10px] text-zinc-400">{marker.description}</p>
      )}
    </>
  );
}

function IocBody({ marker }: { marker: CyberGlobeMarker }) {
  return (
    <>
      {marker.iocType && (
        <span className="inline-flex rounded border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-orange-300">
          {marker.iocType}
        </span>
      )}
      {marker.iocValue && (
        <p className="truncate text-[10px] font-mono text-zinc-300">
          {marker.iocValue.length > 40 ? `${marker.iocValue.slice(0, 37)}...` : marker.iocValue}
        </p>
      )}
    </>
  );
}

function CriticalInfraBody({ marker }: { marker: CyberGlobeMarker }) {
  return (
    <>
      {marker.affectedVendors && marker.affectedVendors.length > 0 && (
        <p className="text-[10px] text-zinc-300">{marker.affectedVendors[0]}</p>
      )}
      {marker.description && (
        <p className="line-clamp-2 text-[10px] text-zinc-500">{marker.description}</p>
      )}
    </>
  );
}

function CategoryBody({ marker }: { marker: CyberGlobeMarker }) {
  switch (marker.cyberCategory) {
    case 'cve':
      return <CveBody marker={marker} />;
    case 'breach':
      return <BreachBody marker={marker} />;
    case 'threat_actor':
      return <ThreatActorBody marker={marker} />;
    case 'ai_incident':
    case 'ai_safety':
      return <AiIncidentBody marker={marker} />;
    case 'ioc':
      return <IocBody marker={marker} />;
    case 'critical_infra':
      return <CriticalInfraBody marker={marker} />;
  }
}

export function CyberMarkerDetails({
  marker,
  variant = 'compact',
  className,
  onAnalyze,
  onClose,
  analyzeLabel = 'Analyze',
}: CyberMarkerDetailsProps) {
  const sourceUrl = getMarkerSourceUrl(marker);
  const isPanel = variant === 'panel';

  return (
    <div
      className={cn(
        'font-mono',
        isPanel ? 'w-80 space-y-3 p-4' : 'min-w-[180px] max-w-[240px] space-y-1.5 px-3 py-2',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              'font-medium text-zinc-200 leading-tight',
              isPanel ? 'text-sm' : 'text-xs',
            )}
          >
            {marker.label}
          </p>
          {isPanel && marker.description && (
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{marker.description}</p>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Close detail panel"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={marker.severity} />
        <span className="inline-flex rounded border border-zinc-700/60 bg-zinc-800/60 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-zinc-400">
          {marker.cyberCategory.replace('_', ' ')}
        </span>
        {marker.streamSource && (
          <span className="inline-flex rounded border border-zinc-700/60 bg-zinc-950/50 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide text-zinc-500">
            {marker.streamSource.replace('_', ' ')}
          </span>
        )}
      </div>

      <div
        className={cn('space-y-1', isPanel && 'rounded border border-zinc-800/80 bg-black/20 p-2')}
      >
        <CategoryBody marker={marker} />
      </div>

      {isPanel && (
        <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500">
          <div>
            <span className="block uppercase tracking-wide text-zinc-600">Precision</span>
            <span className="text-zinc-300">{marker.locationPrecision ?? marker.zoomTier}</span>
          </div>
          <div>
            <span className="block uppercase tracking-wide text-zinc-600">Confidence</span>
            <span className="text-zinc-300">
              {typeof marker.locationConfidence === 'number'
                ? `${Math.round(marker.locationConfidence * 100)}%`
                : 'n/a'}
            </span>
          </div>
          <div>
            <span className="block uppercase tracking-wide text-zinc-600">Latitude</span>
            <span className="text-zinc-300">{marker.lat.toFixed(2)}</span>
          </div>
          <div>
            <span className="block uppercase tracking-wide text-zinc-600">Longitude</span>
            <span className="text-zinc-300">{marker.lon.toFixed(2)}</span>
          </div>
        </div>
      )}

      {!isPanel && marker.description && (
        <p className="line-clamp-2 text-[10px] text-zinc-400">{marker.description}</p>
      )}

      {(sourceUrl || onAnalyze) && (
        <div
          className={cn(
            'flex items-center gap-2',
            isPanel ? 'border-t border-zinc-800/80 pt-3' : 'pt-1',
          )}
        >
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ pointerEvents: 'auto' }}
              className="inline-flex items-center gap-1 text-[9px] text-cyan-400 hover:text-cyan-300"
            >
              <ExternalLink size={9} />
              source
            </a>
          )}
          {onAnalyze && (
            <button
              type="button"
              onClick={onAnalyze}
              className="ml-auto rounded border border-[var(--color-info)]/25 bg-[var(--color-info)]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/15"
            >
              {analyzeLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
