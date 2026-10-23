'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IntelCardForecast } from '@/components/hero/IntelCardForecast';
import { IntelCardPivots } from '@/components/hero/IntelCardPivots';
import type { PivotKind } from '@/lib/aegis/pivot-templates';
import { type ForecastKind, useForecast } from '@/lib/hooks/use-forecast';
import { usePivots } from '@/lib/hooks/use-pivots';

/**
 * IntelCard — shared portal-rendered floating intel card for the four
 * threat-network lenses (Tree, Rings, Matrix, Sankey).
 *
 * Replaces browser-native SVG <title> tooltips and HTML title= attrs with
 * a branded, glance-readable card that:
 *   • anchors to the cursor with viewport-edge clamping (createPortal to body)
 *   • severity-stripe top accent + neon brand seam under title
 *   • VT323 display for the entity name, Geist Mono for the body
 *   • severity / technique chips + per-kind body layout
 *   • action hint footer: "↵ CLICK TO ANALYZE IN AGENT"
 *
 * Click → AgentDrawer behaviour is unchanged — the IntelCard is hover-only.
 */

/* ─── Shared per-lens entity types ─── */

export interface ActorRow {
  actorId: string;
  displayName: string;
  actorType: string | null;
  compositeScore: number | null;
  actorGrade: string | null;
}

export interface TacticRow {
  tacticId: string;
  shortName: string;
  name: string;
  url: string;
}

export interface CellRow {
  actorId: string;
  tacticId: string;
  techniqueCount: number;
  topTechniques: string[];
}

export interface SankeyNodeRow {
  id: string;
  label: string;
  kind: 'actor' | 'campaign' | 'victim';
  originalData: Record<string, unknown>;
}

export type IntelCardEntity =
  | { kind: 'threat_actor'; label: string; data: Record<string, unknown> }
  | { kind: 'campaign'; label: string; data: Record<string, unknown> }
  | { kind: 'cve'; label: string; data: Record<string, unknown> }
  | { kind: 'victim'; label: string; data: Record<string, unknown> }
  | { kind: 'matrix_cell'; actor: ActorRow; tactic: TacticRow; cell: CellRow | null }
  | { kind: 'sankey_flow'; source: SankeyNodeRow; target: SankeyNodeRow; value: number };

export interface IntelCardProps {
  entity: IntelCardEntity | null;
  cursor: { clientX: number; clientY: number } | null;
}

/* ─── Layout constants ─── */

const CARD_W = 340;
const CARD_OFFSET_X = 16;
const CARD_OFFSET_Y = 16;
const VIEWPORT_PAD = 12;

/* ─── Severity → stripe color ─── */

type StripeKind = 'critical' | 'high' | 'medium' | 'low' | 'neutral' | 'warm';

function stripeColor(kind: StripeKind): string {
  switch (kind) {
    case 'critical':
      return '#ff0040';
    case 'high':
      return '#ff4444';
    case 'medium':
      return '#ffaa00';
    case 'low':
      return '#00ff41';
    case 'warm':
      return '#ffaa00';
    case 'neutral':
      return '#7a8b99';
  }
}

function severityKindFromString(v: string | null | undefined): StripeKind {
  if (!v) return 'neutral';
  const s = v.toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  if (s === 'low' || s === 'info' || s === 'informational') return 'low';
  return 'neutral';
}

function severityKindFromCVSS(score: number | null | undefined): StripeKind {
  if (score == null) return 'neutral';
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0) return 'low';
  return 'neutral';
}

/* ─── Public component ─── */

