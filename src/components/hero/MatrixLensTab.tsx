'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMapStore } from '@/lib/store/map-store';
import { prefillAgent } from '@/lib/utils/panel-actions';
import { IntelCard, type IntelCardEntity } from './IntelCard';

/**
 * MatrixLensTab — actors × MITRE ATT&CK tactics heatmap.
 *
 * Columns: 14 MITRE Enterprise ATT&CK tactics (Reconnaissance → Impact),
 * canonical kill-chain order. Rows: top threat actors by composite score.
 * Cells fill with matrix-green at intensity = technique count / max count.
 * Hover a cell to see top techniques. Click an actor row to lock selection
 * across all lenses.
 *
 * Most "Bloomberg terminal native" of the four lenses — dense, scannable,
 * sortable. This is the SOC-analyst's primary workspace view.
 */

interface Actor {
  actorId: string;
  displayName: string;
  actorType: string | null;
  compositeScore: number | null;
  actorGrade: string | null;
}

interface Tactic {
  tacticId: string;
  shortName: string;
  name: string;
  url: string;
}

interface Cell {
  actorId: string;
  tacticId: string;
  techniqueCount: number;
  topTechniques: string[];
}

interface MatrixResponse {
  actors: Actor[];
  tactics: Tactic[];
  cells: Cell[];
  maxTechniqueCount: number;
  count: { actors: number; tactics: number; cells: number };
  timestamp: string;
  error?: string;
}

const ACTOR_COL_W = 150;
const HEADER_H = 80;
const ROW_H = 72;
const GRID_MAX_WIDTH = 1400;

