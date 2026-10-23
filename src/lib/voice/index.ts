/**
 * The voice snippet bank — typed, code-side projections of the SOUL.md voice
 * for NON-LLM template surfaces (the daily-digest takeaway, per-alert email
 * lines, RSS item blurbs). These surfaces can't import a prose system prompt
 * and get a one-liner out, so they draw from the shelves below.
 *
 * `agent/SOUL.md` §Voice Register is canon; `voice.sync.test.ts` asserts
 * every WRY_SHELF line co-exists in SOUL.md and in `register.ts`'s
 * VOICE_REGISTER. See CLAUDE.md Critical Rule #27.
 */

/**
 * Wry codas — each line appears verbatim in SOUL.md §"the wry shelf" AND in
 * VOICE_REGISTER (the sync test enforces this). Wit is aimed at SYSTEMS and
 * INDUSTRY PATTERNS, never at named victims. Keep entries placeholder-free so
 * they can be emitted directly.
 */
export const WRY_SHELF = [
  'It always does.',
  'We are nothing if not consistent.',
  'Predictable in retrospect.',
  'Less surprising than it should be.',
  'Patch and pray.',
  'Tuesday.',
  'The classifier blinked first.',
  'The infosec drinking game continues.',
] as const;

/**
 * Short atmospheric frames for the lead item of a feed. Derived from the
 * VOICE_REGISTER atmospheric shelf (the placeholder forms live there); these
 * are the placeholder-free variants safe to emit as a prefix clause.
 */
export const ATMOSPHERIC_SHELF = [
  'The wire goes hot.',
  'The exposure window is open.',
  'Exploitation is not theoretical.',
] as const;

export type WireTakeawayCounts = {
  cveCount: number;
  kevCount: number;
  breachCount: number;
};

/**
 * Content-aware wry takeaway for the daily digest hero. Lifted verbatim from
 * the prior `DailyDigest.tsx pickWireTakeaway` (now counts-based so it has no
 * React/template dependency). Empty days get no takeaway — quiet observation,
 * not forced. The exact mapping is locked by `index.test.ts`.
 */
export function pickWireTakeaway({
  cveCount,
  kevCount,
  breachCount,
}: WireTakeawayCounts): string | null {
  const total = cveCount + kevCount + breachCount;
  if (total === 0) return null;

  if (total >= 5) return 'We are nothing if not consistent.';
  if (breachCount >= 2) return 'The infosec drinking game continues.';
  if (kevCount >= 2) return 'Patch and pray.';
  if (cveCount >= 3 && kevCount === 0) return 'Predictable in retrospect.';
  if (kevCount > 0 && breachCount > 0) return 'Same playbook, different vendor.';
  if (kevCount === 1 && cveCount <= 1) return 'The catalog wakes up.';
  if (cveCount >= 1) return 'Less surprising than it should be.';
  return null;
}

export type AlertWireTakeInput = {
  kind: 'cve' | 'kev' | 'breach';
  isKev?: boolean;
  exploitedInWild?: boolean;
  knownRansomware?: boolean;
  overdue?: boolean;
  recordsCompromised?: number | null;
};

const LARGE_BREACH_RECORDS = 1_000_000;

/**
 * One deterministic voiced line for a per-alert email, keyed off facts the
 * alert route already loads. NO LLM — this rides the time-sensitive alert
 * path. Returns null when no clear pattern fits so the template renders
 * nothing rather than forcing wit. Priority is first-match-wins; the order
 * is asserted in `index.test.ts`.
 */
export function pickAlertWireTake(input: AlertWireTakeInput): string | null {
  if (input.kind === 'kev' && input.overdue) return 'The deadline came and went.';
  if (input.exploitedInWild) return 'Exploitation is not theoretical.';
  if (input.kind === 'breach' && input.knownRansomware) return 'Same playbook, different vendor.';
  if (input.kind === 'breach' && (input.recordsCompromised ?? 0) >= LARGE_BREACH_RECORDS) {
    return 'The infosec drinking game continues.';
  }
  if (input.kind === 'cve' && input.isKev) return 'The catalog wakes up.';
  return null;
}

export type RssBlurbRow = {
  severity: string | null;
  alertType: string | null;
  summary: string | null;
  headline: string;
};

/**
 * Pick a short atmospheric frame for an RSS lead item from its severity.
 * Deterministic, no LLM. Returns null for lower-severity items so they stay
 * bare.
 */
export function pickRssFrame(row: RssBlurbRow): string | null {
  switch (row.severity?.toLowerCase()) {
    case 'critical':
      return 'The wire goes hot.';
    case 'high':
      return 'The exposure window is open.';
    default:
      return null;
  }
}

/**
 * Voice an RSS item description from the row's own fields — deterministic, no
 * LLM (safe for the 50-item ISR rebuild). The lead item gets an atmospheric
 * frame prefixed onto the factual summary; later items stay closer to the
 * bare summary, per the SOUL.md Cyber Wire calibration (full register on the
 * masthead/lead, briefer classification after).
 */
export function composeRssBlurb(row: RssBlurbRow, opts?: { lead?: boolean }): string {
  const body = row.summary?.trim() || row.headline;
  if (!opts?.lead) return body;
  const frame = pickRssFrame(row);
  return frame ? `${frame} ${body}` : body;
}
