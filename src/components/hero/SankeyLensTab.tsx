'use client';

import { type SankeyGraph, sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMapStore } from '@/lib/store/map-store';
import { prefillAgent } from '@/lib/utils/panel-actions';
import { IntelCard, type IntelCardEntity } from './IntelCard';

/**
 * SankeyLensTab — left-to-right attack-flow diagram.
 *
 * Three columns: Actor → Campaign → Victim. Band thickness is proportional
 * to attack volume (count of edges along that path). Best for "where's the
 * volume?" questions — read the thickness, follow the color, see who's
 * hitting whom hardest.
 *
 * Selecting an actor brightens their outflows and dims the rest.
 */

type NodeKind = 'threat_actor' | 'campaign' | 'cve' | 'victim';
type EdgeKind = 'uses' | 'exploits' | 'targets';

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  data: Record<string, unknown>;
}
interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}
interface ThreatGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  count: { actors: number; campaigns: number; cves: number; victims: number };
  timestamp: string;
  error?: string;
}

interface SankeyNodeRow {
  id: string;
  label: string;
  kind: 'actor' | 'campaign' | 'victim';
  originalNode: GraphNode;
}
interface SankeyLinkRow {
  source: string;
  target: string;
  value: number;
}

const COLOR_ACTOR = '#ff0040';
const COLOR_CAMPAIGN = '#ffaa00';
const COLOR_VICTIM = '#7a8b99';
const COLOR_TEXT = '#e8e8e8';
const COLOR_TEXT_DIM = '#9ca3af';

function colorForKind(kind: 'actor' | 'campaign' | 'victim'): string {
  switch (kind) {
    case 'actor':
      return COLOR_ACTOR;
    case 'campaign':
      return COLOR_CAMPAIGN;
    case 'victim':
      return COLOR_VICTIM;
  }
}

const MARGIN = { top: 56, right: 140, bottom: 44, left: 140 };

