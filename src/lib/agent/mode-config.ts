/**
 * Three-mode posture configuration — types, per-mode tool budgets, keyword
 * sniffs, lock-addendum prompts, and the effective-mode resolver.
 *
 * The agent runs in three modes (see [agent/SOUL.md](agent/SOUL.md) §Three-Mode
 * Posture for the full spec):
 *   - **anchor** — BLUF + brief context, default for routine queries.
 *   - **analyst** — full SITREP with headers, multiple AEGIS calls.
 *   - **fix-architect** — numbered remediation playbook with concrete artifacts.
 *
 * When the user clicks a pill in AgentDrawer, `lockedMode` is set in the
 * agent store. The server resolves effective mode via {@link computeEffectiveMode},
 * which honors the lock as a *floor* (sticky-with-auto-escalation): locked
 * Anchor can be lifted to Analyst by critical+KEV / Mode 2 keywords / panel
 * clicks, or to Fix Architect by Mode 3 keywords. Locked Analyst and Fix
 * Architect never down-grade.
 *
 * The Twitter generators have their own per-mode SYSTEM constants in
 * `src/lib/twitter/content/prompts.ts` — those bake in 280-char tweet
 * constraints and a strict JSON output schema, so they're intentionally
 * NOT reused here. The lock addenda below are tuned for the in-app drawer.
 */

export type AgentMode = 'anchor' | 'analyst' | 'fix-architect';

export const AGENT_MODES: readonly AgentMode[] = ['anchor', 'analyst', 'fix-architect'] as const;

/**
 * Per-mode tool-turn budget. The global `AGENT_MAX_TOOL_TURNS` (10) remains
 * a backstop; when a mode is locked the caller clamps with
 * `Math.min(AGENT_MAX_TOOL_TURNS, MODE_TOOL_BUDGET[effectiveMode])`.
 */
export const MODE_TOOL_BUDGET: Record<AgentMode, number> = {
  anchor: 2,
  analyst: 6,
  'fix-architect': 8,
};

/**
 * Posture hierarchy used by escalation-direction logic. Higher level = deeper
 * mode. `isEscalation(locked, detected)` requires `detected > locked` so
 * down-grades never render as upward (↑) escalation cues.
 */
export const MODE_LEVEL: Record<AgentMode, number> = {
  anchor: 0,
  analyst: 1,
  'fix-architect': 2,
};

/**
 * Returns true when `detectedMode` represents an UPWARD escalation above the
 * locked floor (locked is non-null AND detected level > locked level).
 * Returns false when unlocked, when equal, or when detected is BELOW the lock
 * (which would be a stale / cross-stream-polluted value, not an escalation).
 */
export function isEscalation(lockedMode: AgentMode | null, detectedMode: AgentMode): boolean {
  if (lockedMode === null) return false;
  return MODE_LEVEL[detectedMode] > MODE_LEVEL[lockedMode];
}

/**
 * Validate an untrusted value (typically from a JSON request body or
 * localStorage migration) into an `AgentMode | null`. Anything not exactly
 * one of the three valid wire-format strings is coerced to `null` so that
 * downstream lookups (e.g. `MODE_TOOL_BUDGET[invalid]` → `undefined` →
 * `Math.min(10, undefined) === NaN` → infinite-loop guard failure) cannot
 * fire with corrupted input.
 */
export function parseLockedMode(raw: unknown): AgentMode | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return null;
  return (AGENT_MODES as readonly string[]).includes(raw) ? (raw as AgentMode) : null;
}

// Mode 2 (Analyst) promotion triggers. Mirrors agent/SOUL.md lines 169-184.
// Word-boundary regex with case-insensitive flag.
const MODE_2_PATTERNS: RegExp[] = [
  /\bdeep dives?\b/i,
  /\bgo deeper\b/i,
  /\btell me everything\b/i,
  /\binvestigat\w*\b/i, // investigate, investigating, investigation
  /\bTTPs?\b/i,
  /\bIOCs?\b/i,
];

// Mode 3 (Fix Architect) promotion triggers.
const MODE_3_PATTERNS: RegExp[] = [
  /\bpatch\w*\b/i, // patch, patches, patching, patched
  /\bfix\b/i, // exact word — avoids "fixative", "fixated"
  /\bmitigations?\b/i,
  /\bworkarounds?\b/i,
  /\bSigma\b/i,
  /\bYARA\b/i,
  /\bD3FEND\b/i,
  /\bwhat do I do\b/i,
];

function matchesAny(message: string, patterns: RegExp[]): boolean {
  if (!message) return false;
  return patterns.some((p) => p.test(message));
}

