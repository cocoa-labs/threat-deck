'use client';

/**
 * Phase 11.D.11 — IntelCard inline forecast section.
 *
 * Pure presentational. Slots between IntelCardPivots and the IntelCard
 * action footer. Renders forecast for the entity kind:
 *
 *   - CVE         → logistic P(exploited 30d) bar + CI + HMM 5-state stacked bar
 *   - threat_actor → top-3 sector posterior with CI bars
 *   - campaign     → delegated to parent actor (renders ACTOR view)
 *   - victim       → causal counterfactual (placeholder for v0.1)
 *
 * Loading state: single skeleton bar. Empty/null: render nothing — no
 * hairline, no header. Mirrors IntelCardPivots' "respect card height
 * during load, vanish when no data" pattern.
 *
 * All clicks pass-through to AgentDrawer per rule #17 with full forecast
 * trendData in the prefill payload.
 */

import type { IntelCardEntity } from '@/components/hero/IntelCard';
import { prefillAgent } from '@/lib/utils/panel-actions';

interface ForecastData {
  /** CVE logistic forecast — { p30, ciLow, ciHigh, modelVersion }. */
  logistic?: {
    pExploited30d: number;
    pExploited60d: number;
    pExploited90d: number;
    ciLow: number;
    ciHigh: number;
    modelVersion: string;
  } | null;
  /** HMM state distribution + expected days to weaponized. */
  hmm?: {
    stateDistribution: number[];
    viterbiPath: number[];
    expectedDaysToKev: number | null;
    modelVersion: string;
  } | null;
  /** Actor target Dirichlet posterior — top-K sectors. */
  actorTargets?: Array<{
    category: string;
    pMean: number;
    pLow: number;
    pHigh: number;
  }> | null;
  actorTargetsModel?: string;
}

interface IntelCardForecastProps {
  entity: IntelCardEntity;
  data: ForecastData | null;
  loading: boolean;
}

const HAIRLINE = 'rgba(255, 255, 255, 0.05)';
const MATRIX = 'var(--matrix-green, #00ff41)';
const FONT_MONO_TIGHT = "'Geist Mono', ui-monospace, monospace";

/** 5-state lifecycle palette — Discovered → POC → Weaponized → Mass-Exploit → Patched. */
const STATE_COLORS = [
  'rgba(120, 120, 120, 0.6)', // Discovered — grey
  'rgba(80, 160, 220, 0.7)', // POC_Available — blue
  'rgba(255, 170, 0, 0.85)', // Weaponized — amber
  'rgba(255, 64, 80, 0.9)', // Mass_Exploitation — red
  'rgba(0, 200, 100, 0.7)', // Patched_Saturated — green
];
const STATE_LABELS = ['DISC', 'POC', 'WEAP', 'MASS', 'PATCH'];

export function IntelCardForecast({
  entity,
  data,
  loading,
}: IntelCardForecastProps): React.JSX.Element | null {
  // Skeleton during first load — slot reservation so card height doesn't jump
  if (loading && !data) {
    return (
      <>
        <div style={{ height: 1, background: HAIRLINE }} />
        <div style={{ padding: '6px 14px 8px' }}>
          <ForecastHeader loading />
          <SkeletonBar />
        </div>
      </>
    );
  }

  if (!data) return null;

  // Per-kind rendering
  if (entity.kind === 'cve' && data.logistic) {
    return <CveForecastBlock entity={entity} data={data} />;
  }
  if ((entity.kind === 'threat_actor' || entity.kind === 'campaign') && data.actorTargets) {
    return <ActorForecastBlock entity={entity} data={data} />;
  }

  return null;
}

// ─── CVE forecast block ─────────────────────────────────────────────────────

