'use client';

/**
 * CRT scanline overlay - pure CSS, zero JS overhead.
 * Creates subtle horizontal scanlines across the entire command view.
 */
export function CommandCRTOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 5,
        background:
          'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0, 255, 170, 0.03) 3px, rgba(0, 255, 170, 0.03) 4px)',
        mixBlendMode: 'screen',
      }}
    />
  );
}
