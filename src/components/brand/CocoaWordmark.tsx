import { CocoaSigil } from './CocoaSigil';

/**
 * CocoaWordmark — shared brand lockup used in the dashboard header AND the
 * /login masthead. Composes:
 *
 *   [sigil]  Cocoa AI   // THREAT DECK
 *            ^italic     ^mono caps, dim
 *            (Instrument Serif italic — the brand note)
 *
 * The sigil + the Instrument Serif "Cocoa AI" carry the neon brand accent.
 * Everything else stays tactical/cold.
 *
 * Props let callers tune scale (compact in the dashboard header, larger in
 * the login masthead) without restyling the lockup proportions.
 */
export function CocoaWordmark({
  sigilSize = 18,
  wordmarkSize = 16,
  systemTagSize = 10,
  systemTag = '// Threat Deck',
  gap = 8,
}: {
  /** Sigil height in px. Wordmark scales next to it. */
  sigilSize?: number;
  /** "Cocoa AI" italic font size in px. */
  wordmarkSize?: number;
  /** System tag mono caps font size in px. Set to 0 to hide the tag. */
  systemTagSize?: number;
  /** Override the system tag string (e.g. "// Max" in the drawer). */
  systemTag?: string;
  /** Horizontal spacing between sigil and wordmark, in px. */
  gap?: number;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: `${gap}px`,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ alignSelf: 'center', display: 'inline-flex' }}>
        <CocoaSigil size={sigilSize} />
      </span>
      <span
        style={{
          fontFamily: 'var(--font-instrument-serif), "Times New Roman", serif',
          fontStyle: 'italic',
          fontSize: `${wordmarkSize}px`,
          letterSpacing: '0.005em',
          color: 'var(--brand-accent-readable, var(--brand-accent, #00ff41))',
        }}
      >
        Cocoa AI
      </span>
      {systemTagSize > 0 ? (
        <span
          style={{
            fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
            fontSize: `${systemTagSize}px`,
            letterSpacing: '0.18em',
            color: 'rgba(255,255,255,0.42)',
            textTransform: 'uppercase',
          }}
        >
          {systemTag}
        </span>
      ) : null}
    </span>
  );
}