/**
 * Phase 10.3 — IntelCard becomes a hover sink so pivot chips can be clicked.
 *
 * Pre-Phase-10 the card was `pointerEvents: 'none'` and the parent lens
 * dismissed the card when the cursor left the source node — there was no
 * way to click anything on the card itself.
 *
 * Phase 10.3 revision (post-feedback): three internal states drive both
 * mount-condition and position:
 *
 *   TRACKING (entity != null AND !hoveringCard)
 *     The parent reports the cursor over a source node. Card follows the
 *     live cursor on every mousemove and refreshes the sticky snapshot.
 *
 *   GRACE (entity == null AND graceActive)
 *     The parent just cleared its hover (cursor left the source node).
 *     We keep the card mounted at the FROZEN last-tracked position for
 *     ~300ms so the user can bridge the gap and put their cursor onto
 *     a pivot chip. If the cursor reaches the card → transitions to
 *     LOCKED. If 300ms expires → dismiss.
 *
 *   LOCKED (hoveringCard == true)
 *     The cursor is over the card itself. Position stays frozen on the
 *     entry snapshot so chips are clickable. While LOCKED, fresh cursor
 *     updates from the parent are ignored so the card doesn't jump under
 *     the user's mouse.
 *
 * Net effect: no lens-side changes, no per-lens timers — the card owns
 * the reach-and-click affordance entirely.
 */
const GRACE_MS = 300;

