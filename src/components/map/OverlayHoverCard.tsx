'use client';

import { useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-map-gl/mapbox';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import { useAgentStore } from '@/lib/store/agent-store';
import { type OverlayLayerType, useMapStore } from '@/lib/store/map-store';
import { cn } from '@/lib/utils/cn';
import { prefillAgent } from '@/lib/utils/panel-actions';

// ─── Constants ───

const POPUP_OFFSET = 14;
const SAFE_MARGIN = 16;
const DRAWER_WIDTH = 420;
const DRAWER_MARGIN = 16;

// ─── Accent colors by layer type ───

const LAYER_ACCENT: Record<OverlayLayerType, string> = {
  military_base: '#00ff88',
  infrastructure: '#00ff41',
  conflict_zone: '#ff4444',
};

const INFRA_CATEGORY_COLOR: Record<string, string> = {
  transport: '#e8e8e8',
  energy: '#ffaa00',
  technology: '#00ff41',
  telecom: '#44ff88',
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ff0040',
  high: '#ff4444',
  medium: '#ffaa00',
};

const SIGNIFICANCE_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

// ─── Positioning ───

function computePosition(
  cursorPx: { x: number; y: number },
  mapRect: DOMRect,
  popupWidth: number,
  popupHeight: number,
  drawerOpen: boolean,
) {
  const viewportX = mapRect.left + cursorPx.x;
  const viewportY = mapRect.top + cursorPx.y;

  const rightEdge = drawerOpen
    ? window.innerWidth - DRAWER_WIDTH - DRAWER_MARGIN
    : window.innerWidth - SAFE_MARGIN;
  const leftEdge = SAFE_MARGIN;
  const topEdge = SAFE_MARGIN;
  const bottomEdge = window.innerHeight - SAFE_MARGIN;

  let popupX = viewportX - popupWidth / 2;
  let popupY = viewportY - POPUP_OFFSET - popupHeight;
  let flippedBelow = false;

  if (popupX + popupWidth > rightEdge) popupX = rightEdge - popupWidth;
  if (popupX < leftEdge) popupX = leftEdge;

  if (popupY < topEdge) {
    popupY = viewportY + POPUP_OFFSET;
    flippedBelow = true;
  }

  if (flippedBelow && popupY + popupHeight > bottomEdge) {
    popupY = bottomEdge - popupHeight;
  }

  if (drawerOpen && viewportX > window.innerWidth - DRAWER_WIDTH) {
    popupX = Math.min(popupX, rightEdge - popupWidth);
  }

  return { x: popupX, y: popupY };
}

// ─── Ask Max handlers ───

function askKlammerMilitary(props: Record<string, unknown>) {
  const name = (props.name as string) ?? 'Unknown Base';
  const country = (props.country as string) ?? '';
  const type = (props.type as string) ?? '';
  const significance = (props.significance as string) ?? '';
  const description = (props.description as string) ?? '';
  const url = (props.url as string) ?? '';

  const prompt = `Intelligence brief on military installation: "${name}" (${country}, ${type} base, ${significance} significance). ${description}. Use web_search to find latest activity, deployments, exercises, and strategic developments at this facility. Assess current operational tempo and regional implications.`;

  prefillAgent(prompt, {
    sourcePanel: 'map',
    dataType: 'military_base',
    trendData: { name, country, type, significance, description, sourceUrl: url || undefined },
  });
}

function askKlammerInfrastructure(props: Record<string, unknown>) {
  const name = (props.name as string) ?? 'Unknown Facility';
  const type = (props.type as string) ?? '';
  const category = (props.category as string) ?? '';
  const significance = (props.significance as string) ?? '';
  const description = (props.description as string) ?? '';
  const url = (props.url as string) ?? '';

  const prompt = `Intelligence assessment of critical infrastructure: "${name}" (${category}/${type}, ${significance} significance). ${description}. Use web_search to determine current operational status, recent disruptions, security incidents, and strategic vulnerability assessment.`;

  prefillAgent(prompt, {
    sourcePanel: 'map',
    dataType: 'infrastructure',
    trendData: { name, type, category, significance, description, sourceUrl: url || undefined },
  });
}

function askKlammerConflict(props: Record<string, unknown>) {
  const name = (props.name as string) ?? 'Unknown Zone';
  const severity = (props.severity as string) ?? '';
  const category = (props.category as string) ?? '';
  const description = (props.description as string) ?? '';
  const url = (props.url as string) ?? '';

  const prompt = `Situation report on conflict zone: "${name}" (${severity} severity, ${category}). ${description}. Use web_search to find latest developments, casualty reports, ceasefire status, and escalation risk assessment. Provide 48-hour outlook.`;

  prefillAgent(prompt, {
    sourcePanel: 'map',
    dataType: 'conflict_zone',
    trendData: { name, severity, category, description, sourceUrl: url || undefined },
  });
}

// ─── Card Content Components ───

function MilitaryBaseCard({ props }: { props: Record<string, unknown> }) {
  const name = (props.name as string) ?? 'Unknown Base';
  const country = (props.country as string) ?? '';
  const type = (props.type as string) ?? '';
  const significance = (props.significance as string) ?? '';
  const description = (props.description as string) ?? '';
  const url = (props.url as string) ?? '';
  const badgeClasses = SIGNIFICANCE_BADGE[significance] ?? SIGNIFICANCE_BADGE.low;

  return (
    <div className="p-3 min-w-[320px] max-w-[400px]">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{name}</h4>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: 'rgba(0, 255, 136, 0.15)',
            color: '#00ff88',
            borderColor: 'rgba(0, 255, 136, 0.3)',
          }}
        >
          MILITARY · {type}
        </span>
        <span
          className={cn(
            'inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
            badgeClasses,
          )}
        >
          {significance}
        </span>
      </div>

      <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
        <p>
          <span className="text-[var(--text-muted)]">Country:</span> {country}
        </p>
        <p>
          <span className="text-[var(--text-muted)]">Type:</span> {type}
        </p>
      </div>

      {description && (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-dim)]">{description}</p>
      )}

      {url && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
            {country} military
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-[var(--color-info)] hover:underline truncate max-w-[140px]"
          >
            source reference
          </a>
        </div>
      )}

      <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => askKlammerMilitary(props)}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-info)]/20 bg-[var(--color-info)]/5 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/10"
        >
          {AGENT_IDENTITY.askLabel}
        </button>
      </div>
    </div>
  );
}

