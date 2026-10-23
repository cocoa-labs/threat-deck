'use client';

import { useEffect, useRef } from 'react';
import { useAccentStore } from '@/lib/store/accent-store';

interface MatrixRainBackdropProps {
  active: boolean;
}

interface RainColumn {
  y: number;
  speed: number;
  length: number;
  brightness: number;
}

const GLYPHS = '0101011001011100110010101110001010110011110100';
const FALLBACK_TAIL_RGB = '0, 255, 65';
const FALLBACK_HEAD_RGB = '125, 255, 153';

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? '0';
}

function buildColumns(width: number, height: number, columnWidth: number): RainColumn[] {
  const count = Math.max(1, Math.ceil(width / columnWidth));
  return Array.from({ length: count }, () => ({
    y: -Math.random() * height,
    speed: 0.45 + Math.random() * 1.25,
    length: 10 + Math.floor(Math.random() * 20),
    brightness: 0.45 + Math.random() * 0.55,
  }));
}

export function MatrixRainBackdrop({ active }: MatrixRainBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const accentPalette = useAccentStore((s) => s.accentPalette);

  useEffect(() => {
    void accentPalette;
    const canvasNode = canvasRef.current;
    if (!canvasNode || !active) return;

    const context = canvasNode.getContext('2d');
    if (!context) return;

    const canvas = canvasNode;
    const ctx = context;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let rafId = 0;
    let stopped = false;
    let width = 0;
    let height = 0;
    let columns: RainColumn[] = [];
    let lastTs = 0;
    let tailRgb = FALLBACK_TAIL_RGB;
    let headRgb = FALLBACK_HEAD_RGB;

    const fontSize = 15;
    const columnWidth = 18;

    function readAccentColors() {
      const styles = getComputedStyle(document.documentElement);
      tailRgb = styles.getPropertyValue('--matrix-rain-tail-rgb').trim() || FALLBACK_TAIL_RGB;
      headRgb = styles.getPropertyValue('--matrix-rain-head-rgb').trim() || FALLBACK_HEAD_RGB;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontSize}px var(--font-geist-mono), ui-monospace, monospace`;
      ctx.textBaseline = 'top';
      columns = buildColumns(width, height, columnWidth);
      readAccentColors();
    }

    function clear() {
      ctx.clearRect(0, 0, width, height);
    }

    function drawStatic() {
      clear();
      for (let x = 0; x < width; x += columnWidth * 2) {
        for (let y = 0; y < height; y += fontSize * 2.2) {
          ctx.fillStyle = `rgba(${tailRgb}, 0.08)`;
          ctx.fillText(randomGlyph(), x, y);
        }
      }
    }

    function draw(ts: number) {
      if (stopped) return;
      if (reducedMotion.matches) {
        drawStatic();
        return;
      }

      const delta = lastTs === 0 ? 16 : Math.min(48, ts - lastTs);
      lastTs = ts;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.13)';
      ctx.fillRect(0, 0, width, height);

      columns.forEach((column, index) => {
        const x = index * columnWidth;
        for (let i = 0; i < column.length; i += 1) {
          const y = column.y - i * fontSize;
          if (y < -fontSize || y > height + fontSize) continue;

          const tailOpacity = Math.max(0.03, (0.28 - i * 0.012) * column.brightness);
          ctx.fillStyle = i === 0 ? `rgba(${headRgb}, 0.72)` : `rgba(${tailRgb}, ${tailOpacity})`;
          ctx.fillText(randomGlyph(), x, y);
        }

        column.y += column.speed * delta * 0.075;
        if (column.y - column.length * fontSize > height + fontSize * 3) {
          column.y = -Math.random() * height * 0.35;
          column.speed = 0.45 + Math.random() * 1.25;
          column.length = 10 + Math.floor(Math.random() * 20);
          column.brightness = 0.45 + Math.random() * 0.55;
        }
      });

      rafId = requestAnimationFrame(draw);
    }

    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion.matches) drawStatic();
    });
    observer.observe(canvas);
    resize();
    rafId = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      observer.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      clear();
    };
  }, [active, accentPalette]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      aria-hidden
      style={{
        opacity: 0.42,
        mixBlendMode: 'screen',
      }}
    />
  );
}