export function IntelCard({ entity, cursor }: IntelCardProps): React.ReactPortal | null {
  const [hoveringCard, setHoveringCard] = useState(false);
  // graceActive flips true on entity → null transitions and back to false
  // after GRACE_MS OR when entity becomes non-null again. Drives whether
  // the card stays mounted during the bridge-to-chip window.
  const [graceActive, setGraceActive] = useState(false);

  // Sticky snapshot — preserved across renders without re-rendering. Only
  // refreshed while in TRACKING (entity non-null, card not hovered) so the
  // snapshot represents the LAST cursor-on-source position.
  const lastEntityRef = useRef<IntelCardEntity | null>(null);
  const lastCursorRef = useRef<IntelCardProps['cursor']>(null);
  const inTracking = entity != null && !hoveringCard;
  if (inTracking) {
    lastEntityRef.current = entity;
    lastCursorRef.current = cursor;
  }

  // Manage the grace timer. setState calls are wrapped in setTimeout(0)
  // to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    if (entity != null) {
      // Parent is reporting a live hover — cancel any pending grace.
      const id = setTimeout(() => setGraceActive(false), 0);
      return () => clearTimeout(id);
    }
    // Parent just cleared. Start the grace window: activate immediately,
    // schedule auto-expiry after GRACE_MS. Hovering the card during this
    // window flips hoveringCard true and keeps the card mounted past
    // grace expiry via the effectiveEntity logic below.
    const startId = setTimeout(() => setGraceActive(true), 0);
    const endId = setTimeout(() => setGraceActive(false), GRACE_MS);
    return () => {
      clearTimeout(startId);
      clearTimeout(endId);
    };
  }, [entity]);

  // Effective entity/cursor — TRACKING uses live props; GRACE and LOCKED
  // use the frozen snapshot so the card stops chasing the cursor.
  const effectiveEntity: IntelCardEntity | null = inTracking
    ? entity
    : hoveringCard || graceActive
      ? lastEntityRef.current
      : null;
  const effectiveCursor: IntelCardProps['cursor'] = inTracking
    ? cursor
    : hoveringCard || graceActive
      ? lastCursorRef.current
      : null;

  // Pivot fetch — usePivots debounces 300ms and is enabled only when we
  // have a stable kind+id. Returns empty + non-loading when kind is null.
  const pivotInputs = extractPivotInputs(effectiveEntity);
  const { suggestions: pivots, loading: pivotsLoading } = usePivots(
    pivotInputs.kind,
    pivotInputs.entityId,
  );

  // Phase 11.D.11 — Forecast fetch. CVE + threat_actor + campaign get a
  // forecast section. Campaigns delegate to their parent actor — campaign
  // entities expose actor data inside their `data` blob, so we extract
  // the actor name and forward it as the entityId.
  const forecastInputs = extractForecastInputs(effectiveEntity);
  const { data: forecastData, loading: forecastLoading } = useForecast(
    forecastInputs.kind,
    forecastInputs.entityId,
  );

  // SSR safety — `cursor` is only ever set by a client-side mouse event, so on
  // the server (where document is undefined) the guard short-circuits before
  // we ever reach createPortal. Hooks above always run in the same order so
  // this early-return is safe re: react-hooks rules.
  if (!effectiveEntity || !effectiveCursor || typeof document === 'undefined') return null;

  // Anchor to cursor with viewport-edge clamping. We don't know the rendered
  // card height up-front (body varies by kind), so we use a generous estimate
  // (~260px) for the clamp — better to keep the card on-screen than to perfect
  // the bottom edge by 8px.
  const estHeight = 260;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = effectiveCursor.clientX + CARD_OFFSET_X;
  let top = effectiveCursor.clientY + CARD_OFFSET_Y;
  if (left + CARD_W + VIEWPORT_PAD > vw) {
    left = effectiveCursor.clientX - CARD_W - CARD_OFFSET_X;
  }
  if (top + estHeight + VIEWPORT_PAD > vh) {
    top = effectiveCursor.clientY - estHeight - CARD_OFFSET_Y;
  }
  if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
  if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;

  const { stripe, kindBadge, title, body } = renderEntity(effectiveEntity);
  const pivotContext: Record<string, unknown> = {
    entityKind: effectiveEntity.kind,
    entityLabel:
      'label' in effectiveEntity ? effectiveEntity.label : (pivotInputs.entityId ?? undefined),
    sourceUrl:
      pivotInputs.kind && pivotInputs.entityId
        ? `/api/aegis/${pivotInputs.kind === 'threat_actor' ? 'threat-actors' : pivotInputs.kind === 'cve' ? 'cves' : pivotInputs.kind === 'victim' ? 'compromised-orgs' : 'incidents'}/view?id=${encodeURIComponent(pivotInputs.entityId)}`
        : undefined,
  };

  return createPortal(
    <div
      // Phase 10.3 — `role="tooltip"` matches the card's ARIA semantic AND
      // satisfies the noStaticElementInteractions rule now that we hook
      // onMouseEnter/Leave for the hover-sink behavior. The interactivity
      // is non-essential (sticky snapshot only); chip clicks are the real
      // affordance and they're `<button>` elements.
      role="tooltip"
      onMouseEnter={() => setHoveringCard(true)}
      onMouseLeave={() => setHoveringCard(false)}
      style={{
        position: 'fixed',
        left,
        top,
        width: CARD_W,
        zIndex: 80,
        // Phase 10.3 — opt INTO pointer events so the card itself is a hover
        // sink. Pivot chips need clicks; the parent lens's hover state is
        // already cleared by the time the cursor reaches the card, so the
        // sticky-snapshot above keeps the card mounted.
        pointerEvents: 'auto',
        animation: 'intelcard-in 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        background: 'rgba(8, 8, 8, 0.96)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid rgba(var(--crt-glow-rgb, 0, 255, 65), 0.35)',
        boxShadow:
          '0 0 32px rgba(var(--crt-glow-rgb, 0, 255, 65), 0.08), 0 12px 24px rgba(0, 0, 0, 0.55)',
        fontFamily: "'Geist Mono', ui-monospace, monospace",
        color: 'var(--text-primary, #e8e8e8)',
        overflow: 'hidden',
      }}
    >
      {/* Severity stripe — top accent */}
      <div
        style={{
          height: 4,
          background: stripeColor(stripe),
          boxShadow: `0 0 12px ${stripeColor(stripe)}66`,
        }}
      />

      {/* Title row — kind chip + entity label */}
      <div style={{ padding: '10px 14px 8px' }}>
        <div
          style={{
            display: 'inline-block',
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: stripeColor(stripe),
            background: `${stripeColor(stripe)}1a`,
            border: `1px solid ${stripeColor(stripe)}66`,
            padding: '2px 6px',
            marginBottom: 6,
          }}
        >
          {kindBadge}
        </div>
        <div
          style={{
            fontFamily: "'VT323', 'Geist Mono', monospace",
            fontSize: 22,
            lineHeight: 1.05,
            color: 'var(--text-primary, #e8e8e8)',
            letterSpacing: '0.02em',
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>
      </div>

      {/* Neon brand seam */}
      <div style={{ height: 2, background: 'var(--brand-accent, #00ff41)' }} />

      {/* Body — per-kind */}
      <div style={{ padding: '10px 14px 8px', fontSize: 11, lineHeight: 1.5 }}>{body}</div>

      {/* Phase 10.3 — Pivots section. Renders nothing for matrix_cell /
          sankey_flow (no pivotKind extractable) AND for entities with no
          suggestions (empty response). */}
      <IntelCardPivots
        pivots={pivots}
        loading={pivotsLoading}
        sourcePanel="intelcard-pivot"
        pivotContext={pivotContext}
      />

      {/* Phase 11.D.11 — Forecast section. Renders nothing for kinds the
          forecast hook doesn't cover (matrix_cell, sankey_flow, victim
          in v0.1). */}
      <IntelCardForecast entity={effectiveEntity} data={forecastData} loading={forecastLoading} />

      {/* Action hint footer */}
      <div
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          padding: '6px 14px 7px',
          fontSize: 9,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--crt-glow, #00ff41)',
          background: 'rgba(var(--crt-glow-rgb), 0.03)',
        }}
      >
        ↵ Click to analyze in agent
      </div>

      {/* Scanline overlay — printed-terminal grain */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 2px)',
        }}
      />

      <style>{`
        @keyframes intelcard-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes intelcard-pulse {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.85; }
        }
      `}</style>
    </div>,
    document.body,
  );
}

