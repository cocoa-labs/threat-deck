'use client';

/**
 * Phase 11.D.10 — PredictionsPanel.
 *
 * The headline 11.D surface. Three pill-button selectors at top let the
 * user toggle which forecasting model drives the body:
 *
 *   MODEL    LOGISTIC / BAYESIAN / HMM / TIMESERIES / CAUSAL
 *   HORIZON  30D / 60D / 90D    (LOGISTIC + HMM only)
 *   CI       68% / 95% / 99%    (LOGISTIC + BAYESIAN + TIMESERIES)
 *
 * Each row in the body is clickable → prefillAgent with full forecast
 * context per rule #17, so the AgentDrawer sidebar receives the entity +
 * model + the actual numbers as trendData.
 *
 * Data: GET /api/aegis/predictions?model=X&limit=10 — one request per
 * model selection, TanStack-cached so flipping selectors is instant.
 *
 * Visual chrome: PanelShell wrapper, pill selectors styled to match
 * TwitterPanel.tsx's chip register (8px monospace caps, matrix-green
 * active). Severity stripe on each row mirrors the IntelCard convention.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { cn } from '@/lib/utils/cn';
import { prefillAgent } from '@/lib/utils/panel-actions';

type ModelName = 'logistic' | 'bayesian' | 'hmm' | 'timeseries' | 'causal';
type Horizon = 30 | 60 | 90;
type CIBand = 68 | 95 | 99;
type PredictionsVariant = 'panel' | 'hero';

const MODEL_LABELS: Record<ModelName, string> = {
  logistic: 'LOGISTIC',
  bayesian: 'BAYESIAN',
  hmm: 'HMM',
  timeseries: 'TIMESERIES',
  causal: 'CAUSAL',
};

const HORIZON_VALUES: readonly Horizon[] = [30, 60, 90];
const CI_VALUES: readonly CIBand[] = [68, 95, 99];

/** Which selectors are enabled for which model. */
const SELECTOR_MASK: Record<ModelName, { horizon: boolean; ci: boolean }> = {
  logistic: { horizon: true, ci: true },
  bayesian: { horizon: false, ci: true },
  hmm: { horizon: true, ci: false },
  timeseries: { horizon: true, ci: true },
  causal: { horizon: false, ci: false },
};

interface PanelItem {
  id: string;
  label: string;
  primaryValue: number;
  secondaryValue?: number;
  badge?: string;
  sourceUrl?: string;
}

interface PanelResponse {
  ok: boolean;
  model: ModelName | null;
  items: PanelItem[];
  modelVersion: string | null;
}

const EMPTY_PANEL_ITEMS: PanelItem[] = [];

function prefillForecastAgent(item: PanelItem, model: ModelName, horizon: Horizon, ciBand: CIBand) {
  const prompts: Record<ModelName, string> = {
    logistic: `Walk me through the exploit forecast for ${item.label}. Why does the model rank it this high?`,
    bayesian: `Why does the Bayesian model project ${item.label} as a likely next target? What's the evidence base?`,
    hmm: `Walk me through ${item.label}'s lifecycle state distribution. What's the expected time until weaponization?`,
    timeseries: `Analyze the ${item.label} time-series trend. What's driving the projection?`,
    causal: `Walk me through the counterfactual ${item.label}. How does the intervention shift breach risk?`,
  };

  prefillAgent(prompts[model], {
    sourcePanel: `predictions-${model}`,
    dataType: `${model}Forecast`,
    trendData: {
      model,
      modelName: MODEL_LABELS[model],
      horizon,
      ciBand,
      id: item.id,
      label: item.label,
      primaryValue: item.primaryValue,
      secondaryValue: item.secondaryValue,
      badge: item.badge,
      sourceUrl: item.sourceUrl,
    },
  });
}

export function PredictionsPanel(): React.JSX.Element {
  return (
    <PanelShell id="predictions" title="PREDICTIONS" span={2}>
      <PredictionsSurface variant="panel" />
    </PanelShell>
  );
}