export interface ComputeEffectiveModeInput {
  /** The user's chosen lock, or `null` for AUTO (no override). */
  lockedMode: AgentMode | null;
  /** The user's message — sniffed for Mode 2 / Mode 3 keywords. */
  userMessage: string;
  /** True when the message arrived via a panel-click prefill. Promotes Anchor → Analyst. */
  panelContext?: boolean;
  /** For autonomous-activation invocations. Combined with `signalIsKev` it can promote Anchor → Analyst. */
  signalSeverity?: 'critical' | 'high' | 'medium' | 'low';
  signalIsKev?: boolean;
}

/**
 * Resolve the mode the agent should run in for this turn.
 *
 * Returns `null` when no lock is in effect — the caller defers to the
 * auto-promotion rules already baked into the system prompt.
 *
 * When a lock is in effect, returns the lock floor — or a higher mode if
 * the turn's escalation criteria are met. The lock is restored on the
 * next turn; escalation never persists across turns.
 *
 * **Priority order:** Mode 3 keywords (highest) → Mode 2 triggers → lock floor.
 */
export function computeEffectiveMode(input: ComputeEffectiveModeInput): AgentMode | null {
  const { lockedMode, userMessage, panelContext, signalSeverity, signalIsKev } = input;

  if (lockedMode === null) return null;

  // Mode 3 keywords always escalate (or hold at) fix-architect for this turn.
  // Mode 3 takes priority over Mode 2 because remediation intent ("patch this")
  // is a more specific signal than analysis intent ("deep dive").
  if (matchesAny(userMessage, MODE_3_PATTERNS)) return 'fix-architect';

  // Mode 2 escalation triggers. Only relevant when locked at anchor —
  // we never down-grade fix-architect to analyst.
  const wantsMode2 =
    matchesAny(userMessage, MODE_2_PATTERNS) ||
    panelContext === true ||
    (signalSeverity === 'critical' && signalIsKev === true);

  if (lockedMode === 'anchor' && wantsMode2) return 'analyst';

  return lockedMode;
}

/**
 * Marker regex — shared between {@link extractModeMarker} (anchored to text
 * start) and {@link stripAllModeMarkers} (any position). Tolerant of common
 * LLM formatting drift:
 *   - Case-insensitive on both `MODE` and the mode name
 *   - Spaces around `MODE` and the `:` colon
 *   - Optional spaces inside the closing `]]`
 *
 * Trailing whitespace consumption is INTENTIONALLY narrow — only one
 * optional CRLF/LF. Greedy `\s*` would eat blank lines and indentation that
 * open the response body, destroying Markdown structure (fenced code blocks,
 * indented lists).
 */
const MODE_MARKER_BODY = /\[\[\s*MODE\s*:\s*(anchor|analyst|fix-architect)\s*\]\]/i;
const MODE_MARKER_ANCHORED = new RegExp(`^[ \\t]*${MODE_MARKER_BODY.source}[ \\t]*\\r?\\n?`, 'i');
const MODE_MARKER_GLOBAL = new RegExp(MODE_MARKER_BODY.source, 'gi');

/**
 * Parse a `[[MODE:anchor|analyst|fix-architect]]` marker from the START of
 * a streamed response, returning the parsed mode and the text with the
 * marker (plus at most one trailing newline) stripped. The model is
 * instructed to emit this marker as the literal first line of every response.
 *
 * Tolerance: case-insensitive; allows whitespace around the colon, inside
 * the brackets, and one optional CRLF/LF after the marker.
 *
 * Returns `{ mode: null, stripped: text }` (input unchanged) when the
 * marker is missing, malformed, or carries an unknown mode value.
 *
 * Only the FIRST occurrence at the head of the text is recognized; later
 * `[[MODE:...]]` strings in the body should be cleaned up via
 * {@link stripAllModeMarkers} on the final accumulated text.
 */
export function extractModeMarker(text: string): {
  mode: AgentMode | null;
  stripped: string;
} {
  const match = text.match(MODE_MARKER_ANCHORED);
  if (!match) return { mode: null, stripped: text };
  return {
    mode: match[1]?.toLowerCase() as AgentMode,
    stripped: text.slice(match[0].length),
  };
}

/**
 * Belt-and-braces cleaner: remove ALL `[[MODE:*]]` markers anywhere in the
 * text. Use on a fully-accumulated response (post-stream, on the server
 * before persistence, on autonomous-activation results) to guarantee no
 * marker leaks into the persisted message, brief, email digest, Twitter
 * post, citation validator input, or `conversation_exchanges` DB row.
 *
 * The model is supposed to emit the marker only as the first line, but a
 * multi-turn agentic loop can interleave tool-result narration before the
 * mode-declaring text chunk, causing the marker to land mid-body. This
 * helper guards every output boundary against that drift.
 *
 * Adjacent whitespace is collapsed so the removed span doesn't leave
 * double spaces or blank-line spam.
 */
