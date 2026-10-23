import type { ReactNode } from 'react';

const MONETARY_REGEX = /(\$[\d,]+(?:\.\d+)?[MBKmk]?)/g;

/**
 * Splits text on monetary patterns ($X.XM, $X.XB, $X,XXX) and wraps
 * matches in a highlighted span.
 */
export function highlightMonetary(text: string): ReactNode {
  const parts = text.split(MONETARY_REGEX);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (MONETARY_REGEX.test(part)) {
      // Reset lastIndex since we use the global regex for both split and test
      MONETARY_REGEX.lastIndex = 0;
      return (
        <span key={i} className="text-[var(--badge-cyan)] font-semibold">
          {part}
        </span>
      );
    }
    MONETARY_REGEX.lastIndex = 0;
    return part;
  });
}
