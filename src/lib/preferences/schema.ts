/**
 * User preferences — the DB-per-user config blob (Phase 2).
 *
 * Stored in `users.preferences` (JSONB). Holds the config that drives
 * SERVER-SIDE behavior (alert thresholds + channels, feed source toggles, agent
 * defaults, the daily ritual) so crons can read it per user. Pure-client UI prefs
 * (panel layout, accent, map style) intentionally stay in their existing
 * localStorage Zustand stores — they don't need to be server-readable.
 *
 * Watchlists and stack items are independently-queried typed tables, NOT part of
 * this blob (migrations 019/020).
 */

import { z } from 'zod';

export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export const ALERT_CHANNELS = ['toast', 'email', 'rss'] as const;
export const AGENT_MODES = ['anchor', 'analyst', 'fix'] as const;
export const RITUAL_CHANNELS = ['inapp', 'email'] as const;

// ─── Full schema (with defaults) ────────────────────────────────────────────

export const userPreferencesSchema = z.object({
  version: z.number().int().default(1),
  alerts: z
    .object({
      minSeverity: z.enum(SEVERITY_LEVELS).default('high'),
      channels: z.array(z.enum(ALERT_CHANNELS)).default(['toast']),
      kevAlways: z.boolean().default(true),
    })
    .prefault({}),
  feeds: z
    .object({
      // Collector keys the user has turned OFF; absent = enabled (new feeds default on).
      disabledSources: z.array(z.string()).default([]),
    })
    .prefault({}),
  agent: z
    .object({
      model: z.string().nullable().default(null), // null = server default (AGENT_MODEL env)
      defaultMode: z.enum(AGENT_MODES).default('anchor'),
      autonomousAlerts: z.boolean().default(true),
    })
    .prefault({}),
  ritual: z
    .object({
      enabled: z.boolean().default(false),
      hourLocal: z.number().int().min(0).max(23).default(7),
      timezone: z.string().default('America/New_York'),
      channels: z.array(z.enum(RITUAL_CHANNELS)).default(['inapp']),
      video: z.boolean().default(false),
    })
    .prefault({}),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const DEFAULT_PREFERENCES: UserPreferences = userPreferencesSchema.parse({});

/** Tolerant parse — unknown/legacy blobs fall back to defaults rather than throwing. */
export function parsePreferences(raw: unknown): UserPreferences {
  const result = userPreferencesSchema.safeParse(raw ?? {});
  return result.success ? result.data : DEFAULT_PREFERENCES;
}

// ─── Patch schema (deep-partial; no default-filling) ─────────────────────────
// Each section validates only the fields the client actually sent, so a partial
// section PATCH never silently resets the unspecified fields to defaults.

export const userPreferencesPatchSchema = z
  .object({
    version: z.number().int().optional(),
    alerts: z
      .object({
        minSeverity: z.enum(SEVERITY_LEVELS).optional(),
        channels: z.array(z.enum(ALERT_CHANNELS)).optional(),
        kevAlways: z.boolean().optional(),
      })
      .optional(),
    feeds: z
      .object({
        disabledSources: z.array(z.string()).optional(),
      })
      .optional(),
    agent: z
      .object({
        model: z.string().nullable().optional(),
        defaultMode: z.enum(AGENT_MODES).optional(),
        autonomousAlerts: z.boolean().optional(),
      })
      .optional(),
    ritual: z
      .object({
        enabled: z.boolean().optional(),
        hourLocal: z.number().int().min(0).max(23).optional(),
        timezone: z.string().optional(),
        channels: z.array(z.enum(RITUAL_CHANNELS)).optional(),
        video: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();

export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;

/** Section-aware deep merge: patch fields override current; unspecified fields survive. */
export function mergePreferences(
  current: UserPreferences,
  patch: UserPreferencesPatch,
): UserPreferences {
  return userPreferencesSchema.parse({
    version: patch.version ?? current.version,
    alerts: { ...current.alerts, ...(patch.alerts ?? {}) },
    feeds: { ...current.feeds, ...(patch.feeds ?? {}) },
    agent: { ...current.agent, ...(patch.agent ?? {}) },
    ritual: { ...current.ritual, ...(patch.ritual ?? {}) },
  });
}