export function MatrixLensTab() {
  const [response, setResponse] = useState<MatrixResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ actorId: string; tacticId: string } | null>(
    null,
  );
  const [hoveredRowActorId, setHoveredRowActorId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ clientX: number; clientY: number } | null>(null);

  const selectedActorId = useMapStore((s) => s.selectedActorId);
  const setSelectedActorId = useMapStore((s) => s.setSelectedActorId);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/aegis/actor-matrix')
      .then((r) => r.json() as Promise<MatrixResponse>)
      .then((json) => {
        if (cancelled) return;
        setResponse(json);
        setLoadError(json.error ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load actor matrix');
        setResponse({
          actors: [],
          tactics: [],
          cells: [],
          maxTechniqueCount: 0,
          count: { actors: 0, tactics: 0, cells: 0 },
          timestamp: new Date().toISOString(),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleActorClick = useCallback(
    (actor: Actor) => {
      setSelectedActorId(actor.actorId);
      prefillAgent(`Score threat actor: ${actor.displayName}`, {
        sourcePanel: 'threatMatrix',
        dataType: 'threat_actor',
        trendData: { ...actor },
      });
    },
    [setSelectedActorId],
  );

  const handleCellClick = useCallback(
    (actor: Actor, tactic: Tactic, cell: Cell | null) => {
      if (!cell) return;
      setSelectedActorId(actor.actorId);
      prefillAgent(`Analyze ${actor.displayName} techniques in ${tactic.name}`, {
        sourcePanel: 'threatMatrix',
        dataType: 'threat_actor',
        trendData: {
          actorId: actor.actorId,
          displayName: actor.displayName,
          tacticId: tactic.tacticId,
          tacticName: tactic.name,
          techniques: cell.topTechniques,
        },
      });
    },
    [setSelectedActorId],
  );

  // Cell lookup: O(1) by (actorId, tacticId). MUST live above the early
  // returns below so hooks are called unconditionally on every render
  // (react-hooks/rules-of-hooks).
  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>();
    if (response) for (const c of response.cells) m.set(`${c.actorId}::${c.tacticId}`, c);
    return m;
  }, [response]);

  // IntelCard entity — matrix_cell when a cell is hovered, threat_actor when a
  // row header is hovered. Cell hover takes precedence (the cell handlers clear
  // hoveredRowActorId on enter).
  const hoverEntity = useMemo<IntelCardEntity | null>(() => {
    if (!response) return null;
    if (hoveredCell) {
      const actor = response.actors.find((a) => a.actorId === hoveredCell.actorId);
      const tactic = response.tactics.find((t) => t.tacticId === hoveredCell.tacticId);
      if (!actor || !tactic) return null;
      const cell = cellMap.get(`${actor.actorId}::${tactic.tacticId}`) ?? null;
      return { kind: 'matrix_cell', actor, tactic, cell };
    }
    if (hoveredRowActorId) {
      const actor = response.actors.find((a) => a.actorId === hoveredRowActorId);
      if (!actor) return null;
      return {
        kind: 'threat_actor',
        label: actor.displayName,
        data: {
          actorId: actor.actorId,
          actorType: actor.actorType,
          compositeScore: actor.compositeScore,
          actorGrade: actor.actorGrade,
        },
      };
    }
    return null;
  }, [hoveredCell, hoveredRowActorId, response, cellMap]);

  const isEmpty = response !== null && response.actors.length === 0;

  if (!response) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted,#888)]">
        Loading MITRE matrix…
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <span style={{ color: 'var(--crt-glow, #00ff41)' }}>● AEGIS STANDING BY</span>
        <span className="text-[10px]">
          {loadError ? `Matrix unavailable: ${loadError}` : 'No MITRE TTP data in scope'}
        </span>
      </div>
    );
  }

  const max = Math.max(1, response.maxTechniqueCount);

  return (
    <div
      className="relative h-full w-full overflow-auto"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Header (sticky top) */}
      <div
        className="absolute top-2 left-3 pointer-events-none flex items-baseline gap-3 text-[10px] font-mono uppercase tracking-wider z-10"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <span style={{ color: 'var(--crt-glow, #00ff41)' }}>THREAT NETWORK · MITRE MATRIX</span>
        <span>· ACTORS × ATT&amp;CK TACTICS</span>
        <span style={{ color: '#444' }}>·</span>
        <span style={{ color: '#aaa' }}>
          {response.count.actors} ACTORS · {response.count.tactics} TACTICS · {response.count.cells}{' '}
          ACTIVE CELLS
        </span>
      </div>

      {/* Grid — wrapped in a centered, max-width container so on ultra-wide
          screens the cells don't stretch into illegibility. */}
      <div
        style={{
          marginTop: 36,
          maxWidth: GRID_MAX_WIDTH,
          margin: '36px auto 0',
          display: 'grid',
          gridTemplateColumns: `${ACTOR_COL_W}px repeat(${response.tactics.length}, minmax(0, 1fr))`,
          minHeight: HEADER_H + response.actors.length * ROW_H + 40,
        }}
      >
        {/* Top-left blank corner */}
        <div
          style={{
            background: 'transparent',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            height: HEADER_H,
            position: 'sticky',
            left: 0,
            top: 0,
            zIndex: 4,
          }}
        />

        {/* Tactic column headers — VT323 caps, vertical-ish */}
        {response.tactics.map((tactic) => (
          <div
            key={tactic.tacticId}
            title={`${tactic.tacticId} · ${tactic.name}`}
            style={{
              height: HEADER_H,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              borderRight: '1px solid rgba(255,255,255,0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              padding: '6px 4px 4px',
              fontFamily: "'VT323', 'Geist Mono', monospace",
              fontSize: 13,
              color: 'var(--crt-glow, #00ff41)',
              letterSpacing: '0.02em',
              textAlign: 'center',
              lineHeight: 1.05,
            }}
          >
            <span
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 8,
                color: '#888',
                letterSpacing: '0.08em',
                marginBottom: 2,
              }}
            >
              {tactic.tacticId}
            </span>
            {tactic.shortName.replace(/-/g, ' ')}
          </div>
        ))}

        {/* Rows: actor row label + cells */}
        {response.actors.map((actor) => {
          const isSelected = selectedActorId === actor.actorId;
          const gradeColor =
            actor.actorGrade === 'A' ? '#ff0040' : actor.actorGrade === 'B' ? '#ff9933' : '#aaaaaa';
          return (
            <div key={actor.actorId} style={{ display: 'contents' }}>
              {/* Actor row header (sticky left) */}
              <button
                type="button"
                onClick={() => handleActorClick(actor)}
                onMouseEnter={(e) => {
                  setHoveredRowActorId(actor.actorId);
                  setHoveredCell(null);
                  setCursor({ clientX: e.clientX, clientY: e.clientY });
                }}
                onMouseMove={(e) => setCursor({ clientX: e.clientX, clientY: e.clientY })}
                onMouseLeave={() => {
                  setHoveredRowActorId(null);
                  setCursor(null);
                }}
                style={{
                  height: ROW_H,
                  background: isSelected ? 'rgba(var(--crt-glow-rgb),0.06)' : 'rgba(10,10,10,0.7)',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  borderRight: '1px solid rgba(255,255,255,0.06)',
                  borderLeft: isSelected
                    ? '2px solid var(--crt-glow, #00ff41)'
                    : '2px solid transparent',
                  padding: '0 10px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  fontFamily: "'Geist Mono', monospace",
                  position: 'sticky',
                  left: 0,
                  zIndex: 3,
                }}
                aria-pressed={isSelected}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: isSelected ? 'var(--crt-glow, #00ff41)' : '#e8e8e8',
                    letterSpacing: '0.04em',
                  }}
                >
                  {actor.displayName}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: '#888',
                    letterSpacing: '0.08em',
                    marginTop: 1,
                  }}
                >
                  <span style={{ color: gradeColor }}>{actor.actorGrade ?? '?'}</span>
                  {actor.compositeScore != null && (
                    <>
                      <span style={{ color: '#444' }}> · </span>
                      <span>{actor.compositeScore.toFixed(1)}</span>
                    </>
                  )}
                </span>
              </button>

              {/* Cells across the tactics */}
              {response.tactics.map((tactic) => {
                const cell = cellMap.get(`${actor.actorId}::${tactic.tacticId}`);
                const count = cell?.techniqueCount ?? 0;
                const intensity = count === 0 ? 0 : 0.18 + 0.7 * (count / max);
                const isHovered =
                  hoveredCell?.actorId === actor.actorId &&
                  hoveredCell?.tacticId === tactic.tacticId;
                const dim = !!selectedActorId && !isSelected;

                return (
                  <button
                    key={tactic.tacticId}
                    type="button"
                    onMouseEnter={(e) => {
                      setHoveredCell({ actorId: actor.actorId, tacticId: tactic.tacticId });
                      setHoveredRowActorId(null);
                      setCursor({ clientX: e.clientX, clientY: e.clientY });
                    }}
                    onMouseMove={(e) => setCursor({ clientX: e.clientX, clientY: e.clientY })}
                    onMouseLeave={() => {
                      setHoveredCell(null);
                      setCursor(null);
                    }}
                    onClick={() => handleCellClick(actor, tactic, cell ?? null)}
                    /* Browser-native title= removed in Phase 8.12 — IntelCard
                       owns the hover affordance. aria-label retains the
                       accessible name for screen readers. */
                    aria-label={
                      cell
                        ? `${actor.displayName} · ${tactic.name} · ${count} technique${count === 1 ? '' : 's'}`
                        : `${actor.displayName} · ${tactic.name} · no activity`
                    }
                    style={{
                      height: ROW_H,
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      borderRight: '1px solid rgba(255,255,255,0.03)',
                      background:
                        count === 0
                          ? 'transparent'
                          : `rgba(var(--crt-glow-rgb), ${dim ? intensity * 0.25 : intensity})`,
                      cursor: count > 0 ? 'pointer' : 'default',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 2,
                      padding: '4px',
                      fontFamily: "'Geist Mono', monospace",
                      color: count > 0 ? '#001a08' : '#444',
                      outline: isHovered ? '1px solid rgba(var(--crt-glow-rgb),0.85)' : 'none',
                      outlineOffset: -1,
                      transition: 'background 80ms ease',
                    }}
                  >
                    {count > 0 ? (
                      <>
                        <span
                          style={{
                            fontFamily: "'VT323', 'Geist Mono', monospace",
                            fontSize: 26,
                            lineHeight: 1,
                            fontWeight: 400,
                          }}
                        >
                          {count}
                        </span>
                        {cell?.topTechniques?.[0] && (
                          <span
                            style={{
                              fontSize: 9,
                              opacity: 0.7,
                              letterSpacing: '0.04em',
                              lineHeight: 1,
                            }}
                          >
                            {cell.topTechniques[0]}
                          </span>
                        )}
                      </>
                    ) : (
                      ''
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Legend / intensity scale (bottom) */}
      <div
        className="absolute bottom-2 left-3 pointer-events-none flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <span>Intensity =</span>
        {[0.18, 0.4, 0.6, 0.85].map((alpha, i) => (
          <span
            key={i}
            style={{
              display: 'inline-block',
              width: 14,
              height: 10,
              background: `rgba(var(--crt-glow-rgb), ${alpha})`,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          />
        ))}
        <span>technique count / max ({max})</span>
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
    </div>
  );
}
