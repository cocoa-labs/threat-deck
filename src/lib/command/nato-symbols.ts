import type { IntelligenceCategory } from '@/lib/types';
import { categoryToHex } from '@/lib/utils/geo';

/**
 * NATO APP-6 style military symbol shapes:
 * - Diamond: hostile/threat categories (conflict, proliferation, strategic)
 * - Rectangle: friendly/neutral categories (economic, technology, policy)
 * - Circle: unknown/pending categories (market, alternative)
 * - Inverted triangle: irregular/civil (instability)
 */

type ShapeType = 'diamond' | 'rectangle' | 'circle' | 'triangle';

interface NatoSymbolConfig {
  shape: ShapeType;
  glyph: string;
}

const SYMBOL_CONFIG: Record<IntelligenceCategory, NatoSymbolConfig> = {
  conflict: { shape: 'diamond', glyph: 'X' },
  economic: { shape: 'rectangle', glyph: '$' },
  technology: { shape: 'rectangle', glyph: '///' },
  policy: { shape: 'rectangle', glyph: 'HQ' },
  proliferation: { shape: 'diamond', glyph: 'N' },
  instability: { shape: 'triangle', glyph: '!' },
  strategic: { shape: 'diamond', glyph: '*' },
  market: { shape: 'circle', glyph: 'M' },
  alternative: { shape: 'circle', glyph: '?' },
  // Cyber categories — diamonds (threats), triangles (irregular/AI), rectangles (neutral)
  cve_critical: { shape: 'diamond', glyph: 'CVE' },
  cve_high: { shape: 'diamond', glyph: 'CVE' },
  cve_medium: { shape: 'diamond', glyph: 'CVE' },
  ai_incident: { shape: 'triangle', glyph: 'AI' },
  data_breach: { shape: 'diamond', glyph: 'B' },
  ransomware: { shape: 'diamond', glyph: 'R' },
  apt_activity: { shape: 'diamond', glyph: 'APT' },
  zero_day: { shape: 'diamond', glyph: '0d' },
  ai_safety: { shape: 'triangle', glyph: 'AIS' },
  model_release: { shape: 'rectangle', glyph: 'ML' },
};

const SIZE = 40;
const HALF = SIZE / 2;
const STROKE_WIDTH = 2;
const PADDING = 4;

function drawShape(ctx: CanvasRenderingContext2D, shape: ShapeType, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = STROKE_WIDTH;
  ctx.lineJoin = 'miter';

  const inner = HALF - PADDING;

  ctx.beginPath();
  switch (shape) {
    case 'diamond':
      ctx.moveTo(HALF, PADDING);
      ctx.lineTo(SIZE - PADDING, HALF);
      ctx.lineTo(HALF, SIZE - PADDING);
      ctx.lineTo(PADDING, HALF);
      ctx.closePath();
      break;

    case 'rectangle':
      ctx.rect(PADDING, PADDING + 4, inner * 2, inner * 2 - 8);
      break;

    case 'circle':
      ctx.arc(HALF, HALF, inner - 2, 0, Math.PI * 2);
      break;

    case 'triangle':
      ctx.moveTo(PADDING, PADDING + 4);
      ctx.lineTo(SIZE - PADDING, PADDING + 4);
      ctx.lineTo(HALF, SIZE - PADDING);
      ctx.closePath();
      break;
  }

  // Semi-transparent fill
  ctx.fillStyle = `${color}22`;
  ctx.fill();
  ctx.stroke();
}

function drawGlyph(ctx: CanvasRenderingContext2D, glyph: string, color: string, shape: ShapeType) {
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const fontSize = glyph.length > 2 ? 9 : glyph.length > 1 ? 11 : 14;
  ctx.font = `bold ${fontSize}px "Geist Mono", "SF Mono", monospace`;

  // Adjust vertical center for triangle (push glyph up slightly)
  const yOffset = shape === 'triangle' ? -2 : 0;
  ctx.fillText(glyph, HALF, HALF + yOffset);
}

/**
 * Generate all 9 NATO-style category symbol images as ImageData for Mapbox.
 * Returns a map of `nato-{category}` → ImageData.
 */
export function generateNatoSymbols(): Record<
  string,
  { width: number; height: number; data: Uint8ClampedArray }
> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  const result: Record<string, { width: number; height: number; data: Uint8ClampedArray }> = {};

  const categories = Object.keys(SYMBOL_CONFIG) as IntelligenceCategory[];

  for (const category of categories) {
    const config = SYMBOL_CONFIG[category];
    const color = categoryToHex(category);

    // Clear canvas
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Draw shape outline + fill
    drawShape(ctx, config.shape, color);

    // Draw glyph
    drawGlyph(ctx, config.glyph, color, config.shape);

    // Extract image data
    const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
    result[`nato-${category}`] = {
      width: SIZE,
      height: SIZE,
      data: new Uint8ClampedArray(imageData.data),
    };
  }

  return result;
}
