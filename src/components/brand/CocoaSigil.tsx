/**
 * CocoaSigil — 18×18 Cocoa AI brand mark.
 *
 * A thick neon "C" letterform with a brighter pixel core. Two colors only,
 * reads cleanly at sigil size, distinctive without copying the cocoa-labs
 * invader mascot.
 *
 * Used by /login masthead and the shared CocoaWordmark component.
 */
export function CocoaSigil({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Cocoa AI"
    >
      {/* C: thick semicircle, neon brand accent */}
      <path
        d="M14.5 3.5 A6.5 6.5 0 1 0 14.5 14.5"
        fill="none"
        stroke="var(--brand-accent-readable, var(--brand-accent, #00ff41))"
        strokeWidth="2.5"
        strokeLinecap="square"
      />
      {/* The AI core: 2×2 bright pixel inside the C's mouth */}
      <rect x="8" y="8" width="2" height="2" fill="var(--brand-accent-pale, #7dff99)" />
    </svg>
  );
}