function CveForecastBlock({
  entity,
  data,
}: {
  entity: IntelCardEntity;
  data: ForecastData;
}): React.JSX.Element {
  const logistic = data.logistic!;
  const p = logistic.pExploited30d;
  const ciWidth = logistic.ciHigh - logistic.ciLow;
  const cveLabel = 'label' in entity ? entity.label : '';

  const handleClick = () => {
    prefillAgent(
      `Analyze the exploit forecast for ${cveLabel}. Walk through the model's reasoning and any mitigations available.`,
      {
        sourcePanel: 'intelcard-forecast',
        dataType: 'cveForecast',
        trendData: {
          cveId: cveLabel,
          pExploited30d: p,
          pExploited60d: logistic.pExploited60d,
          pExploited90d: logistic.pExploited90d,
          ciLow: logistic.ciLow,
          ciHigh: logistic.ciHigh,
          logisticModel: logistic.modelVersion,
          hmmStateDistribution: data.hmm?.stateDistribution,
          hmmExpectedDaysToKev: data.hmm?.expectedDaysToKev ?? null,
          sourceUrl: `/api/aegis/predictions/cve-forecast?cveId=${encodeURIComponent(cveLabel)}`,
        },
      },
    );
  };

  return (
    <>
      <div style={{ height: 1, background: HAIRLINE }} />
      <button
        type="button"
        onClick={handleClick}
        style={{
          all: 'unset',
          display: 'block',
          width: '100%',
          padding: '6px 14px 8px',
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
      >
        <ForecastHeader />
        {/* P30d headline with CSS gradient bar + CI overlay */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily: FONT_MONO_TIGHT,
              fontSize: 11,
              color: MATRIX,
              minWidth: 70,
            }}
          >
            P30d {(p * 100).toFixed(1)}%
          </span>
          <div
            style={{
              flex: 1,
              height: 6,
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: 1,
              position: 'relative',
              overflow: 'hidden',
            }}
            title={`Logistic regression: ${(p * 100).toFixed(2)}% probability over 30 days (95% CI: ${(logistic.ciLow * 100).toFixed(1)}%–${(logistic.ciHigh * 100).toFixed(1)}%)`}
          >
            {/* CI band (lighter) */}
            <div
              style={{
                position: 'absolute',
                left: `${logistic.ciLow * 100}%`,
                width: `${ciWidth * 100}%`,
                top: 0,
                bottom: 0,
                background: `${MATRIX}`,
                opacity: 0.25,
              }}
            />
            {/* Point estimate (bright) */}
            <div
              style={{
                position: 'absolute',
                left: `${Math.max(0, p * 100 - 0.5)}%`,
                width: 2,
                top: 0,
                bottom: 0,
                background: MATRIX,
                boxShadow: `0 0 4px ${MATRIX}`,
              }}
            />
          </div>
          <span
            style={{
              fontFamily: FONT_MONO_TIGHT,
              fontSize: 9,
              color: 'rgba(255, 255, 255, 0.5)',
              minWidth: 80,
              textAlign: 'right',
            }}
          >
            ±{((ciWidth / 2) * 100).toFixed(1)}%
          </span>
        </div>
        {/* HMM 5-state stacked bar */}
        {data.hmm && (
          <div style={{ marginTop: 6 }}>
            <div
              style={{
                display: 'flex',
                height: 5,
                borderRadius: 1,
                overflow: 'hidden',
                background: 'rgba(255, 255, 255, 0.03)',
              }}
              title={hmmTitle(data.hmm.stateDistribution, data.hmm.expectedDaysToKev)}
            >
              {data.hmm.stateDistribution.map((p, i) => (
                <div
                  key={STATE_LABELS[i]}
                  style={{
                    width: `${Math.max(0.5, p * 100)}%`,
                    background: STATE_COLORS[i],
                    transition: 'width 200ms ease-out',
                  }}
                />
              ))}
            </div>
            {data.hmm.expectedDaysToKev != null && data.hmm.expectedDaysToKev > 0 && (
              <div
                style={{
                  marginTop: 3,
                  fontFamily: FONT_MONO_TIGHT,
                  fontSize: 8,
                  color: 'rgba(255, 255, 255, 0.45)',
                }}
              >
                E[days → Mass_Exploitation]: {data.hmm.expectedDaysToKev.toFixed(0)}
              </div>
            )}
          </div>
        )}
        <ModelFooter
          versions={[logistic.modelVersion, data.hmm?.modelVersion].filter((v): v is string =>
            Boolean(v),
          )}
        />
      </button>
    </>
  );
}

function hmmTitle(distribution: number[], days: number | null): string {
  const top = distribution
    .map((p, i) => `${STATE_LABELS[i]}: ${(p * 100).toFixed(0)}%`)
    .join(' · ');
  return days != null && days > 0
    ? `${top}\nExpected days to Mass_Exploitation: ${days.toFixed(0)}`
    : top;
}

// ─── Actor target forecast block ────────────────────────────────────────────

function ActorForecastBlock({
  entity,
  data,
}: {
  entity: IntelCardEntity;
  data: ForecastData;
}): React.JSX.Element | null {
  const targets = data.actorTargets!;
  const actorLabel = 'label' in entity ? entity.label : '';
  if (targets.length === 0) return null;

  const top3 = targets.slice(0, 3);

  const handleClick = () => {
    prefillAgent(
      `Walk through ${actorLabel}'s likely next targets. Why do these sectors rank highest under the Bayesian posterior?`,
      {
        sourcePanel: 'intelcard-forecast',
        dataType: 'actorForecast',
        trendData: {
          actorId: actorLabel,
          topSectors: top3.map((t) => ({
            sector: t.category,
            pMean: t.pMean,
            pLow: t.pLow,
            pHigh: t.pHigh,
          })),
          modelVersion: data.actorTargetsModel,
          sourceUrl: `/api/aegis/predictions/actor-forecast?actorId=${encodeURIComponent(actorLabel)}`,
        },
      },
    );
  };

  return (
    <>
      <div style={{ height: 1, background: HAIRLINE }} />
      <button
        type="button"
        onClick={handleClick}
        style={{
          all: 'unset',
          display: 'block',
          width: '100%',
          padding: '6px 14px 8px',
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
      >
        <ForecastHeader />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {top3.map((t) => {
            const ciWidth = t.pHigh - t.pLow;
            return (
              <div
                key={t.category}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                title={`${t.category}: ${(t.pMean * 100).toFixed(1)}% [CI ${(t.pLow * 100).toFixed(1)}%–${(t.pHigh * 100).toFixed(1)}%]`}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO_TIGHT,
                    fontSize: 9,
                    color: 'rgba(255, 255, 255, 0.7)',
                    minWidth: 70,
                  }}
                >
                  {t.category.slice(0, 11)}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 4,
                    background: 'rgba(255, 255, 255, 0.05)',
                    position: 'relative',
                    borderRadius: 1,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: `${t.pLow * 100}%`,
                      width: `${ciWidth * 100}%`,
                      top: 0,
                      bottom: 0,
                      background: MATRIX,
                      opacity: 0.3,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: `${t.pMean * 100}%`,
                      width: 2,
                      top: 0,
                      bottom: 0,
                      background: MATRIX,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: FONT_MONO_TIGHT,
                    fontSize: 9,
                    color: MATRIX,
                    minWidth: 36,
                    textAlign: 'right',
                  }}
                >
                  {(t.pMean * 100).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
        <ModelFooter versions={data.actorTargetsModel ? [data.actorTargetsModel] : []} />
      </button>
    </>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function ForecastHeader({ loading = false }: { loading?: boolean }): React.JSX.Element {
  return (
    <div
      style={{
        fontFamily: FONT_MONO_TIGHT,
        fontSize: 8,
        letterSpacing: '0.12em',
        color: 'rgba(255, 255, 255, 0.42)',
        marginBottom: 4,
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      Forecast
      {loading && (
        <span
          style={{
            display: 'inline-block',
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: MATRIX,
            opacity: 0.6,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      )}
    </div>
  );
}

function ModelFooter({ versions }: { versions: string[] }): React.JSX.Element | null {
  if (versions.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 5,
        fontFamily: FONT_MONO_TIGHT,
        fontSize: 7,
        letterSpacing: '0.08em',
        color: 'rgba(255, 255, 255, 0.25)',
        textTransform: 'uppercase',
      }}
    >
      {versions.join(' · ')}
    </div>
  );
}

function SkeletonBar(): React.JSX.Element {
  return (
    <div
      style={{
        height: 6,
        background:
          'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s linear infinite',
        borderRadius: 1,
      }}
    />
  );
}