/* ─── Pivot input extraction ─── */

/**
 * Map an IntelCardEntity to the (kind, entityId) shape the pivot-suggestions
 * route expects. Returns nulls for entity kinds the route doesn't support
 * (matrix_cell, sankey_flow) so usePivots can short-circuit.
 *
 * Entity IDs may live under different fields per kind because the four lens
 * components fan in from different SQL shapes. We try the conventional camelCase
 * keys, then fall back to the human-readable `label` — the pivot route's
 * loadEntityRow accepts display_name lookups too.
 */
function extractPivotInputs(entity: IntelCardEntity | null): {
  kind: PivotKind | null;
  entityId: string | null;
} {
  if (!entity) return { kind: null, entityId: null };

  switch (entity.kind) {
    case 'threat_actor': {
      const data = entity.data;
      const id = firstStringField(data, ['actorId', 'actor_id', 'id']) ?? entity.label;
      return { kind: 'threat_actor', entityId: id };
    }
    case 'cve': {
      const data = entity.data;
      const id = firstStringField(data, ['cveId', 'cve_id', 'id']) ?? entity.label;
      return { kind: 'cve', entityId: id };
    }
    case 'victim': {
      const data = entity.data;
      const id =
        firstStringField(data, ['id', 'orgId', 'org_id']) ??
        firstStringField(data, ['orgName', 'org_name']) ??
        entity.label;
      return { kind: 'victim', entityId: id };
    }
    case 'campaign': {
      const data = entity.data;
      const id =
        firstStringField(data, ['id', 'campaignId', 'campaign_id']) ??
        firstStringField(data, ['campaignName', 'campaign_name']) ??
        entity.label;
      return { kind: 'campaign', entityId: id };
    }
    // matrix_cell + sankey_flow — composite hovers, not single-entity
    // surfaces. Pivots don't render for these (yet).
    case 'matrix_cell':
    case 'sankey_flow':
      return { kind: null, entityId: null };
  }
}