export function SankeyLensTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [response, setResponse] = useState<ThreatGraphResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredLinkIdx, setHoveredLinkIdx] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ clientX: number; clientY: number } | null>(null);

  const selectedActorId = useMapStore((s) => s.selectedActorId);
  const setSelectedActorId = useMapStore((s) => s.setSelectedActorId);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/aegis/threat-graph')
      .then((r) => r.json() as Promise<ThreatGraphResponse>)
      .then((json) => {
        if (cancelled) return;
        setResponse(json);
        setLoadError(json.error ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load sankey');
        setResponse({
          nodes: [],
          edges: [],
          count: { actors: 0, campaigns: 0, cves: 0, victims: 0 },
          timestamp: new Date().toISOString(),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!response || size.width === 0 || size.height === 0) return null;
    if (response.nodes.length === 0) return null;

    const { nodes, edges } = response;

    // Build the 3-column sankey: actors → campaigns → victims.
    // Bypass CVEs in the Sankey (they're a side-channel, would clutter the flow);
    // they're available in the TREE / RINGS lenses if the user wants them.
    const actorNodes = nodes.filter((n) => n.kind === 'threat_actor');
    const campaignNodes = nodes.filter((n) => n.kind === 'campaign');
    const victimNodes = nodes.filter((n) => n.kind === 'victim');

    // Sankey nodes — actors (left), campaigns (middle), victims (right).
    // We also synthesize a per-actor `direct:ACTOR` pseudo-campaign in the
    // middle column for actors that hit victims with no campaign in between
    // (e.g. our seed has FIN7 → unnamed retail chain as a direct edge). The
    // pseudo-campaign keeps the Sankey topologically valid (every actor MUST
    // have at least one outgoing campaign band, or d3-sankey rejects the
    // layout) and labels itself `Direct attacks` so the story stays honest
    // about the missing intermediate.
    const directCampaignActors = new Set<string>();
    for (const e of edges) {
      if (e.kind !== 'targets') continue;
      const srcKind = nodes.find((n) => n.id === e.source)?.kind;
      if (srcKind === 'threat_actor') {
        directCampaignActors.add(e.source);
      }
    }

    const sankeyNodes: SankeyNodeRow[] = [
      ...actorNodes.map((a) => ({
        id: `actor:${a.id}`,
        label: a.label,
        kind: 'actor' as const,
        originalNode: a,
      })),
      ...campaignNodes.map((c) => ({
        id: `camp:${c.id}`,
        label: c.label,
        kind: 'campaign' as const,
        originalNode: c,
      })),
      // Synthetic "Direct attacks" pseudo-campaigns, one per actor that needs one.
      ...Array.from(directCampaignActors).map((actorId): SankeyNodeRow => {
        const actor = actorNodes.find((a) => a.id === actorId);
        return {
          id: `direct:${actorId}`,
          label: 'Direct attacks',
          kind: 'campaign' as const,
          originalNode: actor ?? {
            id: actorId,
            kind: 'campaign' as NodeKind,
            label: 'Direct attacks',
            data: {},
          },
        };
      }),
      ...victimNodes.map((v) => ({
        id: `vict:${v.id}`,
        label: v.label,
        kind: 'victim' as const,
        originalNode: v,
      })),
    ];

    // Links: actor→campaign (uses), campaign→victim (targets with campaign source),
    // and synthetic actor→direct→victim for actor source targets.
    const linkMap = new Map<string, number>();
    for (const e of edges) {
      if (e.kind === 'uses') {
        const k = `actor:${e.source}::camp:${e.target}`;
        linkMap.set(k, (linkMap.get(k) ?? 0) + 1);
        continue;
      }
      if (e.kind !== 'targets') continue;

      const srcKind = nodes.find((n) => n.id === e.source)?.kind;
      if (srcKind === 'campaign') {
        const k = `camp:${e.source}::vict:${e.target}`;
        linkMap.set(k, (linkMap.get(k) ?? 0) + 1);
      } else if (srcKind === 'threat_actor') {
        // actor → direct pseudo-campaign → victim
        const kActor = `actor:${e.source}::direct:${e.source}`;
        const kVictim = `direct:${e.source}::vict:${e.target}`;
        linkMap.set(kActor, (linkMap.get(kActor) ?? 0) + 1);
        linkMap.set(kVictim, (linkMap.get(kVictim) ?? 0) + 1);
      }
    }

    const sankeyLinks: SankeyLinkRow[] = Array.from(linkMap.entries()).map(([k, v]) => {
      const [source, target] = k.split('::');
      return { source: source as string, target: target as string, value: v };
    });

    if (sankeyLinks.length === 0) return null;

    // d3-sankey expects node objects with index/name; pass our shape and let it
    // populate x0/x1/y0/y1.
    const sankeyGen = sankey<SankeyNodeRow, SankeyLinkRow>()
      .nodeId((d) => d.id)
      .nodeWidth(14)
      .nodePadding(14)
      .extent([
        [MARGIN.left, MARGIN.top],
        [size.width - MARGIN.right, size.height - MARGIN.bottom],
      ]);

    const graph = sankeyGen({
      nodes: sankeyNodes.map((n) => ({ ...n })),
      links: sankeyLinks.map((l) => ({ ...l })),
    });

    return graph;
  }, [response, size]);

  const handleNodeClick = useCallback(
    (sankeyNode: {
      id: string;
      label: string;
      kind: 'actor' | 'campaign' | 'victim';
      originalNode: GraphNode;
    }) => {
      const og = sankeyNode.originalNode;
      if (sankeyNode.kind === 'actor') {
        const actorIdRaw = (og.data.actorId as string) ?? og.id.replace(/^actor:/, '');
        setSelectedActorId(actorIdRaw);
        prefillAgent(`Score threat actor: ${og.label}`, {
          sourcePanel: 'threatSankey',
          dataType: 'threat_actor',
          trendData: og.data,
        });
      } else if (sankeyNode.kind === 'campaign') {
        prefillAgent(`Analyze ${og.label} campaign`, {
          sourcePanel: 'threatSankey',
          dataType: 'campaign',
          trendData: og.data,
        });
      } else {
        prefillAgent(`Brief on ${og.label} incident`, {
          sourcePanel: 'threatSankey',
          dataType: 'incident',
          trendData: og.data,
        });
      }
    },
    [setSelectedActorId],
  );

  // Compute the set of node IDs in the selected actor's flow
  const flowIds = useMemo(() => {
    if (!layout || !selectedActorId) return null;
    const target = `actor:actor:${selectedActorId}`;
    const altTarget = layout.nodes.find(
      (n) =>
        (n.originalNode.data.actorId as string) === selectedActorId ||
        n.originalNode.id === selectedActorId ||
        n.originalNode.id === `actor:${selectedActorId}`,
    )?.id;
    const focal = altTarget ?? target;
    const ids = new Set<string>([focal]);
    // BFS through outgoing links
    const toVisit = [focal];
    while (toVisit.length > 0) {
      const cur = toVisit.shift()!;
      for (const l of layout.links) {
        const srcId = typeof l.source === 'string' ? l.source : (l.source as SankeyNodeRow).id;
        const tgtId = typeof l.target === 'string' ? l.target : (l.target as SankeyNodeRow).id;
        if (srcId === cur && !ids.has(tgtId)) {
          ids.add(tgtId);
          toVisit.push(tgtId);
        }
      }
    }
    return ids;
  }, [layout, selectedActorId]);

  // SINGLE STABLE ROOT — the ref must attach on first mount regardless of
  // whether we're in Loading / Empty / Render state. The previous version
  // had the ref on the Empty/Render branches but NOT the Loading branch,
  // which meant the ResizeObserver useEffect ran when ref.current was null,
  // the observer was never attached, size stayed {0,0} forever, the layout
  // useMemo bailed at the `size.width === 0` guard, isEmpty stayed true,
  // and the lens was stuck in the empty state.
  const isEmpty = response !== null && (!layout || layout.nodes.length === 0);
  const isLoading = !response;
  const linkPathGen = sankeyLinkHorizontal<SankeyNodeRow, SankeyLinkRow>();

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted,#888)]">
          Loading sankey…
        </div>
      )}
      {isEmpty && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs font-mono uppercase tracking-wider"
          style={{ color: 'var(--text-muted, #888)' }}
        >
          <span style={{ color: 'var(--crt-glow, #00ff41)' }}>● AEGIS STANDING BY</span>
          <span className="text-[10px]">
            {loadError ? `Sankey unavailable: ${loadError}` : 'No active attack flow in scope'}
          </span>
        </div>
      )}
      {layout && (
        <SankeyContent
          layout={layout}
          linkPathGen={linkPathGen}
          flowIds={flowIds}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          hoveredLinkIdx={hoveredLinkIdx}
          setHoveredLinkIdx={setHoveredLinkIdx}
          cursor={cursor}
          setCursor={setCursor}
          handleNodeClick={handleNodeClick}
          size={size}
          selectedActorId={selectedActorId}
          setSelectedActorId={setSelectedActorId}
        />
      )}
    </div>
  );
}

