'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMapStore } from '@/lib/store/map-store';
import { prefillAgent } from '@/lib/utils/panel-actions';
import { IntelCard, type IntelCardEntity } from './IntelCard';

/**
 * RingsLensTab — concentric hub-and-spoke view of the threat network.
 *
 * Apex actor sits at the center; their world fans out in concentric rings:
 *   Ring 1: their campaigns
 *   Ring 2: the CVEs they exploit
 *   Ring 3: the victims they hit
 *
 * Selecting a different actor (in any lens) animates them to the center
 * via a CSS transition on each ring's transform. Looks like a NORAD-style
 * threat-prioritization radar.
 *
 * Uses SVG (not Canvas) so the animations are GPU-accelerated and the
 * nodes are individually clickable without hit-test math.
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

const COLOR_ACTOR = '#ff0040';
const COLOR_CAMPAIGN = '#ffaa00';
const COLOR_CVE = 'var(--crt-glow, #00ff41)';
const COLOR_VICTIM = '#7a8b99';
const COLOR_RING = 'rgba(var(--crt-glow-rgb), 0.08)';
const COLOR_RING_LABEL = '#666';
const COLOR_SPOKE = 'rgba(255, 255, 255, 0.12)';
const COLOR_TEXT_DIM = '#9ca3af';

// Kind→color lookup is performed inline at the call sites — explicit per-ring
// color choices are clearer than a generic helper here.

export function RingsLensTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [response, setResponse] = useState<ThreatGraphResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ clientX: number; clientY: number } | null>(null);

  const selectedActorId = useMapStore((s) => s.selectedActorId);
  const setSelectedActorId = useMapStore((s) => s.setSelectedActorId);

  // SVG-level mousemove tracks the cursor unconditionally; IntelCard only
  // renders when hoveredId is also non-null (drives the entity lookup).
  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    setCursor({ clientX: e.clientX, clientY: e.clientY });
  }, []);
  const handleSvgMouseLeave = useCallback(() => {
    setHoveredId(null);
    setCursor(null);
  }, []);

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
        setLoadError(err instanceof Error ? err.message : 'Failed to load threat rings');
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

  // Determine the apex actor for this view: selected → use that; otherwise
  // the highest-scored actor in the response.
  const apexActor: GraphNode | null = useMemo(() => {
    if (!response || response.nodes.length === 0) return null;
    const actors = response.nodes.filter((n) => n.kind === 'threat_actor');
    if (actors.length === 0) return null;
    if (selectedActorId) {
      const match = actors.find(
        (a) =>
          a.id === selectedActorId ||
          a.id === `actor:${selectedActorId}` ||
          (a.data.actorId as string) === selectedActorId,
      );
      if (match) return match;
    }
    // Sort by compositeScore desc
    return (
      actors
        .slice()
        .sort(
          (a, b) =>
            ((b.data.compositeScore as number) ?? 0) - ((a.data.compositeScore as number) ?? 0),
        )[0] ?? null
    );
  }, [response, selectedActorId]);

  // Build the ring data for the apex actor.
  const ringData = useMemo(() => {
    if (!response || !apexActor) return null;
    const { nodes, edges } = response;
    const campaigns = nodes.filter((n) => n.kind === 'campaign');
    const cves = nodes.filter((n) => n.kind === 'cve');
    const victims = nodes.filter((n) => n.kind === 'victim');

    const childrenOf = new Map<string, Set<string>>();
    for (const e of edges) {
      const set = childrenOf.get(e.source) ?? new Set<string>();
      set.add(e.target);
      childrenOf.set(e.source, set);
    }
    const isChildOf = (parent: string, child: string) =>
      childrenOf.get(parent)?.has(child) === true;

    const apexCampaigns = campaigns.filter((c) => isChildOf(apexActor.id, c.id));
    const apexCVEs = cves.filter(
      (cve) =>
        isChildOf(apexActor.id, cve.id) || apexCampaigns.some((c) => isChildOf(c.id, cve.id)),
    );
    const apexVictims = victims.filter(
      (vic) =>
        isChildOf(apexActor.id, vic.id) || apexCampaigns.some((c) => isChildOf(c.id, vic.id)),
    );

    return { campaigns: apexCampaigns, cves: apexCVEs, victims: apexVictims };
  }, [response, apexActor]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (node.kind === 'threat_actor') {
        const actorIdRaw = (node.data.actorId as string) ?? node.id.replace(/^actor:/, '');
        setSelectedActorId(actorIdRaw);
        prefillAgent(`Score threat actor: ${node.label}`, {
          sourcePanel: 'threatRings',
          dataType: 'threat_actor',
          trendData: node.data,
        });
      } else if (node.kind === 'campaign') {
        prefillAgent(`Analyze ${node.label} campaign`, {
          sourcePanel: 'threatRings',
          dataType: 'campaign',
          trendData: node.data,
        });
      } else if (node.kind === 'cve') {
        prefillAgent(`Analyze ${node.label}`, {
          sourcePanel: 'threatRings',
          dataType: 'cve',
          trendData: node.data,
        });
      } else if (node.kind === 'victim') {
        prefillAgent(`Brief on ${node.label} incident`, {
          sourcePanel: 'threatRings',
          dataType: 'incident',
          trendData: node.data,
        });
      }
    },
    [setSelectedActorId],
  );

  // SINGLE STABLE ROOT — same fix as Sankey: the ref must attach on first
  // mount regardless of state, or the ResizeObserver effect (empty deps)
  // runs while ref.current is null and never attaches. Loading / Empty /
  // SVG content render as conditional children of the always-mounted root.
  const isLoading = !response;
  const hasContent = !!response && response.nodes.length > 0 && !!apexActor && !!ringData;
  const isEmpty = !!response && !hasContent;
  const isSized = size.width > 0 && size.height > 0;

  // Geometry — only valid when sized AND has content
  const cx = size.width / 2;
  const cy = size.height / 2;
  const minDim = Math.min(size.width, size.height);
  const ring1R = minDim * 0.22; // campaigns
  const ring2R = minDim * 0.34; // cves
  const ring3R = minDim * 0.43; // victims

  const positionsOnRing = (count: number, radius: number, startAngle = -Math.PI / 2) => {
    const result: Array<{ x: number; y: number; angle: number }> = [];
    if (count === 0) return result;
    for (let i = 0; i < count; i++) {
      const angle = startAngle + (i * 2 * Math.PI) / count;
      result.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), angle });
    }
    return result;
  };

  const campaignPos = hasContent ? positionsOnRing(ringData!.campaigns.length, ring1R) : [];
  const cvePos = hasContent ? positionsOnRing(ringData!.cves.length, ring2R) : [];
  const victimPos = hasContent ? positionsOnRing(ringData!.victims.length, ring3R) : [];

  // IntelCard entity lookup — match hoveredId against apex, rings, or actor chips
  const hoverEntity: IntelCardEntity | null = useMemo(() => {
    if (!hoveredId || !response) return null;
    const node = response.nodes.find((n) => n.id === hoveredId);
    if (!node) return null;
    // node.kind is the threat-graph NodeKind; IntelCardEntity accepts the
    // same shape verbatim for 4 of its 6 kinds.
    return { kind: node.kind, label: node.label, data: node.data };
  }, [hoveredId, response]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted,#888)]">
          Loading rings…
        </div>
      )}
      {isEmpty && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs font-mono uppercase tracking-wider"
          style={{ color: 'var(--text-muted, #888)' }}
        >
          <span style={{ color: 'var(--crt-glow, #00ff41)' }}>● AEGIS STANDING BY</span>
          <span className="text-[10px]">
            {loadError ? `Rings unavailable: ${loadError}` : 'No active threat actor data in scope'}
          </span>
        </div>
      )}
      {hasContent && isSized && apexActor && ringData && (
        <>
          <svg
            width={size.width}
            height={size.height}
            style={{ display: 'block' }}
            role="img"
            aria-label="Threat actor concentric rings radar"
            onMouseMove={handleSvgMouseMove}
            onMouseLeave={handleSvgMouseLeave}
          >
            {/* <desc> is screen-reader only — does NOT trigger the browser-native
                tooltip the way <title> does. Phase 8.12 swapped the original
                <title>…</title> for this <desc>…</desc> so the IntelCard owns
                the visible hover affordance. */}
            <desc>Threat actor concentric rings radar</desc>
            {/* Three concentric rings (background) */}
            {[ring1R, ring2R, ring3R].map((r, i) => (
              <circle
                key={`ring-${i}`}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={COLOR_RING}
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            ))}

            {/* Ring labels */}
            {[
              { r: ring1R, label: 'CAMPAIGNS' },
              { r: ring2R, label: 'CVES' },
              { r: ring3R, label: 'VICTIMS' },
            ].map((row) => (
              <text
                key={row.label}
                x={cx}
                y={cy - row.r - 4}
                fontSize={9}
                fill={COLOR_RING_LABEL}
                textAnchor="middle"
                fontFamily="'Geist Mono', ui-monospace, monospace"
                style={{ letterSpacing: '0.12em' }}
              >
                {row.label}
              </text>
            ))}

            {/* Spokes from center to each campaign */}
            {ringData.campaigns.map((c, i) => {
              const p = campaignPos[i];
              if (!p) return null;
              return (
                <line
                  key={`spoke-c-${c.id}`}
                  x1={cx}
                  y1={cy}
                  x2={p.x}
                  y2={p.y}
                  stroke={COLOR_SPOKE}
                  strokeWidth={1}
                />
              );
            })}

            {/* Spokes from campaigns to CVEs / victims (when topology is known) */}
            {/* For demo simplicity, draw faint radials from center to all outer-ring entities */}
            {[...cvePos, ...victimPos].map((p, i) => (
              <line
                key={`spoke-out-${i}`}
                x1={cx}
                y1={cy}
                x2={p.x}
                y2={p.y}
                stroke="rgba(255,255,255,0.04)"
                strokeWidth={1}
              />
            ))}

            {/* Apex actor at center — decorative SVG group with synthetic button role */}
            {/* biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot contain <button> — role+tabIndex is the SVG idiom */}
            <g
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${apexActor.label}`}
              style={{ cursor: 'pointer' }}
              onClick={() => handleNodeClick(apexActor)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleNodeClick(apexActor);
              }}
              onMouseEnter={() => setHoveredId(apexActor.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Outer glow halo */}
              <circle cx={cx} cy={cy} r={36} fill={`${COLOR_ACTOR}22`} />
              <circle cx={cx} cy={cy} r={26} fill={`${COLOR_ACTOR}55`} />
              {/* Core */}
              <circle
                cx={cx}
                cy={cy}
                r={18}
                fill={COLOR_ACTOR}
                stroke="#ff5577"
                strokeWidth={hoveredId === apexActor.id ? 3 : 2}
              />
              {/* Label */}
              <text
                x={cx}
                y={cy + 50}
                fontSize={14}
                fill="#fff"
                textAnchor="middle"
                fontFamily="'Geist Mono', ui-monospace, monospace"
                style={{ letterSpacing: '0.05em', fontWeight: 700 }}
              >
                {apexActor.label}
              </text>
              {(() => {
                const grade = apexActor.data.actorGrade as string | undefined;
                const score = apexActor.data.compositeScore as number | undefined;
                if (!grade && score == null) return null;
                const text = `${grade ?? '?'}${score != null ? ` · ${score.toFixed(1)}` : ''}`;
                return (
                  <text
                    x={cx}
                    y={cy + 66}
                    fontSize={10}
                    fill={COLOR_TEXT_DIM}
                    textAnchor="middle"
                    fontFamily="'Geist Mono', ui-monospace, monospace"
                    style={{ letterSpacing: '0.08em' }}
                  >
                    {text}
                  </text>
                );
              })()}
            </g>

            {/* Campaign nodes */}
            {ringData.campaigns.map((c, i) => {
              const p = campaignPos[i];
              if (!p) return null;
              return (
                <RingNode
                  key={c.id}
                  node={c}
                  x={p.x}
                  y={p.y}
                  radius={8}
                  color={COLOR_CAMPAIGN}
                  hovered={hoveredId === c.id}
                  onClick={() => handleNodeClick(c)}
                  onHover={(h) => setHoveredId(h ? c.id : null)}
                />
              );
            })}

            {/* CVE nodes */}
            {ringData.cves.map((cve, i) => {
              const p = cvePos[i];
              if (!p) return null;
              return (
                <RingNode
                  key={cve.id}
                  node={cve}
                  x={p.x}
                  y={p.y}
                  radius={6}
                  color={COLOR_CVE}
                  hovered={hoveredId === cve.id}
                  onClick={() => handleNodeClick(cve)}
                  onHover={(h) => setHoveredId(h ? cve.id : null)}
                />
              );
            })}

            {/* Victim nodes */}
            {ringData.victims.map((vic, i) => {
              const p = victimPos[i];
              if (!p) return null;
              return (
                <RingNode
                  key={vic.id}
                  node={vic}
                  x={p.x}
                  y={p.y}
                  radius={5}
                  color={COLOR_VICTIM}
                  hovered={hoveredId === vic.id}
                  onClick={() => handleNodeClick(vic)}
                  onHover={(h) => setHoveredId(h ? vic.id : null)}
                  labelOffset={14}
                />
              );
            })}

            {/* Actor selector chips along the bottom (small dots for other actors) */}
            {response.nodes
              .filter((n) => n.kind === 'threat_actor' && n.id !== apexActor.id)
              .map((other, i, arr) => {
                const x = cx - (arr.length - 1) * 14 + i * 28;
                const y = size.height - 28;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot contain <button> — role+tabIndex is the SVG idiom
                  <g
                    key={other.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Switch radar focus to ${other.label}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleNodeClick(other)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') handleNodeClick(other);
                    }}
                    onMouseEnter={() => setHoveredId(other.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={6}
                      fill={COLOR_ACTOR}
                      opacity={hoveredId === other.id ? 1 : 0.6}
                      stroke="#ff5577"
                      strokeWidth={1}
                    />
                    <text
                      x={x}
                      y={y + 16}
                      fontSize={9}
                      fill={COLOR_TEXT_DIM}
                      textAnchor="middle"
                      fontFamily="'Geist Mono', ui-monospace, monospace"
                      style={{ letterSpacing: '0.04em' }}
                    >
                      {other.label}
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
            <span style={{ color: 'var(--crt-glow, #00ff41)' }}>THREAT NETWORK · RINGS</span>
            <span>· APEX ADVERSARY RADAR</span>
            <span style={{ color: '#444' }}>·</span>
            <span style={{ color: COLOR_ACTOR }}>CENTER: {apexActor.label}</span>
          </div>

          <div
            className="absolute top-2 right-3 pointer-events-none text-[9px] font-mono uppercase tracking-wider"
            style={{ color: '#555' }}
          >
            Click another actor (bottom row) to swap the center
          </div>

          {/* Legend */}
          <div
            className="absolute bottom-2 left-3 pointer-events-none flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider"
            style={{ color: 'var(--text-muted, #888)' }}
          >
            <LegendDot color={COLOR_ACTOR} label="Apex actor" />
            <LegendDot color={COLOR_CAMPAIGN} label="Campaign" />
            <LegendDot color={COLOR_CVE} label="CVE" />
            <LegendDot color={COLOR_VICTIM} label="Victim" />
          </div>
        </>
      )}

      <IntelCard entity={hoverEntity} cursor={cursor} />
    </div>
  );
}

function RingNode({
  node,
  x,
  y,
  radius,
  color,
  hovered,
  onClick,
  onHover,
  labelOffset = 12,
}: {
  node: GraphNode;
  x: number;
  y: number;
  radius: number;
  color: string;
  hovered: boolean;
  onClick: () => void;
  onHover: (h: boolean) => void;
  labelOffset?: number;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot contain <button> — role+tabIndex is the SVG idiom
    <g
      role="button"
      tabIndex={0}
      aria-label={`Inspect ${node.label}`}
      style={{ cursor: 'pointer' }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {hovered && <circle cx={x} cy={y} r={radius + 6} fill={`${color}33`} />}
      <circle cx={x} cy={y} r={radius} fill={color} stroke={`${color}99`} strokeWidth={1} />
      {hovered && (
        <text
          x={x}
          y={y + radius + labelOffset}
          fontSize={10}
          fill="#e8e8e8"
          textAnchor="middle"
          fontFamily="'Geist Mono', ui-monospace, monospace"
          style={{ letterSpacing: '0.04em' }}
        >
          {truncate(node.label, 28)}
        </text>
      )}
    </g>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 6px ${color}66`,
        }}
      />
      <span>{label}</span>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