function InfrastructureCard({ props }: { props: Record<string, unknown> }) {
  const name = (props.name as string) ?? 'Unknown Facility';
  const type = (props.type as string) ?? '';
  const category = (props.category as string) ?? '';
  const significance = (props.significance as string) ?? '';
  const description = (props.description as string) ?? '';
  const url = (props.url as string) ?? '';
  const accentColor = INFRA_CATEGORY_COLOR[category] ?? '#888888';
  const badgeClasses = SIGNIFICANCE_BADGE[significance] ?? SIGNIFICANCE_BADGE.low;

  return (
    <div className="p-3 min-w-[320px] max-w-[400px]">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{name}</h4>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: `${accentColor}15`,
            color: accentColor,
            borderColor: `${accentColor}30`,
          }}
        >
          INFRASTRUCTURE · {category}
        </span>
        <span
          className={cn(
            'inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
            badgeClasses,
          )}
        >
          {significance}
        </span>
      </div>

      <div className="mt-2 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
        <p>
          <span className="text-[var(--text-muted)]">Type:</span> {type}
        </p>
        <p>
          <span className="text-[var(--text-muted)]">Category:</span> {category}
        </p>
      </div>

      {description && (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-dim)]">{description}</p>
      )}

      {url && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
            {category}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-[var(--color-info)] hover:underline truncate max-w-[140px]"
          >
            source reference
          </a>
        </div>
      )}

      <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => askKlammerInfrastructure(props)}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-info)]/20 bg-[var(--color-info)]/5 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/10"
        >
          {AGENT_IDENTITY.askLabel}
        </button>
      </div>
    </div>
  );
}

