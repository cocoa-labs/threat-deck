// 280 is a LEGACY display heuristic — the "standard visible" width X still
// uses for feed previews. It is NOT a posting limit: X supports long-form, and
// composition/validation gate on X_LONGFORM_MAX_LENGTH (25,000), not these.
export const TWITTER_MAX_LENGTH = 280;
export const TWITTER_URL_BUDGET = 23;
export const X_STANDARD_VISIBLE_CHARS = 280;
export const X_LONGFORM_MAX_LENGTH = 25_000;

const URL_RE = /https?:\/\/\S+/g;

/**
 * Compute the effective character length the way X/Twitter does it: every
 * http(s) URL collapses to a fixed budget, regardless of raw URL length.
 */
export function effectiveTweetLength(text: string): number {
  let urlCount = 0;
  let urlChars = 0;
  text.replace(URL_RE, (match) => {
    urlCount += 1;
    urlChars += match.length;
    return match;
  });
  return text.length - urlChars + urlCount * TWITTER_URL_BUDGET;
}