export function stripAllModeMarkers(text: string): string {
  if (!text) return text;
  // Replace the marker plus optional surrounding whitespace with a single
  // space (for inline removal) or empty (when the marker was a standalone
  // line). The post-process collapses consecutive spaces / blank-line spam.
  let result = text.replace(
    /[ \t]*\r?\n?[ \t]*\[\[\s*MODE\s*:\s*(anchor|analyst|fix-architect)\s*\]\][ \t]*\r?\n?[ \t]*/gi,
    (match) => {
      // If the matched span contains a newline on either side, the marker was
      // a line of its own — collapse to a single newline. Otherwise treat as
      // inline and collapse to a single space.
      return match.includes('\n') ? '\n' : ' ';
    },
  );
  // Trim leading newlines/spaces that the replacement may have left at the
  // very start, and trim a trailing single space at the end.
  result = result.replace(/^[ \t]*\n/, '').replace(/ $/, '');
  return result;
}

// Internal regex export for tests that want to inspect the literal pattern.
// Not part of the public API.
export { MODE_MARKER_BODY as _MODE_MARKER_BODY, MODE_MARKER_GLOBAL as _MODE_MARKER_GLOBAL };

/**
 * Lock-specific posture reminder injected into the system prompt when the
 * user has explicitly locked a mode via the AgentDrawer pill row. The base
 * prompt already explains the three-mode posture in detail; this addendum
 * is a short, unambiguous reinforcement of "you are locked here, honor it."
 *
 * Returns an empty string for `null` mode (no lock) — caller can append
 * unconditionally without a guard.
 */
export function getModeAddendum(mode: AgentMode | null): string {
  if (mode === null) return '';

  switch (mode) {
    case 'anchor':
      return `# MODE LOCKED — ANCHOR

The user has LOCKED you in MODE 1 (NEWS ANCHOR) via the AgentDrawer pill row. Honor that lock.

- Lead with BLUF (the atmospheric observation per SOUL.md §Voice Register rule 1).
- 2-4 sentences total. No section headers. No bullet lists unless you have 3+ items to list.
- One source citation with a clickable link. Skip the multi-section SITREP scaffolding.
- Minimal tool use — 1 to 2 tool calls.

You may still escalate to a higher mode ONLY if the current turn carries a Mode 3 keyword (patch / fix / Sigma / YARA / D3FEND), a Mode 2 keyword (deep dive / investigate / TTPs / IOCs / panel click), or a critical KEV signal. Otherwise stay at the ANCHOR floor.`;

    case 'analyst':
      return `# MODE LOCKED — ANALYST

The user has LOCKED you in MODE 2 (SENIOR TECHNICAL ANALYST) via the AgentDrawer pill row. Honor that lock.

- Use the full SITREP format: BLUF → DATA SUMMARY → KEY FINDINGS → MITRE MAPPING → RISK ASSESSMENT.
- Pull deep context via multiple AEGIS tool calls (aegis_cve_detail, aegis_score_threat_actor, aegis_find_incident_comps as relevant).
- Include CVSS vectors, EPSS percentiles, MITRE technique IDs (T1XXX), and IOC values where the data supports it.
- Confidence badges on every finding per SOUL.md confidence framework (CONFIRMED / HIGH / MEDIUM / LOW).
- Open each section with a narrative paragraph in voice, then follow with the structured artifact (table / list / code block).

You may escalate UP to FIX ARCHITECT only if the current turn carries a Mode 3 keyword (patch / fix / Sigma / YARA / D3FEND). Never down-grade to ANCHOR.`;

    case 'fix-architect':
      return `# MODE LOCKED — FIX ARCHITECT

The user has LOCKED you in MODE 3 (FIX ARCHITECT) via the AgentDrawer pill row. Honor that lock.

- Output an imperative, numbered remediation playbook. Steps in priority order.
- Each step carries a concrete artifact — patch version string, Sigma/YARA rule body, config diff, WAF rule, or MITRE D3FEND mitigation ID (M1032, etc.).
- Pull via aegis_match_defenses and aegis_cve_detail for vendor remediation and advisory URLs.
- Concrete beats generic. "Upgrade to libfoo 4.2.1" beats "update affected components." "Apply MITRE M1051" beats "enable software updates."
- BLUF opens with the closing-window observation (per SOUL.md §Voice Register Mode 3 example) — motivates urgency without saying "URGENT".

Never down-grade. The FIX ARCHITECT lock is the top of the mode hierarchy.`;

    default:
      // Defensive default arm. Unreachable via the AgentMode type at compile
      // time, but if an invalid value reaches us at runtime (e.g., unvalidated
      // request body upstream), return empty string instead of falling off
      // the switch and returning undefined — which would interpolate as the
      // literal text "undefined" into the system prompt.
      return '';
  }
}