function firstStringField(data: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/* ─── Forecast input extraction ─── */

/**
 * Map an IntelCardEntity to the (kind, entityId) shape useForecast expects.
 * Returns nulls for kinds the forecast hook doesn't cover yet (victim,
 * matrix_cell, sankey_flow) so the hook short-circuits without firing.
 *
 * Campaign entities delegate to the parent actor — the forecast API only
 * speaks actor-level for the next-target Bayesian model. We extract the
 * actor id from the campaign's `data` blob; if missing, fall back to
 * actorName, then the campaign label (the actor-forecast route accepts
 * display_name lookups too).
 */
function extractForecastInputs(entity: IntelCardEntity | null): {
  kind: ForecastKind | null;
  entityId: string | null;
} {
  if (!entity) return { kind: null, entityId: null };

  switch (entity.kind) {
    case 'cve': {
      const data = entity.data;
      const id = firstStringField(data, ['cveId', 'cve_id', 'id']) ?? entity.label;
      return { kind: 'cve', entityId: id };
    }
    case 'threat_actor': {
      const data = entity.data;
      const id = firstStringField(data, ['actorId', 'actor_id', 'id']) ?? entity.label;
      return { kind: 'threat_actor', entityId: id };
    }
    case 'campaign': {
      // Delegate to parent actor — forecast model is actor-level.
      const data = entity.data;
      const actorId =
        firstStringField(data, ['actorId', 'actor_id']) ??
        firstStringField(data, ['actorName', 'actor_name', 'actorDisplayName']);
      if (!actorId) return { kind: null, entityId: null };
      return { kind: 'campaign', entityId: actorId };
    }
    // victim, matrix_cell, sankey_flow — no forecast surface in v0.1
    case 'victim':
    case 'matrix_cell':
    case 'sankey_flow':
      return { kind: null, entityId: null };
  }
}

/* ─── Per-kind renderers ─── */

interface RenderedEntity {
  stripe: StripeKind;
  kindBadge: string;
  title: string;
  body: React.ReactNode;
}

function renderEntity(entity: IntelCardEntity): RenderedEntity {
  switch (entity.kind) {
    case 'threat_actor':
      return renderThreatActor(entity.label, entity.data);
    case 'campaign':
      return renderCampaign(entity.label, entity.data);
    case 'cve':
      return renderCVE(entity.label, entity.data);
    case 'victim':
      return renderVictim(entity.label, entity.data);
    case 'matrix_cell':
      return renderMatrixCell(entity.actor, entity.tactic, entity.cell);
    case 'sankey_flow':
      return renderSankeyFlow(entity.source, entity.target, entity.value);
  }
}

/* ─── Threat actor body ─── */

function renderThreatActor(label: string, data: Record<string, unknown>): RenderedEntity {
  const grade = (data.actorGrade as string | undefined) ?? null;
  const score = (data.compositeScore as number | undefined) ?? null;
  const capability = (data.capabilityScore as number | undefined) ?? null;
  const reach = (data.reachScore as number | undefined) ?? null;
  const recency = (data.recencyScore as number | undefined) ?? null;
  const campaignCount = (data.campaignCount as number | undefined) ?? null;
  const victimCount = (data.victimCount as number | undefined) ?? null;
  const topTechniques =
    (data.topTechniques as string[] | undefined) ?? (data.ttps as string[] | undefined) ?? [];
  const motivation =
    (data.motivation as string | undefined) ?? (data.origin as string | undefined) ?? null;

  return {
    stripe: 'critical',
    kindBadge: 'Threat actor',
    title: label,
    body: (
      <>
        {(grade != null || score != null) && (
          <Row
            label="Composite"
            value={
              <span>
                {grade != null && (
                  <span
                    style={{
                      fontFamily: "'VT323', 'Geist Mono', monospace",
                      fontSize: 26,
                      lineHeight: 1,
                      color: stripeColor('critical'),
                      marginRight: 8,
                    }}
                  >
                    {grade}
                  </span>
                )}
                {score != null && (
                  <span
                    style={{
                      fontFamily: "'VT323', 'Geist Mono', monospace",
                      fontSize: 22,
                      color: 'var(--text-primary, #e8e8e8)',
                    }}
                  >
                    {score.toFixed(1)}
                  </span>
                )}
              </span>
            }
          />
        )}
        {(capability != null || reach != null || recency != null) && (
          <Row
            label="Sub-scores"
            value={
              <span style={{ color: 'var(--text-dim, #aaa)' }}>
                {capability != null && <>cap {capability.toFixed(1)}</>}
                {reach != null && <> · reach {reach.toFixed(1)}</>}
                {recency != null && <> · rec {recency.toFixed(1)}</>}
              </span>
            }
          />
        )}
        {(campaignCount != null || victimCount != null) && (
          <Row
            label="Reach"
            value={
              <span style={{ color: 'var(--text-dim, #aaa)' }}>
                {campaignCount != null && <>{campaignCount} campaigns</>}
                {campaignCount != null && victimCount != null && <> · </>}
                {victimCount != null && <>{victimCount} victims</>}
              </span>
            }
          />
        )}
        {topTechniques.length > 0 && (
          <Row label="Top TTPs" value={<ChipRow items={topTechniques.slice(0, 5)} />} />
        )}
        {motivation && <Row label="Motive" value={<span>{motivation}</span>} />}
      </>
    ),
  };
}

/* ─── Campaign body ─── */

function renderCampaign(label: string, data: Record<string, unknown>): RenderedEntity {
  const attributedActor = (data.actorName as string | undefined) ?? null;
  const status = (data.status as string | undefined) ?? null;
  const targetCount = (data.targetCount as number | undefined) ?? null;
  const cveCount = (data.cveCount as number | undefined) ?? null;
  const firstSeen = (data.firstObserved as string | undefined) ?? null;
  const lastSeen = (data.lastObserved as string | undefined) ?? null;

  return {
    stripe: 'warm',
    kindBadge: 'Campaign',
    title: label,
    body: (
      <>
        {attributedActor && <Row label="Attributed" value={<span>{attributedActor}</span>} />}
        {status && (
          <Row
            label="Status"
            value={
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--crt-glow, #00ff41)',
                  border: '1px solid rgba(var(--crt-glow-rgb),0.35)',
                  padding: '1px 5px',
                }}
              >
                {status}
              </span>
            }
          />
        )}
        {targetCount != null && <Row label="Targets" value={<span>{targetCount} victims</span>} />}
        {cveCount != null && <Row label="CVEs" value={<span>{cveCount} exploited</span>} />}
        {(firstSeen || lastSeen) && (
          <Row
            label="Window"
            value={
              <span style={{ color: 'var(--text-dim, #aaa)' }}>
                {firstSeen ? formatDate(firstSeen) : '?'} →{' '}
                {lastSeen ? formatDate(lastSeen) : 'now'}
              </span>
            }
          />
        )}
      </>
    ),
  };
}