function ConflictZoneCard({ props }: { props: Record<string, unknown> }) {
  const name = (props.name as string) ?? 'Unknown Zone';
  const severity = (props.severity as string) ?? '';
  const category = (props.category as string) ?? '';
  const description = (props.description as string) ?? '';
  const url = (props.url as string) ?? '';
  const accentColor = SEVERITY_COLOR[severity] ?? '#ffaa00';

  return (
    <div className="p-3 min-w-[320px] max-w-[400px]">
      <h4 className="text-xs font-semibold text-[var(--text-primary)] leading-snug">{name}</h4>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: `${accentColor}20`,
            color: accentColor,
            borderColor: `${accentColor}40`,
          }}
        >
          CONFLICT · {category}
        </span>
        <span
          className="inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: `${accentColor}15`,
            color: accentColor,
            borderColor: `${accentColor}30`,
          }}
        >
          {severity}
        </span>
      </div>

      {description && (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-dim)]">{description}</p>
      )}

      {url && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
            {category}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] text-[var(--color-info)] hover:underline truncate max-w-[140px]"
          >
            source reference
          </a>
        </div>
      )}

      <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]">
        <button
          type="button"
          onClick={() => askKlammerConflict(props)}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--color-info)]/20 bg-[var(--color-info)]/5 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/10"
        >
          {AGENT_IDENTITY.askLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Inner component (renders when portal exists) ───

function OverlayHoverCardInner({ portalEl }: { portalEl: HTMLDivElement }) {
  const { current: mapInstance } = useMap();
  const cardRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hoveredOverlayFeature = useMapStore((s) => s.hoveredOverlayFeature);
  const setHoveredOverlayFeature = useMapStore((s) => s.setHoveredOverlayFeature);
  const setOverlayHoverLocked = useMapStore((s) => s.setOverlayHoverLocked);
  const drawerOpen = useAgentStore((s) => s.drawerOpen);

  const handleCardMouseEnter = useCallback(() => {
    setOverlayHoverLocked(true);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [setOverlayHoverLocked]);

  const handleCardMouseLeave = useCallback(() => {
    setOverlayHoverLocked(false);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = setTimeout(() => {
      setHoveredOverlayFeature(null);
    }, 200);
  }, [setHoveredOverlayFeature, setOverlayHoverLocked]);

  const position = useMemo(() => {
    const map = mapInstance?.getMap();
    if (!map || !hoveredOverlayFeature) return null;

    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const w = cardRef.current?.offsetWidth ?? 360;
    const h = cardRef.current?.offsetHeight ?? 200;

    return computePosition(hoveredOverlayFeature.cursorPosition, rect, w, h, drawerOpen);
  }, [hoveredOverlayFeature, drawerOpen, mapInstance]);

  if (!hoveredOverlayFeature || !position) return null;

  const borderColor = (() => {
    if (hoveredOverlayFeature.layerType === 'infrastructure') {
      const cat = (hoveredOverlayFeature.properties.category as string) ?? '';
      return INFRA_CATEGORY_COLOR[cat] ?? '#888888';
    }
    if (hoveredOverlayFeature.layerType === 'conflict_zone') {
      const sev = (hoveredOverlayFeature.properties.severity as string) ?? '';
      return SEVERITY_COLOR[sev] ?? '#ffaa00';
    }
    return LAYER_ACCENT[hoveredOverlayFeature.layerType];
  })();

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: hover tracking for sticky card dismiss
    <div
      ref={cardRef}
      className="pointer-events-auto absolute"
      style={{ left: position.x, top: position.y, zIndex: 52 }}
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
    >
      <div
        className="rounded-lg border bg-[var(--bg-surface)] shadow-lg overflow-hidden"
        style={{ borderColor: `${borderColor}40` }}
      >
        {hoveredOverlayFeature.layerType === 'military_base' && (
          <MilitaryBaseCard props={hoveredOverlayFeature.properties} />
        )}
        {hoveredOverlayFeature.layerType === 'infrastructure' && (
          <InfrastructureCard props={hoveredOverlayFeature.properties} />
        )}
        {hoveredOverlayFeature.layerType === 'conflict_zone' && (
          <ConflictZoneCard props={hoveredOverlayFeature.properties} />
        )}
      </div>
    </div>,
    portalEl,
  );
}

// ─── Main Overlay Component ───

export function OverlayHoverCard() {
  const portalEl = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return document.getElementById('map-popup-portal') as HTMLDivElement | null;
  }, []);

  if (!portalEl) return null;

  return <OverlayHoverCardInner portalEl={portalEl} />;
}
