/**
 * Font loader for @vercel/og (Satori).
 *
 * Satori requires fonts as ArrayBuffer at render time. To avoid per-render
 * disk I/O, we cache fonts in module-level state on first use.
 *
 * Fonts live in public/fonts/ (committed TTFs) — see public/fonts/ dir.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FONTS_DIR = join(process.cwd(), 'public', 'fonts');

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type FontStyle = 'normal' | 'italic';

export interface FontDescriptor {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: FontStyle;
}

let cachedFonts: FontDescriptor[] | null = null;

export function loadFonts(): FontDescriptor[] {
  if (cachedFonts) return cachedFonts;

  cachedFonts = [
    {
      name: 'VT323',
      data: toArrayBuffer(readFileSync(join(FONTS_DIR, 'VT323-Regular.ttf'))),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'GeistMono',
      data: toArrayBuffer(readFileSync(join(FONTS_DIR, 'GeistMono-Regular.ttf'))),
      weight: 400,
      style: 'normal',
    },
    {
      name: 'InstrumentSerif',
      data: toArrayBuffer(readFileSync(join(FONTS_DIR, 'InstrumentSerif-Italic.ttf'))),
      weight: 400,
      style: 'italic',
    },
  ];

  return cachedFonts;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