export function PredictionsSurface({
  variant = 'panel',
}: {
  variant?: PredictionsVariant;
}): React.JSX.Element {
  const [model, setModel] = useState<ModelName>('logistic');
  const [horizon, setHorizon] = useState<Horizon>(30);
  const [ciBand, setCiBand] = useState<CIBand>(95);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const limit = variant === 'hero' ? 14 : 10;

  const { data, isFetching } = useQuery<PanelResponse>({
    queryKey: ['predictions-panel', model, limit],
    queryFn: async () => {
      const res = await fetch(`/api/aegis/predictions?model=${model}&limit=${limit}`);
      if (!res.ok) throw new Error(`predictions ${res.status}`);
      return (await res.json()) as PanelResponse;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const items = data?.items ?? EMPTY_PANEL_ITEMS;
  const modelVersion = data?.modelVersion ?? null;
  const mask = SELECTOR_MASK[model];
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? items[0] ?? null,
    [items, selectedItemId],
  );

  const selectors = (
    <div className="flex flex-wrap items-center gap-1">
      <SelectorRow
        label="MODEL"
        options={(Object.keys(MODEL_LABELS) as ModelName[]).map((k) => ({
          value: k,
          label: MODEL_LABELS[k],
        }))}
        active={model}
        onSelect={(v) => setModel(v as ModelName)}
      />
      <SelectorRow
        label="HORIZON"
        options={HORIZON_VALUES.map((h) => ({ value: String(h), label: `${h}D` }))}
        active={String(horizon)}
        onSelect={(v) => setHorizon(Number(v) as Horizon)}
        disabled={!mask.horizon}
      />
      <SelectorRow
        label="CI"
        options={CI_VALUES.map((c) => ({ value: String(c), label: `${c}%` }))}
        active={String(ciBand)}
        onSelect={(v) => setCiBand(Number(v) as CIBand)}
        disabled={!mask.ci}
      />
    </div>
  );

  if (variant === 'hero') {
    return (
      <div className="h-full bg-[#050505] p-3 text-[var(--text-primary)]">
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 pr-36">
            <div>
              <div className="text-[10px] font-mono font-semibold uppercase tracking-[0.16em] text-[var(--crt-glow)]">
                AEGIS FORECAST
              </div>
              {modelVersion && (
                <div className="mt-0.5 text-[7px] font-mono uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  {modelVersion}
                </div>
              )}
            </div>
            {selectors}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 pt-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-h-0 overflow-y-auto border border-[var(--border-subtle)] bg-black/30">
              {isFetching && items.length === 0 ? (
                <SkeletonRows count={8} />
              ) : items.length === 0 ? (
                <EmptyState model={model} />
              ) : (
                <RowList
                  items={items}
                  model={model}
                  horizon={horizon}
                  ciBand={ciBand}
                  selectedId={selectedItem?.id ?? null}
                  onSelect={(item) => setSelectedItemId(item.id)}
                />
              )}
            </div>
            <ForecastDetail
              item={selectedItem}
              model={model}
              horizon={horizon}
              ciBand={ciBand}
              isFetching={isFetching}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="mb-2">{selectors}</div>

      {modelVersion && (
        <div className="text-[7px] font-mono text-[var(--text-muted)] uppercase tracking-[0.12em] mb-1">
          {modelVersion}
        </div>
      )}

      <div className="overflow-y-auto flex-1">
        {isFetching && items.length === 0 ? (
          <SkeletonRows count={5} />
        ) : items.length === 0 ? (
          <EmptyState model={model} />
        ) : (
          <RowList items={items} model={model} horizon={horizon} ciBand={ciBand} />
        )}
      </div>
    </div>
  );
}

// ─── Selector pill row ──────────────────────────────────────────────────────

function SelectorRow({
  label,
  options,
  active,
  onSelect,
  disabled = false,
}: {
  label: string;
  options: { value: string; label: string }[];
  active: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[7px] font-mono uppercase tracking-[0.14em] text-[var(--text-muted)] min-w-[44px]">
        {label}
      </span>
      <div className="flex gap-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(opt.value)}
            className={cn(
              'px-1.5 py-0.5 text-[8px] font-mono font-semibold uppercase tracking-[0.1em]',
              'rounded-[var(--radius-sm)] border border-[var(--border-subtle)]',
              !disabled && active === opt.value
                ? 'bg-[var(--crt-glow)]/15 text-[var(--crt-glow)] border-[var(--crt-glow)]/30'
                : disabled
                  ? 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Row list ───────────────────────────────────────────────────────────────

function RowList({
  items,
  model,
  horizon,
  ciBand,
  selectedId,
  onSelect,
}: {
  items: PanelItem[];
  model: ModelName;
  horizon: Horizon;
  ciBand: CIBand;
  selectedId?: string | null;
  onSelect?: (item: PanelItem) => void;
}): React.JSX.Element {
  // Cache the max primary value for relative bar scaling on timeseries rows
  const maxPrimary = useMemo(() => Math.max(0.01, ...items.map((i) => i.primaryValue)), [items]);

  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <Row
          key={item.id}
          item={item}
          model={model}
          horizon={horizon}
          ciBand={ciBand}
          maxPrimary={maxPrimary}
          selected={selectedId === item.id}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function Row({
  item,
  model,
  horizon,
  ciBand,
  maxPrimary,
  selected,
  onSelect,
}: {
  item: PanelItem;
  model: ModelName;
  horizon: Horizon;
  ciBand: CIBand;
  maxPrimary: number;
  selected?: boolean;
  onSelect?: (item: PanelItem) => void;
}): React.JSX.Element {
  const handleClick = () => {
    if (onSelect) {
      onSelect(item);
      return;
    }

    prefillForecastAgent(item, model, horizon, ciBand);
  };

  const isPercentage = model !== 'timeseries' && model !== 'causal';
  const primaryDisplay = isPercentage
    ? `${(item.primaryValue * 100).toFixed(1)}%`
    : model === 'causal'
      ? `${(item.primaryValue * 100).toFixed(1)}pp`
      : item.primaryValue.toFixed(2);

  const severityStripeColor = stripeForBadge(item.badge);
  const trendGlyph =
    model === 'timeseries'
      ? item.secondaryValue === 1
        ? '↑'
        : item.secondaryValue === -1
          ? '↓'
          : '→'
      : null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'text-left w-full hover:bg-[var(--bg-hover)] border-b border-[var(--border-subtle)] flex items-center group',
        selected && 'bg-[var(--crt-glow)]/10',
      )}
      style={{ padding: '4px 6px', minHeight: 28 }}
    >
      {/* Severity stripe (3px left border) */}
      <div
        style={{
          width: 3,
          alignSelf: 'stretch',
          background: severityStripeColor,
          marginRight: 6,
          opacity: 0.85,
        }}
      />
      {/* Label */}
      <span
        className="text-[10px] font-mono text-[var(--text-primary)] truncate"
        style={{ minWidth: 0, flex: 1 }}
      >
        {item.label}
      </span>
      {/* Primary metric bar */}
      <div
        className="ml-2 mr-2 shrink-0"
        style={{
          width: 64,
          height: 5,
          background: 'rgba(255, 255, 255, 0.05)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${isPercentage ? item.primaryValue * 100 : Math.min(100, (item.primaryValue / maxPrimary) * 100)}%`,
            background: 'var(--matrix-green, #00ff41)',
            opacity: 0.9,
          }}
        />
      </div>
      {/* Primary value text */}
      <span
        className="text-[10px] font-mono font-semibold tabular-nums text-[var(--matrix-green,#00ff41)] min-w-[44px] text-right shrink-0"
        title={`${model} model · primary: ${item.primaryValue.toFixed(4)} · secondary: ${item.secondaryValue?.toFixed(4) ?? 'n/a'}`}
      >
        {primaryDisplay}
      </span>
      {/* Optional badge / trend glyph */}
      {trendGlyph && (
        <span
          className={cn(
            'ml-1 text-[10px] font-mono font-bold shrink-0 w-3 text-center',
            trendGlyph === '↑' && 'text-[var(--severity-critical,_var(--color-negative))]',
            trendGlyph === '↓' && 'text-[var(--matrix-green,#00ff41)]',
            trendGlyph === '→' && 'text-[var(--text-muted)]',
          )}
        >
          {trendGlyph}
        </span>
      )}
      {!trendGlyph && item.badge && (
        <span
          className="ml-1 text-[7px] font-mono font-bold uppercase shrink-0 px-1 rounded"
          style={{
            color: severityStripeColor,
            background: `${severityStripeColor}22`,
            border: `1px solid ${severityStripeColor}44`,
          }}
        >
          {item.badge.slice(0, 4)}
        </span>
      )}
    </button>
  );
}

function ForecastDetail({
  item,
  model,
  horizon,
  ciBand,
  isFetching,
}: {
  item: PanelItem | null;
  model: ModelName;
  horizon: Horizon;
  ciBand: CIBand;
  isFetching: boolean;
}): React.JSX.Element {
  if (!item) {
    return (
      <div className="min-h-[180px] border border-[var(--border-subtle)] bg-black/30 p-3">
        <div className="text-[9px] font-mono uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {isFetching ? 'Loading forecast detail' : 'No forecast selected'}
        </div>
      </div>
    );
  }

  const isPercentage = model !== 'timeseries' && model !== 'causal';
  const primaryDisplay = isPercentage
    ? `${(item.primaryValue * 100).toFixed(1)}%`
    : model === 'causal'
      ? `${(item.primaryValue * 100).toFixed(1)}pp`
      : item.primaryValue.toFixed(2);
  const secondaryDisplay =
    item.secondaryValue == null
      ? 'n/a'
      : model === 'timeseries'
        ? item.secondaryValue === 1
          ? 'rising'
          : item.secondaryValue === -1
            ? 'falling'
            : 'flat'
        : item.secondaryValue.toFixed(3);

  return (
    <div className="min-h-0 overflow-hidden border border-[var(--border-subtle)] bg-black/30 p-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[7px] font-mono uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Selected Forecast
          </div>
          <div className="mt-0.5 truncate text-[11px] font-mono font-semibold leading-tight text-[var(--text-primary)]">
            {item.label}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-[2px] border border-[var(--border-subtle)] px-2 py-1 text-[8px] font-mono uppercase tracking-[0.12em] text-[var(--text-muted)] hover:text-[var(--crt-glow)]"
            >
              Source
            </a>
          )}
          <button
            type="button"
            onClick={() => prefillForecastAgent(item, model, horizon, ciBand)}
            className="rounded-[2px] border border-[var(--crt-glow)]/35 bg-[var(--crt-glow)]/10 px-2 py-1 text-[8px] font-mono font-semibold uppercase tracking-[0.12em] text-[var(--crt-glow)] hover:bg-[var(--crt-glow)]/16"
          >
            Ask Max
          </button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 lg:grid-cols-4">
        <ForecastMetric label={MODEL_LABELS[model]} value={primaryDisplay} />
        <ForecastMetric label="Signal" value={secondaryDisplay} />
        <ForecastMetric label="Horizon" value={`${horizon}D`} />
        <ForecastMetric label="CI" value={`${ciBand}%`} />
      </div>
      {item.badge && (
        <div
          className="mt-3 inline-flex rounded-[2px] border px-2 py-1 text-[8px] font-mono font-semibold uppercase tracking-[0.12em]"
          style={{
            color: stripeForBadge(item.badge),
            background: `${stripeForBadge(item.badge)}18`,
            borderColor: `${stripeForBadge(item.badge)}44`,
          }}
        >
          {item.badge}
        </div>
      )}
    </div>
  );
}

function ForecastMetric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="border border-[var(--border-subtle)] bg-black/25 px-1.5 py-1">
      <div className="text-[7px] font-mono uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-0.5 text-[10px] font-mono font-semibold tabular-nums text-[var(--crt-glow)]">
        {value}
      </div>
    </div>
  );
}

function stripeForBadge(badge: string | undefined): string {
  if (!badge) return 'rgba(255, 255, 255, 0.15)';
  const s = badge.toLowerCase();
  if (s === 'critical') return '#ff0040';
  if (s === 'high' || s === 'rising') return '#ff4444';
  if (s === 'medium' || s === 'flat') return '#ffaa00';
  if (s === 'low' || s === 'falling') return '#00ff41';
  // Actor names / metric names → use matrix-green
  return 'rgba(var(--crt-glow-rgb), 0.4)';
}

// ─── Empty + skeleton states ────────────────────────────────────────────────

function SkeletonRows({ count }: { count: number }): React.JSX.Element {
  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 border-b border-[var(--border-subtle)] animate-pulse"
          style={{ padding: '6px 6px', minHeight: 28 }}
        >
          <div className="w-3 self-stretch bg-[var(--bg-hover)]" />
          <div className="h-2 w-32 bg-[var(--bg-hover)] rounded" />
          <div className="ml-auto h-2 w-16 bg-[var(--bg-hover)] rounded" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ model }: { model: ModelName }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center px-4 py-6">
      <div className="text-center">
        <div className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-[0.12em]">
          No {MODEL_LABELS[model]} forecasts yet
        </div>
        <div className="mt-2 text-[8px] font-mono text-[var(--text-muted)] opacity-60">
          forecasts populate as the daily cron runs
        </div>
      </div>
    </div>
  );
}
