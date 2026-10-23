/**
 * Phase 11.D.14 — Calibration plot (d3-scale + raw SVG).
 *
 * 240x240px square. X axis = predicted probability (0-1), Y axis =
 * observed rate (0-1). Each bin renders as a dot whose RADIUS is
 * proportional to sample count (more evidence = bigger dot). The diagonal
 * is the "perfectly calibrated" reference — dots above it mean the model
 * is UNDER-confident; dots below it mean OVER-confident.
 *
 * Matches the CVETimelineTab.tsx aesthetic: VT323 axis labels, matrix-
 * green dots, dim diagonal, no chartjunk.
 *
 * Pure presentational — caller supplies the bin data already aggregated.
 */

import { scaleLinear } from 'd3-scale';

interface CalibrationBin {
  pBinCenter: number;
  observedRate: number;
  count: number;
}

const W = 240;
const H = 240;
const PAD = 32;

export function CalibrationPlot({
  bins,
  modelLabel,
}: {
  bins: CalibrationBin[];
  modelLabel: string;
}) {
  if (bins.length === 0) {
    return (
      <div
        style={{
          width: W,
          height: H,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10,
          color: 'var(--text-muted)',
          border: '1px dashed rgba(255,255,255,0.08)',
        }}
      >
        Not enough data
      </div>
    );
  }

  const x = scaleLinear()
    .domain([0, 1])
    .range([PAD, W - PAD]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([H - PAD, PAD]);
  const maxCount = Math.max(...bins.map((b) => b.count));
  const r = scaleLinear()
    .domain([0, Math.max(1, maxCount)])
    .range([3, 12]);

  return (
    <svg
      width={W}
      height={H}
      style={{
        background: 'rgba(0,0,0,0.32)',
        border: '1px solid rgba(255,255,255,0.05)',
        fontFamily: 'VT323, monospace',
      }}
      role="img"
      aria-label={`Calibration plot for ${modelLabel}`}
    >
      {/* Axes */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.2)" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.2)" />

      {/* Diagonal "perfect calibration" reference */}
      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(1)}
        y2={y(1)}
        stroke="rgba(255,255,255,0.12)"
        strokeDasharray="3,3"
      />

      {/* Axis ticks (0, 0.25, 0.5, 0.75, 1.0) */}
      {[0, 0.25, 0.5, 0.75, 1.0].map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={H - PAD} x2={x(t)} y2={H - PAD + 4} stroke="rgba(255,255,255,0.3)" />
          <text
            x={x(t)}
            y={H - PAD + 14}
            textAnchor="middle"
            fontSize={9}
            fill="rgba(255,255,255,0.5)"
          >
            {t.toFixed(2)}
          </text>
          <line x1={PAD - 4} y1={y(t)} x2={PAD} y2={y(t)} stroke="rgba(255,255,255,0.3)" />
          <text x={PAD - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="rgba(255,255,255,0.5)">
            {t.toFixed(2)}
          </text>
        </g>
      ))}

      {/* Axis labels */}
      <text
        x={W / 2}
        y={H - 8}
        textAnchor="middle"
        fontSize={10}
        fill="rgba(255,255,255,0.5)"
        fontFamily="Geist Mono, monospace"
      >
        predicted probability
      </text>
      <text
        x={10}
        y={H / 2}
        textAnchor="middle"
        fontSize={10}
        fill="rgba(255,255,255,0.5)"
        fontFamily="Geist Mono, monospace"
        transform={`rotate(-90, 10, ${H / 2})`}
      >
        observed rate
      </text>

      {/* Bin dots */}
      {bins.map((b) => (
        <g key={b.pBinCenter}>
          <circle
            cx={x(b.pBinCenter)}
            cy={y(b.observedRate)}
            r={r(b.count)}
            fill="var(--matrix-green, #00ff41)"
            fillOpacity={0.55}
            stroke="var(--matrix-green, #00ff41)"
            strokeWidth={1}
          />
          <title>
            {`Bin ${b.pBinCenter.toFixed(2)}: ${(b.observedRate * 100).toFixed(0)}% observed (n=${b.count})`}
          </title>
        </g>
      ))}
    </svg>
  );
}
