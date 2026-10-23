'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AccentPalette = 'green' | 'red' | 'blue' | 'yellow' | 'gray' | 'black';

export interface AccentThemeTokens {
  label: string;
  accent: string;
  accentRgb: string;
  deep: string;
  pale: string;
  paleRgb: string;
  readable: string;
  readableRgb: string;
  rainTailRgb: string;
  rainHeadRgb: string;
}

export const ACCENT_PALETTE_ORDER: AccentPalette[] = [
  'green',
  'red',
  'blue',
  'yellow',
  'gray',
  'black',
];

export const ACCENT_THEMES: Record<AccentPalette, AccentThemeTokens> = {
  green: {
    label: 'Matrix Green',
    accent: '#00ff41',
    accentRgb: '0, 255, 65',
    deep: '#00a82d',
    pale: '#7dff99',
    paleRgb: '125, 255, 153',
    readable: '#00ff41',
    readableRgb: '0, 255, 65',
    rainTailRgb: '0, 255, 65',
    rainHeadRgb: '125, 255, 153',
  },
  red: {
    label: 'Neon Red',
    accent: '#ff1744',
    accentRgb: '255, 23, 68',
    deep: '#b00024',
    pale: '#ff7a90',
    paleRgb: '255, 122, 144',
    readable: '#ff1744',
    readableRgb: '255, 23, 68',
    rainTailRgb: '255, 23, 68',
    rainHeadRgb: '255, 122, 144',
  },
  blue: {
    label: 'Neon Blue',
    accent: '#00b7ff',
    accentRgb: '0, 183, 255',
    deep: '#0077aa',
    pale: '#7ddcff',
    paleRgb: '125, 220, 255',
    readable: '#00b7ff',
    readableRgb: '0, 183, 255',
    rainTailRgb: '0, 183, 255',
    rainHeadRgb: '125, 220, 255',
  },
  yellow: {
    label: 'Neon Yellow',
    accent: '#ffea00',
    accentRgb: '255, 234, 0',
    deep: '#b8a800',
    pale: '#fff27a',
    paleRgb: '255, 242, 122',
    readable: '#ffea00',
    readableRgb: '255, 234, 0',
    rainTailRgb: '255, 234, 0',
    rainHeadRgb: '255, 242, 122',
  },
  gray: {
    label: 'Graphite Gray',
    accent: '#8a8a8a',
    accentRgb: '138, 138, 138',
    deep: '#5f5f5f',
    pale: '#f4f4f5',
    paleRgb: '244, 244, 245',
    readable: '#c8c8c8',
    readableRgb: '200, 200, 200',
    rainTailRgb: '96, 96, 98',
    rainHeadRgb: '220, 220, 220',
  },
  black: {
    label: 'True Black',
    accent: '#000000',
    accentRgb: '0, 0, 0',
    deep: '#000000',
    pale: '#111111',
    paleRgb: '17, 17, 17',
    readable: '#000000',
    readableRgb: '0, 0, 0',
    rainTailRgb: '0, 0, 0',
    rainHeadRgb: '0, 0, 0',
  },
};

function isAccentPalette(value: unknown): value is AccentPalette {
  return typeof value === 'string' && Object.hasOwn(ACCENT_THEMES, value);
}

interface AccentState {
  accentPalette: AccentPalette;
  setAccentPalette: (palette: AccentPalette) => void;
  cycleAccentPalette: () => void;
}

export const useAccentStore = create<AccentState>()(
  persist(
    (set, get) => ({
      accentPalette: 'green',
      setAccentPalette: (palette) => set({ accentPalette: palette }),
      cycleAccentPalette: () => {
        const current = get().accentPalette;
        const currentIndex = ACCENT_PALETTE_ORDER.indexOf(current);
        const nextIndex = (currentIndex + 1) % ACCENT_PALETTE_ORDER.length;
        set({ accentPalette: ACCENT_PALETTE_ORDER[nextIndex] ?? 'green' });
      },
    }),
    {
      name: 'threatdeck-accent',
      version: 2,
      partialize: (state) => ({ accentPalette: state.accentPalette }),
      migrate: (persisted, version) => {
        if (typeof persisted !== 'object' || persisted === null) {
          return persisted;
        }

        const stored = persisted as { accentPalette?: unknown };
        if ((version ?? 0) < 2 && stored.accentPalette === 'black') {
          return { ...stored, accentPalette: 'gray' };
        }

        return persisted;
      },
      merge: (persisted, current) => {
        if (typeof persisted !== 'object' || persisted === null) {
          return current;
        }

        const stored = persisted as { accentPalette?: unknown };
        return {
          ...current,
          accentPalette: isAccentPalette(stored.accentPalette)
            ? stored.accentPalette
            : current.accentPalette,
        };
      },
    },
  ),
);
