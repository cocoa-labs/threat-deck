'use client';

import { useEffect } from 'react';
import { ACCENT_THEMES, useAccentStore } from '@/lib/store/accent-store';

const THEMED_VARIABLES = [
  '--brand-accent',
  '--brand-accent-rgb',
  '--brand-accent-deep',
  '--brand-accent-pale',
  '--brand-accent-pale-rgb',
  '--brand-accent-readable',
  '--brand-accent-readable-rgb',
  '--crt-glow',
  '--crt-glow-rgb',
  '--color-info',
  '--color-cyber',
  '--matrix-green',
  '--matrix-green-rgb',
  '--matrix-green-dim',
  '--matrix-rain-tail-rgb',
  '--matrix-rain-head-rgb',
  '--shadow-glow-info',
] as const;

function applyAccentTheme(theme: (typeof ACCENT_THEMES)[keyof typeof ACCENT_THEMES]) {
  const root = document.documentElement;
  const glowColor = theme.readable;
  const glowRgb = theme.readableRgb;

  root.style.setProperty('--brand-accent', theme.accent);
  root.style.setProperty('--brand-accent-rgb', theme.accentRgb);
  root.style.setProperty('--brand-accent-deep', theme.deep);
  root.style.setProperty('--brand-accent-pale', theme.pale);
  root.style.setProperty('--brand-accent-pale-rgb', theme.paleRgb);
  root.style.setProperty('--brand-accent-readable', theme.readable);
  root.style.setProperty('--brand-accent-readable-rgb', theme.readableRgb);
  root.style.setProperty('--crt-glow', glowColor);
  root.style.setProperty('--crt-glow-rgb', glowRgb);
  root.style.setProperty('--color-info', glowColor);
  root.style.setProperty('--color-cyber', glowColor);
  root.style.setProperty('--matrix-green', glowColor);
  root.style.setProperty('--matrix-green-rgb', glowRgb);
  root.style.setProperty('--matrix-green-dim', theme.deep);
  root.style.setProperty('--matrix-rain-tail-rgb', theme.rainTailRgb);
  root.style.setProperty('--matrix-rain-head-rgb', theme.rainHeadRgb);
  root.style.setProperty('--shadow-glow-info', `0 0 12px rgba(${glowRgb}, 0.3)`);
}

export function AccentThemeProvider({ children }: { children: React.ReactNode }) {
  const accentPalette = useAccentStore((state) => state.accentPalette);

  useEffect(() => {
    const theme = ACCENT_THEMES[accentPalette] ?? ACCENT_THEMES.green;
    document.documentElement.dataset.accentPalette = accentPalette;
    applyAccentTheme(theme);

    return () => {
      for (const variable of THEMED_VARIABLES) {
        document.documentElement.style.removeProperty(variable);
      }
      delete document.documentElement.dataset.accentPalette;
    };
  }, [accentPalette]);

  return children;
}
