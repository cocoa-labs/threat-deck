'use client';

import { type HierarchyPointNode, hierarchy, tree } from 'd3-hierarchy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccentStore } from '@/lib/store/accent-store';
import { useMapStore } from '@/lib/store/map-store';
import { prefillAgent } from '@/lib/utils/panel-actions';
import { IntelCard, type IntelCardEntity } from './IntelCard';

/**
 * TreeLensTab — top-down hierarchical kill-chain view of the threat network.
 *
 * Replaces the prior Sigma.js force-directed lens which had no semantic
 * spatial encoding. The tree reads top-to-bottom: Threat Actor → Campaign →
 * CVE / Victim. Position now ENCODES the kill chain — the eye reads a real
 * topology instead of guessing why a force-directed node landed where it did.
 *
 * Hover a row → highlight that node's subtree.
 * Click a node → setSelectedActorId (persists across lenses) + open AgentDrawer.
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

/* ─── Brand palette (matches CVE TIMELINE + GRAPH polish from 8.9) ─── */

const COLOR_ACTOR = '#ff0040';
const COLOR_CAMPAIGN = '#ffaa00';
const COLOR_CVE = '#00ff41';
const COLOR_VICTIM = '#7a8b99';
const COLOR_EDGE = 'rgba(255, 255, 255, 0.18)';
const COLOR_DIM = '#1f2228';
const COLOR_TEXT = '#e8e8e8';
const COLOR_TEXT_DIM = '#9ca3af';

function colorForKind(kind: NodeKind, cveColor = COLOR_CVE): string {
  switch (kind) {
    case 'threat_actor':
      return COLOR_ACTOR;
    case 'campaign':
      return COLOR_CAMPAIGN;
    case 'cve':
      return cveColor;
    case 'victim':
      return COLOR_VICTIM;
  }
}

function sizeForKind(kind: NodeKind): number {
  switch (kind) {
    case 'threat_actor':
      return 9;
    case 'campaign':
      return 7;
    case 'cve':
      return 6;
    case 'victim':
      return 5;
  }
}

/* ─── Tree node shape ─── */

interface TreeDatum {
  id: string;
  kind: NodeKind | 'root';
  label: string;
  data: Record<string, unknown>;
  children?: TreeDatum[];
}

/* ─── Layout constants ─── */

const MARGIN = { top: 56, right: 32, bottom: 48, left: 32 };
const NODE_LABEL_OFFSET = 14;
const ROW_LABELS: Record<number, string> = {
  1: 'ACTORS',
  2: 'CAMPAIGNS',
  3: 'CVES / VICTIMS',
};

