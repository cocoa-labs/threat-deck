/**
 * Mapbox GL error classification + throttled reporting.
 *
 * react-map-gl/mapbox forwards the raw mapbox-gl ErrorEvent to <Map onError>.
 * Statically, only `evt.error.message` is typed (ErrorLike = { message: string }).
 * At runtime, network failures arrive as an AJAXError carrying `.status` + `.url`,
 * and 401s have "invalid Mapbox access token" appended to `.message`. We read
 * those extra fields defensively (they are not on the static type).
 *
 * The noise this solves: transient, self-healing satellite tile fetch failures
 * ("Failed to fetch …mapbox.satellite/z/x/y.webp") were logged via console.error,
 * which Next.js 16's dev overlay intercepts (next-devtools patches console.error
 * only — console.warn passes straight through). We route benign transient faults
 * to a throttled console.warn (off the overlay, still a breadcrumb) while genuine
 * config bugs (style/paint expression errors) stay loud on console.error, and
 * invalid-token errors are left for the caller to surface via setMapError.
 */
import type { ErrorEvent } from 'react-map-gl/mapbox';

export type MapboxErrorKind = 'auth' | 'transient' | 'fatal';

/** Defensive view over the runtime error — only `.message` is statically typed. */
function readError(evt: ErrorEvent): {
  message: string;
  name?: string;
  status?: number;
} {
  const e = evt.error as
    | Partial<{ message: string; name: string; status: number; url: string }>
    | undefined;
  return {
    message: e?.message ?? 'Unknown error',
    name: e?.name,
    status: typeof e?.status === 'number' ? e.status : undefined,
  };
}

const AUTH_RE = /access token|unauthorized|\b401\b/i;
const TRANSIENT_RE = /failed to fetch|networkerror|load failed/i;

/**
 * Classify a mapbox-gl error event. Ordered most-specific-first (mirrors
 * categorizeAgentError in src/lib/agent/client.ts): auth wins over transient
 * because a 401 is also "a failed fetch", and everything unrecognized defaults
 * to `fatal` so real config/style bugs are never silently swallowed.
 */
export function classifyMapboxError(evt: ErrorEvent): MapboxErrorKind {
  const { message, name, status } = readError(evt);

  // 1. auth — invalid/blocked token. Caller renders the error card.
  if (status === 401 || status === 403) return 'auth';
  if (AUTH_RE.test(message)) return 'auth';

  // 2. transient — self-healing network / server faults that mapbox retries.
  if (name === 'AbortError') return 'transient';
  if (TRANSIENT_RE.test(message)) return 'transient';
  if (status === 429) return 'transient';
  if (typeof status === 'number' && status >= 500) return 'transient';

  // 3. fatal (default) — incl. style-spec / paint-expression errors (BUG-010).
  return 'fatal';
}

/**
 * Collapse tile coordinates and query strings so every satellite tile failure
 * shares one throttle key (e.g. `/7/78/52.webp?sku=…` → `/{z}/{x}/{y}`).
 */
export function dedupeKey(message: string): string {
  return message
    .replace(/\?.*$/, '')
    .replace(/\/\d+\/\d+\/\d+\.(?:webp|png|pbf|jpg|jpeg)\b/gi, '/{z}/{x}/{y}');
}

// ─── Throttled reporter ──────────────────────────────────────────────────────
// Module-level window mirrors the Map<string, timestamp> backoff pattern in
// src/lib/data/rate-limiter.ts. Browser/app code, so Date.now() is fine here.
const THROTTLE_MS = 10_000;
const lastWarned = new Map<string, number>();

/**
 * Route a mapbox error to the right console channel:
 *  - transient → console.warn, throttled per dedupe key (no dev overlay)
 *  - fatal     → console.error, always (these are real bugs and SHOULD surface)
 *  - auth      → no-op (the caller handles it via setMapError)
 */
export function reportMapboxError(prefix: string, evt: ErrorEvent): void {
  const kind = classifyMapboxError(evt);
  if (kind === 'auth') return;

  const { message } = readError(evt);

  if (kind === 'fatal') {
    console.error(prefix, message);
    return;
  }

  // transient
  const key = dedupeKey(message);
  const now = Date.now();
  if (now - (lastWarned.get(key) ?? 0) > THROTTLE_MS) {
    if (lastWarned.size > 50) lastWarned.clear();
    lastWarned.set(key, now);
    console.warn(prefix, message);
  }
}