/* ─── CVE body ─── */

function renderCVE(label: string, data: Record<string, unknown>): RenderedEntity {
  const cvss =
    (data.cvssV3Score as number | undefined) ?? (data.cvssScore as number | undefined) ?? null;
  const severity = (data.severity as string | undefined) ?? null;
  const epss = (data.epssPercentile as number | undefined) ?? null;
  const isKev = (data.isKev as boolean | undefined) ?? (data.kev as boolean | undefined) ?? false;
  const summary = (data.summary as string | undefined) ?? (data.description as string | undefined);
  const products =
    (data.affectedProducts as string[] | undefined) ??
    (data.products as string[] | undefined) ??
    [];

  const stripe = severity ? severityKindFromString(severity) : severityKindFromCVSS(cvss);

  return {
    stripe,
    kindBadge: 'CVE',
    title: label,
    body: (
      <>
        {cvss != null && (
          <Row
            label="CVSS v3"
            value={
              <span>
                <span
                  style={{
                    fontFamily: "'VT323', 'Geist Mono', monospace",
                    fontSize: 26,
                    color: stripeColor(stripe),
                    marginRight: 8,
                  }}
                >
                  {cvss.toFixed(1)}
                </span>
                {severity && (
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: stripeColor(stripe),
                      border: `1px solid ${stripeColor(stripe)}66`,
                      padding: '1px 5px',
                    }}
                  >
                    {severity}
                  </span>
                )}
              </span>
            }
          />
        )}
        {epss != null && (
          <Row
            label="EPSS"
            value={
              <span style={{ color: 'var(--text-dim, #aaa)' }}>
                {(epss * 100).toFixed(1)}% exploit likelihood
              </span>
            }
          />
        )}
        {isKev && (
          <Row
            label="CISA KEV"
            value={
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#ff0040',
                  border: '1px solid rgba(255,0,64,0.55)',
                  padding: '1px 5px',
                  background: 'rgba(255,0,64,0.08)',
                }}
              >
                Known exploited
              </span>
            }
          />
        )}
        {summary && (
          <div style={{ marginTop: 6, color: 'var(--text-dim, #aaa)', fontSize: 11 }}>
            {truncate(summary, 200)}
          </div>
        )}
        {products.length > 0 && (
          <Row label="Affected" value={<ChipRow items={products.slice(0, 3)} />} />
        )}
      </>
    ),
  };
}