export function TreeLensTab() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [response, setResponse] = useState<ThreatGraphResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cardCursor, setCardCursor] = useState<{ clientX: number; clientY: number } | null>(null);

  const selectedActorId = useMapStore((s) => s.selectedActorId);
  const setSelectedActorId = useMapStore((s) => s.setSelectedActorId);
  const accentPalette = useAccentStore((s) => s.accentPalette);

  // Fetch threat-graph data (same endpoint the old GRAPH used — no API change)
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
        setLoadError(err instanceof Error ? err.message : 'Failed to load threat tree');
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

  // ResizeObserver — keep canvas crisp on container size change
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

  // Build a forest hierarchy: synthetic root → actors → campaigns → (CVEs ∪ victims).
  // CVEs / victims for a given actor sit under that actor's primary campaign so the
  // tree is well-formed (every actor must have at least one bucket child).
  const layout = useMemo(() => {
    if (!response || size.width === 0 || size.height === 0) return null;

    const { nodes, edges } = response;
    const actors = nodes.filter((n) => n.kind === 'threat_actor');
    if (actors.length === 0) return null;

    const campaigns = nodes.filter((n) => n.kind === 'campaign');
    const cves = nodes.filter((n) => n.kind === 'cve');
    const victims = nodes.filter((n) => n.kind === 'victim');

    // Build adjacency for fast lookup
    const childrenOf = new Map<string, Set<string>>();
    for (const e of edges) {
      const set = childrenOf.get(e.source) ?? new Set<string>();
      set.add(e.target);
      childrenOf.set(e.source, set);
    }
    const isChildOf = (parent: string, child: string) =>
      childrenOf.get(parent)?.has(child) === true;

    // For each actor → their campaigns → their CVEs + their victims
    // (Pin orphan CVEs/victims to a synthetic 'Direct' bucket per actor so nothing
    // gets dropped on the floor.)
    const tree_data: TreeDatum = {
      id: 'root',
      kind: 'root',
      label: '',
      data: {},
      children: actors.map((actor): TreeDatum => {
        const actorCampaigns = campaigns.filter((c) => isChildOf(actor.id, c.id));

        // CVEs and victims for THIS actor (via campaign edges OR direct edges)
        const actorCVEs = cves.filter(
          (cve) =>
            isChildOf(actor.id, cve.id) || actorCampaigns.some((c) => isChildOf(c.id, cve.id)),
        );
        const actorVictims = victims.filter(
          (vic) =>
            isChildOf(actor.id, vic.id) || actorCampaigns.some((c) => isChildOf(c.id, vic.id)),
        );

        // Children: campaigns first (each with its CVEs + victims), then orphan
        // CVEs/victims not attached to any campaign.
        const campaignChildren = actorCampaigns.map((camp): TreeDatum => {
          const campCVEs = cves.filter((cve) => isChildOf(camp.id, cve.id));
          const campVictims = victims.filter((vic) => isChildOf(camp.id, vic.id));
          return {
            id: camp.id,
            kind: 'campaign',
            label: camp.label,
            data: camp.data,
            children: [
              ...campCVEs.map((cve) => ({
                id: cve.id,
                kind: 'cve' as const,
                label: cve.label,
                data: cve.data,
              })),
              ...campVictims.map((vic) => ({
                id: vic.id,
                kind: 'victim' as const,
                label: vic.label,
                data: vic.data,
              })),
            ],
          };
        });

        const orphanCVEs = actorCVEs.filter(
          (cve) => !campaignChildren.some((c) => c.children?.some((x) => x.id === cve.id)),
        );
        const orphanVictims = actorVictims.filter(
          (vic) => !campaignChildren.some((c) => c.children?.some((x) => x.id === vic.id)),
        );

        const actorChildren: TreeDatum[] = [
          ...campaignChildren,
          ...orphanCVEs.map((cve) => ({
            id: cve.id,
            kind: 'cve' as const,
            label: cve.label,
            data: cve.data,
          })),
          ...orphanVictims.map((vic) => ({
            id: vic.id,
            kind: 'victim' as const,
            label: vic.label,
            data: vic.data,
          })),
        ];

        return {
          id: actor.id,
          kind: 'threat_actor',
          label: actor.label,
          data: actor.data,
          children: actorChildren,
        };
      }),
    };

    const innerW = Math.max(100, size.width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(100, size.height - MARGIN.top - MARGIN.bottom);

    // Use `nodeSize` (fixed cell per node) instead of `size` (evenly-spaced
    // leaves). With `size`, a wider subtree eats the canvas and other actors
    // get squeezed into a corner. With `nodeSize`, every leaf claims the
    // same horizontal slot and subtrees grow downward predictably; we then
    // compute the actual bounding box and offset the canvas so the whole
    // forest renders centered horizontally.
    const NODE_W = 130;
    const LEVEL_H = Math.max(80, innerH / 3.5); // 4 levels (root + 3 visible) → leave space at bottom
    const treeLayout = tree<TreeDatum>().nodeSize([NODE_W, LEVEL_H]);
    const root = treeLayout(hierarchy<TreeDatum>(tree_data));

    // Find horizontal bounds of all REAL nodes (skip the synthetic root)
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    root.each((d) => {
      if (d.depth === 0) return;
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
    });
    if (minX === Number.POSITIVE_INFINITY) {
      minX = 0;
      maxX = 0;
    }
    const treeWidth = maxX - minX;
    // Center the tree: shift so its midpoint lands at innerW/2
    const xOffset = innerW / 2 - (minX + treeWidth / 2);

    const nodesById = new Map<string, HierarchyPointNode<TreeDatum>>();
    root.each((d) => {
      nodesById.set(d.data.id, d);
    });

    return { root, nodesById, innerW, innerH, xOffset };
  }, [response, size]);

  // Compute the set of node IDs in the highlighted subtree (hovered or selected actor).
  const highlightedIds = useMemo(() => {
    if (!layout) return new Set<string>();
    const focal = hoveredId ?? (selectedActorId ? `actor:${selectedActorId}` : null);
    if (!focal) return new Set<string>();
    const focalNode = layout.nodesById.get(focal);
    if (!focalNode) return new Set<string>();
    const ids = new Set<string>();
    focalNode.each((d) => ids.add(d.data.id));
    // Also include ancestors so the path to root highlights
    let cur = focalNode.parent;
    while (cur) {
      ids.add(cur.data.id);
      cur = cur.parent;
    }
    return ids;
  }, [layout, hoveredId, selectedActorId]);

  // Draw
  useEffect(() => {
    void accentPalette;
    const canvas = canvasRef.current;
    if (!canvas || !layout || size.width === 0 || size.height === 0) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const cveColor = rootStyles.getPropertyValue('--crt-glow').trim() || COLOR_CVE;
    const glowRgb = rootStyles.getPropertyValue('--crt-glow-rgb').trim() || '0, 255, 65';
    const edgeHighlight = `rgba(${glowRgb}, 0.75)`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const dim = highlightedIds.size > 0;

    // Row labels (left margin)
    ctx.font = "10px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = COLOR_TEXT_DIM;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const [depthStr, label] of Object.entries(ROW_LABELS)) {
      const depth = Number(depthStr);
      const sample = Array.from(layout.nodesById.values()).find((d) => d.depth === depth);
      if (!sample) continue;
      const y = sample.y + MARGIN.top;
      ctx.fillText(label, 8, y);
    }

    // Edges first (so nodes draw on top). `xOffset` from the layout centers
    // the whole forest horizontally; `MARGIN.left` is the canvas inset.
    const xBase = MARGIN.left + layout.xOffset;
    layout.root.links().forEach((link) => {
      if (link.source.depth === 0) return; // skip synthetic root
      const sx = link.source.x + xBase;
      const sy = link.source.y + MARGIN.top;
      const tx = link.target.x + xBase;
      const ty = link.target.y + MARGIN.top;

      const isHighlighted =
        dim && highlightedIds.has(link.source.data.id) && highlightedIds.has(link.target.data.id);

      ctx.strokeStyle = dim ? (isHighlighted ? edgeHighlight : 'rgba(40,40,45,0.15)') : COLOR_EDGE;
      ctx.lineWidth = isHighlighted ? 1.6 : 1;

      // Cubic Bezier for smooth top-down flow
      const midY = (sy + ty) / 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, midY, tx, midY, tx, ty);
      ctx.stroke();
    });

    // Nodes
    layout.root.each((d) => {
      if (d.depth === 0) return; // skip root
      const x = d.x + xBase;
      const y = d.y + MARGIN.top;
      const kind = d.data.kind as NodeKind;
      const radius = sizeForKind(kind);
      const isHighlighted = !dim || highlightedIds.has(d.data.id);

      // Halo for highlighted nodes
      if (isHighlighted && dim) {
        ctx.fillStyle = `${colorForKind(kind, cveColor)}33`;
        ctx.beginPath();
        ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Main node
      ctx.fillStyle = isHighlighted ? colorForKind(kind, cveColor) : COLOR_DIM;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Outer ring (subtle)
      ctx.strokeStyle = isHighlighted
        ? `${colorForKind(kind, cveColor)}55`
        : 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.stroke();

      // Label — below the node, dimmed when not highlighted
      if (kind !== 'victim' || isHighlighted) {
        ctx.font = `${kind === 'threat_actor' ? 12 : 10}px 'Geist Mono', ui-monospace, monospace`;
        ctx.fillStyle = isHighlighted ? COLOR_TEXT : COLOR_TEXT_DIM;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const label = truncate(d.data.label, kind === 'victim' ? 14 : 24);
        ctx.fillText(label, x, y + NODE_LABEL_OFFSET);
      }

      // Score chip for actors (top-right of label area)
      if (kind === 'threat_actor' && isHighlighted) {
        const grade = (d.data.data.actorGrade as string | undefined) ?? '';
        const score = (d.data.data.compositeScore as number | undefined) ?? null;
        if (grade || score) {
          const chip = `${grade}${score ? ` · ${score.toFixed(1)}` : ''}`;
          ctx.font = "9px 'Geist Mono', ui-monospace, monospace";
          ctx.fillStyle = `${colorForKind(kind, cveColor)}cc`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(chip, x, y + NODE_LABEL_OFFSET + 14);
        }
      }
    });
  }, [layout, size, highlightedIds, accentPalette]);

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!layout) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Find the closest node within 18px. TS doesn't narrow `best` across
      // the closure boundary, so we store the result via a ref-like wrapper.
      const xBase = MARGIN.left + layout.xOffset;
      const bestRef: { value: { id: string; dist: number } | null } = { value: null };
      layout.root.each((d) => {
        if (d.depth === 0) return;
        const dx = d.x + xBase - x;
        const dy = d.y + MARGIN.top - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 18 && (!bestRef.value || dist < bestRef.value.dist)) {
          bestRef.value = { id: d.data.id, dist };
        }
      });
      const nextId = bestRef.value?.id ?? null;
      setHoveredId(nextId);
      setCardCursor(nextId ? { clientX: e.clientX, clientY: e.clientY } : null);
    },
    [layout],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
    setCardCursor(null);
  }, []);

  // IntelCard entity derived from hovered tree datum
  const hoverEntity: IntelCardEntity | null = useMemo(() => {
    if (!hoveredId || !layout) return null;
    const node = layout.nodesById.get(hoveredId);
    if (!node || node.depth === 0) return null;
    const datum = node.data;
    const kind = datum.kind as 'threat_actor' | 'campaign' | 'cve' | 'victim' | 'root';
    if (kind === 'root') return null;
    return { kind, label: datum.label, data: datum.data };
  }, [hoveredId, layout]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!layout) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const xBase = MARGIN.left + layout.xOffset;
      const bestRef: { value: { datum: TreeDatum; dist: number } | null } = { value: null };
      layout.root.each((d) => {
        if (d.depth === 0) return;
        const dx = d.x + xBase - x;
        const dy = d.y + MARGIN.top - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 18 && (!bestRef.value || dist < bestRef.value.dist)) {
          bestRef.value = { datum: d.data, dist };
        }
      });
      if (!bestRef.value) {
        setSelectedActorId(null);
        return;
      }

      const node = bestRef.value.datum;
      // Persist actor selection across lenses; for child nodes climb to the actor ancestor.
      let actorAncestor: TreeDatum | null = null;
      if (node.kind === 'threat_actor') {
        actorAncestor = node;
      } else {
        // Find ancestor by walking up the d3-hierarchy node
        let cur = layout.nodesById.get(node.id)?.parent;
        while (cur && cur.data.kind !== 'threat_actor') cur = cur.parent;
        if (cur) actorAncestor = cur.data;
      }
      if (actorAncestor) {
        const actorIdRaw = String(actorAncestor.data.actorId ?? actorAncestor.id);
        setSelectedActorId(actorIdRaw.replace(/^actor:/, ''));
      }

      // Prefill the AgentDrawer with a kind-appropriate prompt
      const label = node.label;
      switch (node.kind) {
        case 'threat_actor':
          prefillAgent(`Score threat actor: ${label}`, {
            sourcePanel: 'threatTree',
            dataType: 'threat_actor',
            trendData: node.data,
          });
          break;
        case 'campaign':
          prefillAgent(`Analyze ${label} campaign`, {
            sourcePanel: 'threatTree',
            dataType: 'campaign',
            trendData: node.data,
          });
          break;
        case 'cve':
          prefillAgent(`Analyze ${label}`, {
            sourcePanel: 'threatTree',
            dataType: 'cve',
            trendData: node.data,
          });
          break;
        case 'victim':
          prefillAgent(`Brief on ${label} incident`, {
            sourcePanel: 'threatTree',
            dataType: 'incident',
            trendData: node.data,
          });
          break;
      }
    },
    [layout, setSelectedActorId],
  );

  const isEmpty = response !== null && response.nodes.length === 0;
  const cursor = hoveredId ? 'pointer' : 'default';

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: 'var(--bg-primary)' }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ display: 'block', cursor }}
      />

      {/* Header */}
      <div
        className="absolute top-2 left-3 pointer-events-none flex items-baseline gap-3 text-[10px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <span style={{ color: 'var(--crt-glow, #00ff41)' }}>THREAT NETWORK · TREE</span>
        <span>· TOP-DOWN KILL CHAIN</span>
        {response?.count && (
          <>
            <span style={{ color: '#444' }}>·</span>
            <span style={{ color: COLOR_ACTOR }}>{response.count.actors} ACTORS</span>
            <span style={{ color: '#444' }}>·</span>
            <span style={{ color: COLOR_CAMPAIGN }}>{response.count.campaigns} CAMPAIGNS</span>
            <span style={{ color: '#444' }}>·</span>
            <span style={{ color: COLOR_CVE }}>{response.count.cves} CVES</span>
            <span style={{ color: '#444' }}>·</span>
            <span style={{ color: COLOR_VICTIM }}>{response.count.victims} VICTIMS</span>
          </>
        )}
      </div>

      <div
        className="absolute top-2 right-3 pointer-events-none text-[9px] font-mono uppercase tracking-wider"
        style={{ color: '#555' }}
      >
        Hover · isolate subtree · Click · open in agent drawer
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-2 left-3 pointer-events-none flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <LegendDot color={COLOR_ACTOR} label="Actor" />
        <LegendDot color={COLOR_CAMPAIGN} label="Campaign" />
        <LegendDot color={COLOR_CVE} label="CVE" />
        <LegendDot color={COLOR_VICTIM} label="Victim" />
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

      {isEmpty && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-1 text-xs font-mono uppercase tracking-wider"
          style={{ color: 'var(--text-muted, #888)' }}
        >
          <span style={{ color: 'var(--crt-glow, #00ff41)' }}>● AEGIS STANDING BY</span>
          <span className="text-[10px]">
            {loadError
              ? `Network unavailable: ${loadError}`
              : 'No active threat actor data in scope'}
          </span>
        </div>
      )}

      <IntelCard entity={hoverEntity} cursor={cardCursor} />
    </div>
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
