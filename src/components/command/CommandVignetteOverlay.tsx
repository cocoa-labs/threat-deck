'use client';

/**
 * Edge vignette + pulsing cyan glow border.
 * Pure CSS, pointer-events-none.
 */
export function CommandVignetteOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 6,
        background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.6) 100%)',
        boxShadow: 'inset 0 0 80px rgba(0, 255, 170, 0.06)',
        animation: 'command-glow-pulse 4s ease-in-out infinite',
      }}
    />
  );
}