/* ─── Victim body ─── */

function renderVictim(label: string, data: Record<string, unknown>): RenderedEntity {
  const sector =
    (data.sector as string | undefined) ?? (data.industry as string | undefined) ?? null;
  const country = (data.country as string | undefined) ?? null;
  const records =
    (data.recordsAffected as number | undefined) ??
    (data.recordsCompromised as number | undefined) ??
    null;
  const disclosedAt =
    (data.disclosureDate as string | undefined) ?? (data.disclosedAt as string | undefined) ?? null;
  const attributedActor = (data.attributedActor as string | undefined) ?? null;

  return {
    stripe: 'neutral',
    kindBadge: 'Victim',
    title: label,
    body: (
      <>
        {sector && (
          <Row
            label="Sector"
            value={
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#7a8b99',
                  border: '1px solid rgba(122,139,153,0.5)',
                  padding: '1px 5px',
                }}
              >
                {sector}
              </span>
            }
          />
        )}
        {country && <Row label="Country" value={<span>{country}</span>} />}
        {records != null && (
          <Row
            label="Records"
            value={
              <span
                style={{
                  fontFamily: "'VT323', 'Geist Mono', monospace",
                  fontSize: 22,
                  color: '#ff4444',
                }}
              >
                {formatNumber(records)}
              </span>
            }
          />
        )}
        {disclosedAt && (
          <Row
            label="Disclosed"
            value={
              <span style={{ color: 'var(--text-dim, #aaa)' }}>{formatDate(disclosedAt)}</span>
            }
          />
        )}
        {attributedActor && <Row label="Attributed" value={<span>{attributedActor}</span>} />}
      </>
    ),
  };
}

/* ─── Matrix cell body ─── */