type SankeyLayout = SankeyGraph<SankeyNodeRow, SankeyLinkRow>;

interface SankeyContentProps {
  layout: SankeyLayout;
  linkPathGen: ReturnType<typeof sankeyLinkHorizontal<SankeyNodeRow, SankeyLinkRow>>;
  flowIds: Set<string> | null;
  hoveredId: string | null;
  setHoveredId: (v: string | null) => void;
  hoveredLinkIdx: number | null;
  setHoveredLinkIdx: (v: number | null) => void;
  cursor: { clientX: number; clientY: number } | null;
  setCursor: (v: { clientX: number; clientY: number } | null) => void;
  handleNodeClick: (n: SankeyNodeRow) => void;
  size: { width: number; height: number };
  selectedActorId: string | null;
  setSelectedActorId: (v: string | null) => void;
}

// Original SVG render extracted into a sub-component so the outer return is
// always a stable root with the ref. No behavioral change other than that.
function SankeyContent({
  layout,
  linkPathGen,
  flowIds,
  hoveredId,
  setHoveredId,
  hoveredLinkIdx,
  setHoveredLinkIdx,
  cursor,
  setCursor,
  handleNodeClick,
  size,
  selectedActorId,
  setSelectedActorId,
}: SankeyContentProps) {
  // IntelCard entity — link hover wins (the user's #1 ask was richer link
  // tooltips); fall back to node hover. setHoveredLinkIdx/Id are mutually
  // cleared by the handlers so we don't need precedence rules beyond this.
  const hoverEntity = useMemo<IntelCardEntity | null>(() => {
    if (hoveredLinkIdx != null) {
      const link = layout.links[hoveredLinkIdx];
      if (!link) return null;
      const srcNode =
        typeof link.source === 'string'
          ? layout.nodes.find((n) => n.id === link.source)
          : (link.source as SankeyNodeRow);
      const tgtNode =
        typeof link.target === 'string'
          ? layout.nodes.find((n) => n.id === link.target)
          : (link.target as SankeyNodeRow);
      if (!srcNode || !tgtNode) return null;
      return {
        kind: 'sankey_flow',
        source: {
          id: srcNode.id,
          label: srcNode.label,
          kind: srcNode.kind,
          originalData: srcNode.originalNode.data,
        },
        target: {
          id: tgtNode.id,
          label: tgtNode.label,
          kind: tgtNode.kind,
          originalData: tgtNode.originalNode.data,
        },
        value: (link as { value?: number }).value ?? 1,
      };
    }
    if (hoveredId) {
      const node = layout.nodes.find((n) => n.id === hoveredId);
      if (!node) return null;
      const og = node.originalNode;
      // Map the sankey node.kind (3 kinds) back to IntelCard's broader kinds
      // (4 kinds, since IntelCard supports CVE too — though Sankey skips CVEs).
      const kind: 'threat_actor' | 'campaign' | 'victim' =
        node.kind === 'actor' ? 'threat_actor' : node.kind;
      return { kind, label: og.label, data: og.data };
    }
    return null;
  }, [hoveredLinkIdx, hoveredId, layout]);

  return (
    <>
      <svg
        width={size.width}
        height={size.height}
        style={{ display: 'block' }}
        role="img"
        aria-label="Threat actor attack-flow sankey diagram"
        onMouseMove={(e) => setCursor({ clientX: e.clientX, clientY: e.clientY })}
        onMouseLeave={() => {
          setHoveredId(null);
          setHoveredLinkIdx(null);
          setCursor(null);
        }}
      >
        {/* <desc> is screen-reader only — does NOT trigger the browser-native
            tooltip that a <title> child would. Phase 8.12 swapped the original
            <title>…</title> for <desc>…</desc> so the IntelCard owns the
            visible hover affordance. */}
        <desc>Threat actor attack-flow sankey diagram</desc>
        {/* Column header labels */}
        <text
          x={MARGIN.left + 7}
          y={MARGIN.top - 12}
          fontSize={10}
          fill={COLOR_TEXT_DIM}
          textAnchor="middle"
          fontFamily="'Geist Mono', ui-monospace, monospace"
          style={{ letterSpacing: '0.12em' }}
        >
          ACTORS
        </text>
        <text
          x={size.width / 2}
          y={MARGIN.top - 12}
          fontSize={10}
          fill={COLOR_TEXT_DIM}
          textAnchor="middle"
          fontFamily="'Geist Mono', ui-monospace, monospace"
          style={{ letterSpacing: '0.12em' }}
        >
          CAMPAIGNS
        </text>
        <text
          x={size.width - MARGIN.right - 7}
          y={MARGIN.top - 12}
          fontSize={10}
          fill={COLOR_TEXT_DIM}
          textAnchor="middle"
          fontFamily="'Geist Mono', ui-monospace, monospace"
          style={{ letterSpacing: '0.12em' }}
        >
          VICTIMS
        </text>

        {/* Links — Phase 8.12 added hover. Each path is now an interactive
            target that opens IntelCard with kind='sankey_flow'. The user
            called the missing link tooltip out specifically as the #1 fix. */}
        {layout.links.map((link, i) => {
          const path = linkPathGen(link);
          if (!path) return null;
          const srcId =
            typeof link.source === 'string' ? link.source : (link.source as SankeyNodeRow).id;
          const tgtId =
            typeof link.target === 'string' ? link.target : (link.target as SankeyNodeRow).id;
          const inFlow = !flowIds || (flowIds.has(srcId) && flowIds.has(tgtId));
          const linkValue = (link as { value: number }).value ?? 1;
          // Heavier flows get redder; lighter green
          const intensity = Math.min(1, linkValue / 3);
          const isHovered = hoveredLinkIdx === i;
          const baseAlpha = isHovered ? 0.85 : inFlow ? 0.55 : 0.08;
          const color = `rgba(${Math.round(255 * intensity)}, ${Math.round(64 + 191 * (1 - intensity))}, ${Math.round(65 * (1 - intensity))}, ${baseAlpha})`;
          const baseWidth = Math.max(1.5, (link as { width?: number }).width ?? 1.5);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG <path> with mouse-only affordance — hover surfaces IntelCard info; the actionable element (click → AgentDrawer) lives on the <g> nodes, which DO have role+tabIndex
            <path
              key={`link-${i}`}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={isHovered ? baseWidth * 1.25 : baseWidth}
              style={{
                transition: 'stroke 200ms ease, stroke-width 200ms ease',
                cursor: 'pointer',
              }}
              onMouseEnter={() => {
                setHoveredLinkIdx(i);
                setHoveredId(null);
              }}
              onMouseLeave={() => setHoveredLinkIdx(null)}
            />
          );
        })}

        {/* Nodes */}
        {layout.nodes.map((node) => {
          const x0 = (node as { x0: number }).x0;
          const x1 = (node as { x1: number }).x1;
          const y0 = (node as { y0: number }).y0;
          const y1 = (node as { y1: number }).y1;
          const inFlow = !flowIds || flowIds.has(node.id);
          const color = colorForKind(node.kind);
          const isLeftCol = node.kind === 'actor';
          const isRightCol = node.kind === 'victim';
          return (
            // biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot contain <button> — role+tabIndex is the SVG idiom
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${node.label}`}
              style={{ cursor: 'pointer' }}
              onClick={() => handleNodeClick(node)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleNodeClick(node);
              }}
              onMouseEnter={() => {
                setHoveredId(node.id);
                setHoveredLinkIdx(null);
              }}
              onMouseLeave={() => setHoveredId(null)}
            >
              <rect
                x={x0}
                y={y0}
                width={x1 - x0}
                height={Math.max(2, y1 - y0)}
                fill={color}
                opacity={inFlow ? (hoveredId === node.id ? 1 : 0.85) : 0.18}
                stroke={hoveredId === node.id ? '#fff' : `${color}99`}
                strokeWidth={hoveredId === node.id ? 1.5 : 0.5}
                style={{ transition: 'opacity 200ms ease' }}
              />
              <text
                x={isLeftCol ? x0 - 6 : isRightCol ? x1 + 6 : (x0 + x1) / 2}
                y={(y0 + y1) / 2}
                fontSize={11}
                fill={inFlow ? COLOR_TEXT : COLOR_TEXT_DIM}
                textAnchor={isLeftCol ? 'end' : isRightCol ? 'start' : 'middle'}
                dominantBaseline="middle"
                fontFamily="'Geist Mono', ui-monospace, monospace"
                style={{ letterSpacing: '0.04em' }}
              >
                {truncate(node.label, isLeftCol || isRightCol ? 18 : 14)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Header */}
      <div
        className="absolute top-2 left-3 pointer-events-none flex items-baseline gap-3 text-[10px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <span style={{ color: 'var(--crt-glow, #00ff41)' }}>THREAT NETWORK · SANKEY</span>
        <span>· ATTACK VOLUME FLOW</span>
        <span style={{ color: '#444' }}>·</span>
        <span style={{ color: '#aaa' }}>
          {layout.nodes.filter((n) => n.kind === 'actor').length} actors →{' '}
          {layout.nodes.filter((n) => n.kind === 'campaign').length} campaigns →{' '}
          {layout.nodes.filter((n) => n.kind === 'victim').length} victims
        </span>
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-2 left-3 pointer-events-none flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <span>Flow intensity =</span>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 6,
            background: 'rgba(var(--crt-glow-rgb), 0.55)',
          }}
        />
        <span>low</span>
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 6,
            background: 'rgba(255, 0, 64, 0.55)',
          }}
        />
        <span>high attack count</span>
        {selectedActorId && (
          <>
            <span style={{ color: '#333' }}>│</span>
            <span style={{ color: 'var(--crt-glow, #00ff41)' }}>◉ LOCKED: {selectedActorId}</span>
            <button
              type="button"
              onClick={() => setSelectedActorId(null)}
              className="pointer-events-auto text-[9px]"
              style={{ color: '#888', textDecoration: 'underline' }}
            >
              clear
            </button>
          </>
        )}
      </div>

      <IntelCard entity={hoverEntity} cursor={cursor} />
    </>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
