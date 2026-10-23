/**
 * Canonical seedance_2_0 render parameters.
 *
 * Single source of truth for BOTH entry points — the VID button's HTTP route
 * (/api/outbound/generate-video) and the agent's generate_video tool handler.
 * They used to validate differently: the route allowlisted aspect ratios and
 * clamped duration, while the tool handler forwarded raw model strings straight
 * into the CLI argv. An invalid enum then surfaced as an unexplained cli_failed,
 * and a value starting with `--` was consumed as a flag.
 *
 * Enums mirror the vendor's MODELS.md entry for seedance_2_0:
 *   aspect_ratio auto|16:9|9:16|4:3|3:4|1:1|21:9   (default 16:9)
 *   duration     integer                            (default 5)
 *   resolution   480p|720p|1080p|4k                 (default 720p)
 *   mode         std|fast                           (default std)
 *   genre        auto|action|horror|comedy|noir|drama|epic (default auto)
 *
 * We deliberately narrow aspect_ratio to the three the popover offers.
 */

export const ALLOWED_ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;
export const ALLOWED_RESOLUTIONS = ['480p', '720p', '1080p', '4k'] as const;
export const ALLOWED_MODES = ['std', 'fast'] as const;
export const ALLOWED_GENRES = [
  'auto',
  'action',
  'horror',
  'comedy',
  'noir',
  'drama',
  'epic',
] as const;

export const MIN_DURATION_SECONDS = 5;
export const MAX_DURATION_SECONDS = 15;

export const VIDEO_DEFAULTS = {
  aspectRatio: '9:16',
  durationSeconds: 8,
  resolution: '720p',
  mode: 'fast',
  genre: 'noir',
} as const;

/** `mode: fast` only supports 480p/720p — the API rejects 1080p/4k AFTER the
 *  job is staged, so catch it locally instead of paying for the round trip. */
export const HIGH_RES = new Set<string>(['1080p', '4k']);

export interface NormalizedVideoParams {
  aspectRatio: string;
  durationSeconds: number;
  resolution: string;
  mode: string;
  genre: string;
}

function pick<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

export function clampDuration(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return VIDEO_DEFAULTS.durationSeconds;
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(n)));
}

/**
 * Coerce arbitrary caller input to a valid, internally consistent parameter
 * set. Unknown values fall back to the default rather than reaching the CLI —
 * `generate create` whitelists unknown flags into its params payload, so a bad
 * value is only rejected server-side, long after we've committed.
 */
export function normalizeVideoParams(input: {
  aspectRatio?: unknown;
  durationSeconds?: unknown;
  resolution?: unknown;
  mode?: unknown;
  genre?: unknown;
}): NormalizedVideoParams {
  const resolution = pick(input.resolution, ALLOWED_RESOLUTIONS, VIDEO_DEFAULTS.resolution);
  let mode = pick(input.mode, ALLOWED_MODES, VIDEO_DEFAULTS.mode);
  // Promote rather than reject: the operator asked for the resolution, and
  // `std` is the parameter that has to give way for them to get it.
  if (HIGH_RES.has(resolution) && mode === 'fast') mode = 'std';

  return {
    aspectRatio: pick(input.aspectRatio, ALLOWED_ASPECT_RATIOS, VIDEO_DEFAULTS.aspectRatio),
    durationSeconds: clampDuration(input.durationSeconds),
    resolution,
    mode,
    genre: pick(input.genre, ALLOWED_GENRES, VIDEO_DEFAULTS.genre),
  };
}