function renderMatrixCell(
  actor: ActorRow,
  tactic: TacticRow,
  cell: CellRow | null,
): RenderedEntity {
  const count = cell?.techniqueCount ?? 0;
  const techniques = cell?.topTechniques ?? [];

  return {
    stripe: count > 0 ? 'low' : 'neutral',
    kindBadge: 'Kill-chain cell',
    title: actor.displayName,
    body: (
      <>
        <Row
          label="Tactic"
          value={
            <span>
              <span style={{ color: 'var(--text-dim, #aaa)', marginRight: 6 }}>
                {tactic.tacticId}
              </span>
              <span>{tactic.name}</span>
            </span>
          }
        />
        <Row
          label="Techniques"
          value={
            count > 0 ? (
              <span
                style={{
                  fontFamily: "'VT323', 'Geist Mono', monospace",
                  fontSize: 26,
                  color: 'var(--crt-glow, #00ff41)',
                }}
              >
                {count}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted, #888)' }}>No observed activity</span>
            )
          }
        />
        {techniques.length > 0 && (
          <Row label="IDs" value={<ChipRow items={techniques.slice(0, 6)} />} />
        )}
        <Row
          label="MITRE"
          value={
            <span style={{ color: 'var(--text-dim, #aaa)' }}>
              attack.mitre.org/tactics/{tactic.tacticId}
            </span>
          }
        />
      </>
    ),
  };
}

/* ─── Sankey flow body (the user's #1 ask) ─── */

function renderSankeyFlow(
  source: SankeyNodeRow,
  target: SankeyNodeRow,
  value: number,
): RenderedEntity {
  // The sankey flow card uses severity-red because high volume = high concern.
  // Color intensity gradient ladder: 1 = green, 2 = amber, 3+ = red.
  const stripe: StripeKind = value >= 3 ? 'critical' : value >= 2 ? 'medium' : 'low';

  const sourceKindColor =
    source.kind === 'actor' ? '#ff0040' : source.kind === 'campaign' ? '#ffaa00' : '#7a8b99';
  const targetKindColor =
    target.kind === 'actor' ? '#ff0040' : target.kind === 'campaign' ? '#ffaa00' : '#7a8b99';

  return {
    stripe,
    kindBadge: 'Attack flow',
    title: `${truncate(source.label, 14)} → ${truncate(target.label, 14)}`,
    body: (
      <>
        <Row
          label="From"
          value={
            <span>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: sourceKindColor,
                  border: `1px solid ${sourceKindColor}66`,
                  padding: '1px 5px',
                  marginRight: 6,
                }}
              >
                {source.kind}
              </span>
              <span>{source.label}</span>
            </span>
          }
        />
        <Row
          label="To"
          value={
            <span>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: targetKindColor,
                  border: `1px solid ${targetKindColor}66`,
                  padding: '1px 5px',
                  marginRight: 6,
                }}
              >
                {target.kind}
              </span>
              <span>{target.label}</span>
            </span>
          }
        />
        <Row
          label="Volume"
          value={
            <span>
              <span
                style={{
                  fontFamily: "'VT323', 'Geist Mono', monospace",
                  fontSize: 26,
                  color: stripeColor(stripe),
                  marginRight: 8,
                }}
              >
                {value}
              </span>
              <span style={{ color: 'var(--text-dim, #aaa)' }}>
                attack{value === 1 ? '' : 's'} this path
              </span>
            </span>
          }
        />
        <div
          style={{
            marginTop: 6,
            color: 'var(--text-muted, #888)',
            fontSize: 10,
            lineHeight: 1.4,
          }}
        >
          Band thickness encodes attack count along this leg of the kill chain.
        </div>
      </>
    ),
  };
}

/* ─── Shared primitives ─── */

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '88px 1fr',
        columnGap: 10,
        alignItems: 'baseline',
        padding: '3px 0',
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-muted, #888)',
        }}
      >
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

function ChipRow({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {items.map((it) => (
        <span
          key={it}
          style={{
            fontSize: 9,
            letterSpacing: '0.08em',
            color: 'var(--crt-glow, #00ff41)',
            border: '1px solid rgba(var(--crt-glow-rgb),0.35)',
            padding: '1px 5px',
            fontFamily: "'Geist Mono', ui-monospace, monospace",
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(s: string): string {
  // Accept ISO or Date-parsable; degrade to raw on parse failure.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toISOString().slice(0, 10);
}
