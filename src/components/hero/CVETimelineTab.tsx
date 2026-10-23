'use client';

import { scaleTime } from 'd3-scale';
import { timeFormat } from 'd3-time-format';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccentStore } from '@/lib/store/accent-store';
import { prefillAgent } from '@/lib/utils/panel-actions';

interface CVELifecycle {
  cveId: string;
  summary: string | null;
  severity: string | null;
  cvssV3Score: number | null;
  publishedAt: string;
  kevAddedDate: string | null;
  exploitedAt: string | null;
  pocPublicAt: string | null;
  firstPatchAt: string | null;
  /** True iff no recorded patch — drives the pulsing NOW marker. */
  isOngoing?: boolean;
  sourceUrl: string;
}

interface TimelineResponse {
  data: CVELifecycle[];
  windowStart: string;
  windowEnd: string;
  count: number;
  timestamp: string;
  error?: string;
}

interface HoverState {
  cveId: string;
  cve: CVELifecycle;
  clientX: number;
  clientY: number;
}

type HeroPresentation = 'embedded' | 'fullscreen';

interface CVETimelineTabProps {
  presentation?: HeroPresentation;
}

const LEFT_GUTTER_MIN = 184;
const LEFT_GUTTER_MAX = 250;
const TOP_BAND_HEIGHT = 96;
const EMBEDDED_BOTTOM_BAND_HEIGHT = 34;
const FULLSCREEN_BOTTOM_BAND_HEIGHT = 82;
const EMBEDDED_MAX_ROWS = 14;
const FULLSCREEN_MAX_ROWS = 30;
const ROW_HEIGHT_MIN = 20;
const EMBEDDED_ROW_TARGET = 28;
const FULLSCREEN_ROW_TARGET = 22;
const MARKER_SIZE = 8;
const MARKER_HIT_RADIUS = 15;
const PADDING_RIGHT = 28;

const COLOR_PUBLISHED = '#ffdd44';
const COLOR_POC = '#ff8844'; // distinct from EXPLOITED so the eye separates them
const COLOR_EXPLOITED = '#ff0040'; // brand-aligned with --severity-critical
const COLOR_PATCHED = '#00ff41'; // brand-aligned with --crt-glow (matrix green)
const COLOR_CONNECTOR = 'rgba(255,255,255,0.18)';
const COLOR_EXPOSURE_GAP = 'rgba(255,0,64,0.35)'; // exposure window highlight (red wash)
const COLOR_TEXT = '#e8e8e8';
const COLOR_TEXT_DIM = '#888';
const COLOR_ROW_DIVIDER = 'rgba(255,255,255,0.04)';
const COLOR_NOW_LINE = 'rgba(0,255,65,0.35)';

const TICK_FORMAT = timeFormat('%b %d, %Y');

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function fitCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  const ellipsis = '…';
  if (ctx.measureText(ellipsis).width > maxWidth) return '';

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return `${text.slice(0, lo)}${ellipsis}`;
}

function severityColor(severity: string | null): string {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
      return '#ff4444';
    case 'high':
      return '#ff9933';
    case 'medium':
      return '#ffaa00';
    case 'low':
      return '#44ff88';
    default:
      return '#888';
  }
}

/**
 * CVE Timeline — Canvas swim-lane visualization of CVE lifecycle events
 * for the last 90 days. Each row is one CVE; markers show published / PoC /
 * exploited (KEV) / patched events on a shared time axis.
 *
 * Click anywhere on a row → opens AgentDrawer with deep-dive prompt.
 * Hover near a marker → tooltip with severity, CVSS, summary, status flags.
 */
