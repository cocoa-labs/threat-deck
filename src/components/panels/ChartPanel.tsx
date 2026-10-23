'use client';

import { useTheme } from 'next-themes';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { cn } from '@/lib/utils/cn';

/* ─── Types ─── */

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface ChartAPIResponse {
  symbol: string;
  bars: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  source: string;
  timeframe: string;
  interval: string;
  error?: string;
}

/* ─── Symbols ─── */

const SYMBOLS = ['SPY', 'QQQ', 'NVDA', 'BTC', 'ETH', 'GLD'] as const;
type Symbol = (typeof SYMBOLS)[number];

/* ─── Retry config ─── */

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

/* ─── ChartPanel ─── */

export function ChartPanel() {
  const [selectedSymbol, setSelectedSymbol] = useState<Symbol>('SPY');
  const [chartData, setChartData] = useState<CandleData[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts').createChart> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const { resolvedTheme } = useTheme();

  // Fetch OHLCV data when symbol changes, with retry on empty results (rate limit)
  useEffect(() => {
    let cancelled = false;

    async function fetchWithRetry(attempt: number) {
      if (attempt === 0) {
        setIsLoading(true);
        setError(null);
      }

      try {
        const res = await fetch(
          `/api/data/chart?symbol=${encodeURIComponent(selectedSymbol)}&timeframe=3M&interval=1day`,
        );

        if (cancelled) return;

        if (!res.ok) {
          setError(`Failed to load chart data (${res.status})`);
          setChartData(null);
          setIsLoading(false);
          return;
        }

        const data: ChartAPIResponse = await res.json();

        if (cancelled) return;

        if (data.error) {
          setError(data.error);
          setChartData(null);
          setIsLoading(false);
          return;
        }

        // Filter out invalid bars: zero values or outlier wick data
        // (Massive API occasionally returns misplaced decimals, e.g. low=69.005 instead of 690.05)
        const bars = data.bars ?? [];
        const candles: CandleData[] = bars
          .filter((b) => {
            if (b.open <= 0 || b.high <= 0 || b.low <= 0 || b.close <= 0) return false;
            const mid = (b.open + b.close) / 2;
            if (b.low < mid * 0.5 || b.high > mid * 2) return false;
            return true;
          })
          .map((b) => ({
            time: b.time,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          }));

        if (candles.length === 0 && attempt < MAX_RETRIES) {
          // Empty bars likely from rate limiting — retry after delay
          setTimeout(() => {
            if (!cancelled) fetchWithRetry(attempt + 1);
          }, RETRY_DELAY_MS);
          return;
        }

        if (candles.length === 0) {
          setError('No chart data available');
          setChartData(null);
        } else {
          setChartData(candles);
        }
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          if (attempt < MAX_RETRIES) {
            setTimeout(() => {
              if (!cancelled) fetchWithRetry(attempt + 1);
            }, RETRY_DELAY_MS);
            return;
          }
          setError('Network error loading chart');
          setChartData(null);
          setIsLoading(false);
        }
      }
    }

    fetchWithRetry(0);
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  const initChart = useCallback(async () => {
    const container = chartContainerRef.current;
    if (!container || !chartData || chartData.length === 0) return;

    // Defer to next frame so the browser has laid out the container
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    // Re-check after frame — component may have unmounted
    if (!chartContainerRef.current) return;

    // Dynamic import for SSR safety
    const { createChart, CandlestickSeries } = await import('lightweight-charts');

    // Dispose previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    // Read computed CSS variables for theme-aware colors
    const styles = getComputedStyle(document.documentElement);
    const textSecondary = styles.getPropertyValue('--text-secondary').trim() || '#888888';
    const borderSubtle = styles.getPropertyValue('--border-subtle').trim() || '#1e1e1e';
    const borderFocus = styles.getPropertyValue('--border-focus').trim() || '#444444';
    const bgElevated = styles.getPropertyValue('--bg-elevated').trim() || '#1a1a1a';
    const colorPositive = styles.getPropertyValue('--color-positive').trim() || '#44ff88';
    const colorNegative = styles.getPropertyValue('--color-negative').trim() || '#ff4444';

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: 'transparent' },
        textColor: textSecondary,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: borderSubtle },
        horzLines: { color: borderSubtle },
      },
      crosshair: {
        vertLine: { color: borderFocus, labelBackgroundColor: bgElevated },
        horzLine: { color: borderFocus, labelBackgroundColor: bgElevated },
      },
      rightPriceScale: {
        borderColor: borderSubtle,
        autoScale: true,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: borderSubtle,
        timeVisible: false,
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: colorPositive,
      downColor: colorNegative,
      borderUpColor: colorPositive,
      borderDownColor: colorNegative,
      wickUpColor: colorPositive,
      wickDownColor: colorNegative,
    });

    candlestickSeries.setData(chartData);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    // Resize observer
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && chartRef.current) {
        const { width, height } = entry.contentRect;
        chartRef.current.applyOptions({ width, height });
      }
    });

    observer.observe(container);
    resizeObserverRef.current = observer;
  }, [chartData]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resolvedTheme triggers chart re-init with new CSS variable values
  useEffect(() => {
    initChart();

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [initChart, resolvedTheme]);

  return (
    <PanelShell id="chart" title="CHART" span={2}>
      {/* Symbol selector */}
      <div className="flex items-center gap-1 pb-2">
        {SYMBOLS.map((sym) => (
          <button
            type="button"
            key={sym}
            onClick={() => setSelectedSymbol(sym)}
            className={cn(
              'rounded px-2 py-0.5 text-[9px] font-mono font-semibold uppercase tracking-wider transition-colors',
              sym === selectedSymbol
                ? 'bg-[var(--crt-glow)]/15 text-[var(--crt-glow)] border border-[var(--crt-glow)]/40'
                : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
            )}
          >
            {sym}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div
          className="flex items-center justify-center font-mono text-[10px] text-[var(--text-dim)]"
          style={{ height: 280 }}
        >
          <span className="animate-pulse">LOADING {selectedSymbol} DATA...</span>
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <div
          className="flex items-center justify-center font-mono text-[10px] text-[var(--color-negative)]"
          style={{ height: 280 }}
        >
          {error}
        </div>
      )}

      {/* Chart container — always in the DOM so the ref is stable */}
      <div
        ref={chartContainerRef}
        className="relative w-full"
        style={{
          height: 280,
          display: !isLoading && !error && chartData && chartData.length > 0 ? 'block' : 'none',
        }}
      />
    </PanelShell>
  );
}