export function CVETimelineTab({ presentation = 'embedded' }: CVETimelineTabProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [response, setResponse] = useState<TimelineResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const accentPalette = useAccentStore((s) => s.accentPalette);
  // Tick counter for the pulsing NOW marker on ongoing/unpatched CVE rows.
  // Increments via requestAnimationFrame only while there's at least one
  // ongoing CVE visible — no idle CPU burn when everything's patched.
  const [animationFrame, setAnimationFrame] = useState(0);

  // Fetch CVE timeline data once on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/aegis/cve-timeline')
      .then((r) => r.json() as Promise<TimelineResponse>)
      .then((json) => {
        if (cancelled) return;
        setResponse(json);
        setLoadError(json.error ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load CVE timeline');
        setResponse({
          data: [],
          windowStart: '',
          windowEnd: '',
          count: 0,
          timestamp: new Date().toISOString(),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // RAF pulse driver — runs only while at least one CVE is ongoing.
  // Idle when fully patched (no wasted frames).
  useEffect(() => {
    const ongoingCount = (response?.data ?? []).filter((c) => c.isOngoing).length;
    if (ongoingCount === 0) return;
    let raf = 0;
    const tick = () => {
      setAnimationFrame((n) => (n + 1) % 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [response]);

  // Observe container resize for crisp redraws
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
    // Seed initial size
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  // Compute axis scale + row layout
  const layout = useMemo(() => {
    if (!response?.windowStart || !response.windowEnd) return null;
    const windowStart = parseDate(response.windowStart);
    const windowEnd = parseDate(response.windowEnd);
    if (!windowStart || !windowEnd) return null;
    const leftGutter = Math.round(
      Math.min(LEFT_GUTTER_MAX, Math.max(LEFT_GUTTER_MIN, size.width * 0.15)),
    );
    if (size.width <= leftGutter + PADDING_RIGHT + 20) return null;

    const data = response.data;
    const bottomBand =
      presentation === 'embedded' ? EMBEDDED_BOTTOM_BAND_HEIGHT : FULLSCREEN_BOTTOM_BAND_HEIGHT;
    const availableRowsHeight = Math.max(0, size.height - TOP_BAND_HEIGHT - bottomBand);
    const rowCap = presentation === 'embedded' ? EMBEDDED_MAX_ROWS : FULLSCREEN_MAX_ROWS;
    const rowTarget = presentation === 'embedded' ? EMBEDDED_ROW_TARGET : FULLSCREEN_ROW_TARGET;
    const fitCount = Math.max(1, Math.floor(availableRowsHeight / rowTarget));
    const visibleData = data.slice(0, Math.min(data.length, rowCap, fitCount));
    const rowCount = visibleData.length;

    if (rowCount === 0) {
      const xScale = scaleTime()
        .domain([windowStart, windowEnd])
        .range([leftGutter, size.width - PADDING_RIGHT]);

      return {
        windowStart,
        windowEnd,
        rowCount: 0,
        rowHeight: 0,
        rowsTop: TOP_BAND_HEIGHT,
        axisY: TOP_BAND_HEIGHT - 10,
        bottomBand,
        leftGutter,
        xScale,
        visibleData,
        markerHits: [] as Array<{
          cveId: string;
          cve: CVELifecycle;
          rowIndex: number;
          x: number;
          y: number;
          eventType: 'published' | 'poc' | 'exploited' | 'patched';
        }>,
        rowHits: [] as Array<{ cveId: string; cve: CVELifecycle; top: number; bottom: number }>,
      };
    }

    const computedRowHeight = Math.max(ROW_HEIGHT_MIN, Math.floor(availableRowsHeight / rowCount));

    const xScale = scaleTime()
      .domain([windowStart, windowEnd])
      .range([leftGutter, size.width - PADDING_RIGHT]);

    const rowsTop = TOP_BAND_HEIGHT;
    const axisY = TOP_BAND_HEIGHT - 10;
    const markerHits: Array<{
      cveId: string;
      cve: CVELifecycle;
      rowIndex: number;
      x: number;
      y: number;
      eventType: 'published' | 'poc' | 'exploited' | 'patched';
    }> = [];
    const rowHits: Array<{
      cveId: string;
      cve: CVELifecycle;
      top: number;
      bottom: number;
    }> = [];

    visibleData.forEach((cve, i) => {
      const rowCenterY = rowsTop + i * computedRowHeight + computedRowHeight / 2;
      rowHits.push({
        cveId: cve.cveId,
        cve,
        top: rowsTop + i * computedRowHeight,
        bottom: rowsTop + (i + 1) * computedRowHeight,
      });

      const events: Array<[Date | null, 'published' | 'poc' | 'exploited' | 'patched']> = [
        [parseDate(cve.publishedAt), 'published'],
        [parseDate(cve.pocPublicAt), 'poc'],
        [parseDate(cve.exploitedAt), 'exploited'],
        [parseDate(cve.firstPatchAt), 'patched'],
      ];

      for (const [d, type] of events) {
        if (!d) continue;
        // Clamp to window
        const clampedDate =
          d.getTime() < windowStart.getTime()
            ? windowStart
            : d.getTime() > windowEnd.getTime()
              ? windowEnd
              : d;
        const x = xScale(clampedDate);
        markerHits.push({
          cveId: cve.cveId,
          cve,
          rowIndex: i,
          x,
          y: rowCenterY,
          eventType: type,
        });
      }
    });

    return {
      windowStart,
      windowEnd,
      rowCount,
      rowHeight: computedRowHeight,
      rowsTop,
      axisY,
      bottomBand,
      leftGutter,
      xScale,
      visibleData,
      markerHits,
      rowHits,
    };
  }, [response, size, presentation]);

  // Draw the chart
  useEffect(() => {
    void accentPalette;
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    if (size.width <= 0 || size.height <= 0) return;
    if (!response) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    // Background
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, size.width, size.height);

    // Resolve CRT glow color for axis (read from computed style)
    let axisColor = 'rgba(0,255,65,0.3)';
    let nowLineColor = COLOR_NOW_LINE;
    let nowLabelColor = 'rgba(0,255,65,0.9)';
    let patchedColor = COLOR_PATCHED;
    try {
      if (containerRef.current) {
        const styles = getComputedStyle(containerRef.current);
        const rgb = styles.getPropertyValue('--crt-glow-rgb').trim();
        const glow = styles.getPropertyValue('--crt-glow').trim();
        if (rgb) {
          axisColor = `rgba(${rgb}, 0.3)`;
          nowLineColor = `rgba(${rgb}, 0.35)`;
          nowLabelColor = `rgba(${rgb}, 0.9)`;
        }
        if (glow) patchedColor = glow;
      }
    } catch {
      /* keep fallback */
    }

    // Time axis (top of plot region)
    const axisY = layout.axisY;
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.leftGutter, axisY);
    ctx.lineTo(size.width - PADDING_RIGHT, axisY);
    ctx.stroke();

    // Axis ticks (always rendered — even on empty datasets the time window is shown)
    ctx.font = "10px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = COLOR_TEXT_DIM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const tickCount = presentation === 'embedded' || size.width < 1100 ? 4 : 6;
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      const tickDate = new Date(
        layout.windowStart.getTime() +
          t * (layout.windowEnd.getTime() - layout.windowStart.getTime()),
      );
      const tickX = layout.xScale(tickDate);

      // Tick mark
      ctx.strokeStyle = axisColor;
      ctx.beginPath();
      ctx.moveTo(tickX, axisY);
      ctx.lineTo(tickX, axisY + 4);
      ctx.stroke();

      // Label
      ctx.fillText(TICK_FORMAT(tickDate), tickX, axisY - 4);
    }

    if (layout.rowCount === 0) return;

    // Row dividers + content
    ctx.textBaseline = 'middle';

    layout.visibleData.forEach((cve, i) => {
      const rowTop = layout.rowsTop + i * layout.rowHeight;
      const rowCenter = rowTop + layout.rowHeight / 2;
      const showSummary = layout.rowHeight >= 26;
      const primaryY = showSummary ? rowCenter - 6 : rowCenter;
      const summaryY = rowCenter + 7;
      const labelMaxWidth = Math.max(0, layout.leftGutter - 18);
      const idMaxWidth = Math.max(0, layout.leftGutter - 68);

      // Row divider line
      ctx.strokeStyle = COLOR_ROW_DIVIDER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, rowTop + layout.rowHeight);
      ctx.lineTo(size.width, rowTop + layout.rowHeight);
      ctx.stroke();

      // Left gutter: CVE id + summary
      ctx.textAlign = 'left';
      ctx.fillStyle = severityColor(cve.severity);
      ctx.font = "11px 'Geist Mono', ui-monospace, monospace";
      ctx.fillText(fitCanvasText(ctx, cve.cveId, idMaxWidth), 8, primaryY);

      if (showSummary && cve.summary) {
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.font = "10px 'Geist Mono', ui-monospace, monospace";
        ctx.fillText(fitCanvasText(ctx, cve.summary, labelMaxWidth), 8, summaryY);
      }

      // CVSS pip on far left of plot region
      if (cve.cvssV3Score != null) {
        ctx.fillStyle = COLOR_TEXT;
        ctx.textAlign = 'right';
        ctx.font = "10px 'Geist Mono', ui-monospace, monospace";
        ctx.fillText(cve.cvssV3Score.toFixed(1), layout.leftGutter - 6, rowCenter);
      }

      // Gather event markers for this row
      const eventDates: Array<{ date: Date; type: 'published' | 'poc' | 'exploited' | 'patched' }> =
        [];
      const pd = parseDate(cve.publishedAt);
      const pp = parseDate(cve.pocPublicAt);
      const ed = parseDate(cve.exploitedAt);
      const fp = parseDate(cve.firstPatchAt);
      if (pd) eventDates.push({ date: pd, type: 'published' });
      if (pp) eventDates.push({ date: pp, type: 'poc' });
      if (ed) eventDates.push({ date: ed, type: 'exploited' });
      if (fp) eventDates.push({ date: fp, type: 'patched' });

      if (eventDates.length === 0) return;

      // Clamp dates to window
      const clamped = eventDates.map(({ date, type }) => {
        const t = date.getTime();
        const clampedDate =
          t < layout.windowStart.getTime()
            ? layout.windowStart
            : t > layout.windowEnd.getTime()
              ? layout.windowEnd
              : date;
        return { date: clampedDate, type, x: layout.xScale(clampedDate) };
      });

      // Connector line: earliest event → latest event (or NOW if ongoing).
      // For unpatched CVEs, extend the connector to the right edge (today) so
      // the line visually screams "still alive in the wild". The segment
      // between the latest *event* and NOW is the ONGOING gap — drawn dashed.
      if (clamped.length >= 1) {
        const xs = clamped.map((c) => c.x);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const nowX = layout.xScale(layout.windowEnd);
        const isOngoing = cve.isOngoing === true;

        // Base connector: earliest → latest event
        if (maxX > minX) {
          ctx.strokeStyle = COLOR_CONNECTOR;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(minX, rowCenter);
          ctx.lineTo(maxX, rowCenter);
          ctx.stroke();
        }

        // Exposure window: published → exploited (no patch) — red wash to
        // visualize the time the org was at risk with no fix available.
        const pubMark = clamped.find((c) => c.type === 'published');
        const expMark = clamped.find((c) => c.type === 'exploited');
        const patchMark = clamped.find((c) => c.type === 'patched');
        if (pubMark && expMark && expMark.x > pubMark.x) {
          // Exposure ends at patch if there is one, else continues to NOW.
          const endX = patchMark ? patchMark.x : nowX;
          ctx.strokeStyle = COLOR_EXPOSURE_GAP;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(expMark.x, rowCenter);
          ctx.lineTo(endX, rowCenter);
          ctx.stroke();
        }

        // Ongoing tail: dashed line from latest event to NOW for unpatched.
        if (isOngoing && nowX > maxX + 2) {
          ctx.strokeStyle = COLOR_EXPOSURE_GAP;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(maxX, rowCenter);
          ctx.lineTo(nowX, rowCenter);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw markers (on top of connectors so they pop)
      for (const m of clamped) {
        drawMarker(ctx, m.x, rowCenter, m.type, patchedColor);
      }

      // Pulsing NOW marker for ongoing/unpatched — uses the timestamp passed
      // into the effect via dependency, animated by useEffect re-run on
      // animFrame.
      if (cve.isOngoing === true) {
        const nowX = layout.xScale(layout.windowEnd);
        const pulse = 0.5 + 0.5 * Math.sin(animationFrame / 20);
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.5 * pulse;
        ctx.fillStyle = COLOR_EXPOSURE_GAP;
        ctx.beginPath();
        ctx.arc(nowX, rowCenter, 3 + 1.5 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    // Vertical NOW line across the plot area (drawn last so it sits above markers' connectors).
    const nowX = layout.xScale(layout.windowEnd);
    ctx.strokeStyle = nowLineColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(nowX, layout.axisY);
    ctx.lineTo(nowX, size.height - layout.bottomBand);
    ctx.stroke();
    ctx.setLineDash([]);

    // NOW label above the line
    ctx.fillStyle = nowLabelColor;
    ctx.font = "9px 'Geist Mono', ui-monospace, monospace";
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('NOW', nowX - 4, layout.axisY + 5);
  }, [layout, size, response, animationFrame, presentation, accentPalette]);

  // Mouse handlers
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!layout || layout.rowCount === 0) {
        if (hover) setHover(null);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Find closest marker within hit radius
      let bestHit: HoverState | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const m of layout.markerHits) {
        const dx = m.x - x;
        const dy = m.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= MARKER_HIT_RADIUS && dist < bestDist) {
          bestDist = dist;
          bestHit = { cveId: m.cveId, cve: m.cve, clientX: e.clientX, clientY: e.clientY };
        }
      }
      // Fallback: cover the full row hover target.
      if (!bestHit) {
        const row = layout.rowHits.find((r) => y >= r.top && y <= r.bottom);
        if (row && x >= 0) {
          bestHit = {
            cveId: row.cveId,
            cve: row.cve,
            clientX: e.clientX,
            clientY: e.clientY,
          };
        }
      }
      setHover(bestHit);
    },
    [layout, hover],
  );

  const handleMouseLeave = useCallback(() => {
    setHover(null);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!layout || layout.rowCount === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const row = layout.rowHits.find((r) => y >= r.top && y <= r.bottom);
      if (!row) return;
      // Whole-row strip is click target — only require x > 0
      if (x < 0) return;
      const cve = row.cve;
      prefillAgent(`Analyze ${cve.cveId}`, {
        sourcePanel: 'cveTimeline',
        dataType: 'cve',
        trendData: cve as unknown as Record<string, unknown>,
      });
    },
    [layout],
  );

  const isEmpty = response !== null && response.data.length === 0;
  const shownCount = layout?.rowCount ?? 0;
  const trackedCount = response?.count ?? response?.data.length ?? 0;
  const ongoingCount = response?.data.filter((c) => c.isOngoing).length ?? 0;
  const modeLabel = presentation === 'embedded' ? 'PREVIEW' : 'FULL';

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ display: 'block', cursor: hover ? 'pointer' : 'default' }}
      />

      {/* Header label — title + dynamic window subtitle + ongoing counter */}
      <div
        className="absolute top-2 left-3 pointer-events-none flex items-baseline gap-2 overflow-hidden whitespace-nowrap text-[10px] font-mono uppercase tracking-wider"
        style={{ color: 'var(--text-muted, #888)' }}
      >
        <span style={{ color: 'var(--crt-glow, #00ff41)' }}>CVE LIFECYCLE</span>
        <span style={{ color: '#444' }}>·</span>
        <span>{modeLabel}</span>
        {response && trackedCount > 0 && (
          <>
            <span style={{ color: '#444' }}>·</span>
            <span style={{ color: '#aaa' }}>
              {shownCount}/{trackedCount} shown
            </span>
            {ongoingCount > 0 && (
              <>
                <span style={{ color: '#444' }}>·</span>
                <span
                  style={{ color: COLOR_EXPOSURE_GAP.replace('0.35)', '0.95)') }}
                  className="font-bold"
                >
                  {ongoingCount} ONGOING
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* Legend */}
      <div
        className="absolute right-3 bottom-2 left-3 pointer-events-none flex items-center gap-2 overflow-hidden whitespace-nowrap text-[9px] font-mono uppercase tracking-wider"
        style={{
          bottom: presentation === 'fullscreen' ? 58 : 8,
          color: 'var(--text-muted, #888)',
        }}
      >
        <LegendItem
          color={COLOR_PUBLISHED}
          shape="diamond"
          label={presentation === 'embedded' ? 'Pub' : 'Disclosed'}
        />
        <LegendItem color={COLOR_POC} shape="triangle" label="PoC" />
        <LegendItem
          color={COLOR_EXPLOITED}
          shape="square"
          label={presentation === 'embedded' ? 'KEV' : 'Exploited / KEV'}
        />
        <LegendItem
          color="var(--crt-glow, #00ff41)"
          shape="circle"
          label={presentation === 'embedded' ? 'Fix' : 'Patched'}
        />
        <span style={{ color: '#444' }}>·</span>
        <span
          style={{
            color: COLOR_EXPOSURE_GAP.replace('0.35)', '0.95)'),
            borderBottom: `2px solid ${COLOR_EXPOSURE_GAP.replace('0.35)', '0.7)')}`,
            paddingBottom: 1,
          }}
        >
          Exposure window
        </span>
      </div>

      {isEmpty && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-1 text-xs font-mono uppercase tracking-wider"
          style={{ color: 'var(--text-muted, #888)' }}
        >
          <span style={{ color: 'var(--crt-glow, #00ff41)' }}>● AEGIS STANDING BY</span>
          <span className="text-[10px]">
            {loadError ? `Timeline unavailable: ${loadError}` : 'No active critical CVEs in scope'}
          </span>
        </div>
      )}

      {hover && <HoverTooltip hover={hover} />}
    </div>
  );
}

/* ─── Marker drawing helpers ─── */

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: 'published' | 'poc' | 'exploited' | 'patched',
  patchedColor: string,
) {
  const half = MARKER_SIZE / 2;
  ctx.save();
  switch (type) {
    case 'published': {
      // Yellow diamond
      ctx.fillStyle = COLOR_PUBLISHED;
      ctx.beginPath();
      ctx.moveTo(x, y - half);
      ctx.lineTo(x + half, y);
      ctx.lineTo(x, y + half);
      ctx.lineTo(x - half, y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'poc': {
      // Red triangle (pointing up)
      ctx.fillStyle = COLOR_POC;
      ctx.beginPath();
      ctx.moveTo(x, y - half);
      ctx.lineTo(x + half, y + half);
      ctx.lineTo(x - half, y + half);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'exploited': {
      // Red square
      ctx.fillStyle = COLOR_EXPLOITED;
      ctx.fillRect(x - half, y - half, MARKER_SIZE, MARKER_SIZE);
      break;
    }
    case 'patched': {
      // Green circle
      ctx.fillStyle = patchedColor;
      ctx.beginPath();
      ctx.arc(x, y, half, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/* ─── Tooltip ─── */

function HoverTooltip({ hover }: { hover: HoverState }) {
  const { cve, clientX, clientY } = hover;
  if (typeof document === 'undefined') return null;

  // Position below + right of cursor with viewport-edge clamping
  const TOOLTIP_W = 280;
  const left = Math.min(clientX + 12, window.innerWidth - TOOLTIP_W - 8);
  const top = Math.min(clientY + 12, window.innerHeight - 200);

  const flags: string[] = [];
  if (cve.kevAddedDate) flags.push('KEV');
  if (cve.exploitedAt) flags.push('EXPLOITED');
  if (cve.pocPublicAt) flags.push('PoC PUBLIC');
  if (cve.firstPatchAt) flags.push('PATCHED');

  return createPortal(
    <div
      className="fixed pointer-events-none font-mono text-[11px]"
      style={{
        left,
        top,
        width: TOOLTIP_W,
        zIndex: 60,
        padding: '10px 12px',
        background: 'rgba(10, 10, 10, 0.95)',
        border: '1px solid rgba(var(--crt-glow-rgb, 0, 255, 65), 0.4)',
        color: 'var(--text-primary, #e8e8e8)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span style={{ color: severityColor(cve.severity) }} className="font-bold">
          {cve.cveId}
        </span>
        <span className="text-[9px] uppercase tracking-wider" style={{ color: '#888' }}>
          {cve.severity ?? 'unknown'}
        </span>
      </div>
      {cve.cvssV3Score != null && (
        <div className="text-[10px]" style={{ color: '#aaa' }}>
          CVSS v3: <span style={{ color: '#e8e8e8' }}>{cve.cvssV3Score.toFixed(1)}</span>
        </div>
      )}
      {cve.summary && (
        <div className="mt-1.5 text-[10px] leading-snug" style={{ color: '#c8c8c8' }}>
          {truncate(cve.summary, 220)}
        </div>
      )}
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <span
              key={f}
              className="text-[9px] uppercase tracking-wider"
              style={{
                color: f === 'PATCHED' ? 'var(--crt-glow, #00ff41)' : COLOR_POC,
                border: `1px solid ${f === 'PATCHED' ? 'var(--crt-glow, #00ff41)' : COLOR_POC}`,
                padding: '1px 4px',
              }}
            >
              {f}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 text-[9px]" style={{ color: '#666' }}>
        Click row → analyze in agent drawer
      </div>
    </div>,
    document.body,
  );
}

/* ─── Legend item ─── */

function LegendItem({
  color,
  shape,
  label,
}: {
  color: string;
  shape: 'diamond' | 'triangle' | 'square' | 'circle';
  label: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <svg width={10} height={10} aria-hidden="true">
        {shape === 'diamond' && <polygon points="5,1 9,5 5,9 1,5" fill={color} />}
        {shape === 'triangle' && <polygon points="5,1 9,9 1,9" fill={color} />}
        {shape === 'square' && <rect x={1} y={1} width={8} height={8} fill={color} />}
        {shape === 'circle' && <circle cx={5} cy={5} r={4} fill={color} />}
      </svg>
      <span>{label}</span>
    </div>
  );
}
