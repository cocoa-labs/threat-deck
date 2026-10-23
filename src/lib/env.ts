/**
 * ═══════════════════════════════════════════════
 * Cocoa AI Threat Deck — Environment Validation
 * ═══════════════════════════════════════════════
 *
 * Single source of truth for all environment variable parsing, validation,
 * and defaulting. Built on Zod so misconfigurations fail loudly at process
 * boot rather than surfacing as cryptic runtime errors in a hot code path.
 *
 * Categorization:
 *   - REQUIRED   — must be set; throws at module load if missing/invalid.
 *   - OPTIONAL with defaults — gets a sane default when absent.
 *   - OPTIONAL without defaults — passes through as `undefined`. Code that
 *     consumes it must feature-toggle accordingly (e.g., Resend sends become
 *     no-ops when RESEND_API_KEY is absent).
 *
 * Usage:
 *   import { env } from '@/lib/env';
 *   const url = env.DATABASE_URL;        // typed string, guaranteed present
 *   if (env.RESEND_API_KEY) { ... }      // optional, narrowed to string here
 *
 * For diagnostic logging (server boot, status pages), use:
 *   import { envSafe } from '@/lib/env';
 *   console.log(envSafe());              // secrets masked, URLs sanitized
 *
 * NOTE: This module deliberately runs `envSchema.parse(process.env)` at
 * import time. The very first import (typically from server.ts or a route
 * handler) will throw if required vars are missing. That is the desired
 * behavior — we want loud failures over silent misbehavior.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce empty strings to undefined so `.optional()` works as expected. */
const optionalString = z
  .string()
  .transform((s) => (s.trim().length === 0 ? undefined : s))
  .optional();

/** Boolean parser for `true`/`false`/`1`/`0` env values. */
const boolFromEnv = z
  .string()
  .transform((s) => {
    const v = s.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  })
  .optional();

/** Integer parser for numeric env vars. */
const intFromEnv = z
  .string()
  .transform((s, ctx) => {
    const n = Number.parseInt(s, 10);
    if (Number.isNaN(n)) {
      ctx.addIssue({ code: 'custom', message: 'expected integer' });
      return z.NEVER;
    }
    return n;
  })
  .optional();

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // ─── Node / runtime ───
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // ─── REQUIRED at runtime ───
  // Without these the app cannot serve a meaningful request.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (e.g. postgresql://user:pass@localhost:5436/threatdeck)'),
  NEXTAUTH_SECRET: z
    .string()
    .min(32, 'NEXTAUTH_SECRET must be at least 32 chars (use: openssl rand -hex 32)'),
  ANTHROPIC_API_KEY: optionalString,
  NEXT_PUBLIC_MAPBOX_TOKEN: optionalString,

  // ─── OPTIONAL with sensible defaults ───
  REDIS_URL: z.string().default('redis://localhost:6380'),
  NEXTAUTH_URL: z.string().url().default('http://localhost:3002'),
  PORT: intFromEnv,
  HOSTNAME: optionalString,
  AGENT_MODEL: z.string().default('claude-sonnet-4-6'),
  AGENT_MAX_TOOL_TURNS: intFromEnv,
  TWITTER_OAUTH_HANDLE: optionalString,

  // ─── OPTIONAL without defaults (feature flags / BYOK) ───
  // Code that uses these must check for `undefined` and degrade gracefully.

  // Auth allowlist (empty → no one can log in via magic link)
  ALLOWED_EMAILS: optionalString,
  // Local-only auth shortcut. Ignored unless NODE_ENV !== 'production'.
  AUTH_DEV_BYPASS: optionalString,
  AUTH_DEV_EMAIL: optionalString,

  // Outbound email (Resend) — when absent, sendEmail() is a no-op (fail-soft)
  RESEND_API_KEY: optionalString,
  RESEND_FROM_EMAIL: optionalString,
  ALERT_EMAIL_RECIPIENTS: optionalString,
  // Phase 13 Tier 5 — recipient for the EMAIL ME button in the AgentDrawer
  // footer. Comma-separated list supported. When unset, the route falls back
  // to session.user.email so operators always get their own clicks routed
  // back to their own inbox. Pinpoint targeting via this var when needed
  // (e.g., a team alias, or for testing against a non-signed-in handle).
  EMAIL_ME_RECIPIENT: optionalString,
  // Phase 13 Tier 5.1 — named recipient lists for the email_conversation
  // agent tool. Tool calls reference these as 'team:cocoa' (lowercase);
  // the handler resolves `team:<name>` via `EMAIL_TEAM_<NAME>` env var
  // (uppercase). Comma-separated. Multiple teams supported via multiple
  // EMAIL_TEAM_<X> vars. Add new teams as `EMAIL_TEAM_<NAME>: optionalString`
  // here and document the recipient list in `.env.example`.
  EMAIL_TEAM_COCOA: optionalString,
  EMAIL_LINK_BASE_URL: optionalString,
  CRON_SECRET: optionalString,

  // Email transport selection + Google Workspace (Gmail) credentials.
  // EMAIL_PROVIDER picks the sendEmail() backend: 'gmail' sends as Max's own
  // Workspace mailbox via the Gmail API (service account + domain-wide
  // delegation); 'resend' (default) keeps the Resend/SES path as a fallback.
  // GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY auto-masks (matches the secret pattern).
  EMAIL_PROVIDER: z.enum(['resend', 'gmail']).default('resend'),
  GMAIL_SENDER: optionalString,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: optionalString,

  // Outbound Twitter (OAuth)
  OAUTH_ENCRYPTION_KEY: optionalString,
  TWITTER_OAUTH_CLIENT_ID: optionalString,
  TWITTER_OAUTH_CLIENT_SECRET: optionalString,
  TWITTER_OAUTH_REDIRECT_URI: optionalString,
  TWITTER_AUTODRAFT_ENABLED: boolFromEnv,

  // Read-side data source keys (collectors degrade to seed/demo data without them)
  MASSIVE_API_KEY: optionalString,
  POLYGON_API_KEY: optionalString,
  NEWS_API_KEY: optionalString,
  FRED_API_KEY: optionalString,
  ALPHA_VANTAGE_API_KEY: optionalString,
  FINNHUB_API_KEY: optionalString,
  COINGECKO_API_KEY: optionalString,
  COINGECKO_PRO: optionalString,
  QUIVER_API_KEY: optionalString,
  WHALE_ALERT_API_KEY: optionalString,
  TWITTER_BEARER_TOKEN: optionalString,
  MAPBOX_TOKEN: optionalString,
  YOUTUBE_API_KEY: optionalString,
  YOUTUBE_SEARCH_API_KEY: optionalString,
  FIRECRAWL_API_KEY: optionalString,
  // GitHub REST API auth for read_url's GitHub fast path. Optional: the path
  // works unauthenticated at 60/hr; a token raises it to 5000/hr. Either name
  // is accepted (GITHUB_TOKEN preferred). Auto-masked by the SECRET pattern.
  GITHUB_TOKEN: optionalString,
  GH_TOKEN: optionalString,
  NVD_API_KEY: optionalString,
  ABUSECH_AUTH_KEY: optionalString,
  BINANCE_WS_URL: optionalString,

  // Public URLs (NEXT_PUBLIC_*)
  NEXT_PUBLIC_SITE_URL: optionalString,
  NEXT_PUBLIC_URL: optionalString,
  NEXT_PUBLIC_TWITTER_DRAFT_QUEUE: boolFromEnv,
  NEXT_PUBLIC_LIVESTREAM_URL: optionalString,
  NEXT_PUBLIC_LIVESTREAM_CHANNELS: optionalString,

  // Feature flags
  FEATURE_TWITTER: boolFromEnv,

  // Phase 14 — visual generation
  OPENAI_API_KEY: optionalString,
  BLOB_READ_WRITE_TOKEN: optionalString,
  OUTBOUND_VISUAL_DAILY_SPEND_USD: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? 20 : Number(v)))
    .pipe(z.number().min(0)),
  OUTBOUND_VISUAL_DAILY_SPEND_USD_HARD: z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? 30 : Number(v)))
    .pipe(z.number().min(0)),
  VISUAL_AUTOPUBLISH_ENABLED: boolFromEnv,
  HIGGSFIELD_VIDEO_ENABLED: boolFromEnv,
  HIGGSFIELD_CLI_PATH: optionalString,
  // Video render worker (production): Vercel sets HIGGSFIELD_REMOTE_URL to the
  // Fly machine; both sides share INTERNAL_RENDER_SECRET. Unset locally → the
  // CLI runs in-process.
  HIGGSFIELD_REMOTE_URL: optionalString,
  INTERNAL_RENDER_SECRET: optionalString,
});

export type Env = z.infer<typeof envSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Parse at module load — throws on missing/invalid required vars
// ─────────────────────────────────────────────────────────────────────────────

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (result.success) {
    return result.data;
  }

  // Build a human-readable error summary listing every offending var.
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.join('.') || '<root>';
    return `  - ${path}: ${issue.message}`;
  });

  const message = [
    '',
    '═══════════════════════════════════════════════════════════════════',
    'ENVIRONMENT VALIDATION FAILED',
    '═══════════════════════════════════════════════════════════════════',
    '',
    'The following environment variables are missing or invalid:',
    '',
    ...issues,
    '',
    'Fix your `.env` (or `.env.local`) and restart. See `.env.example`.',
    '═══════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');

  // Stderr so the message survives any logger that filters stdout.
  process.stderr.write(message);
  throw new Error('Environment validation failed — see stderr for details.');
}

export const env: Env = parseEnv();

// ─────────────────────────────────────────────────────────────────────────────
// envSafe() — sanitized snapshot for diagnostic logging
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_KEY_PATTERN = /KEY|SECRET|TOKEN|PASSWORD/i;
/** Mask email addresses too — recipient lists are PII (per Phase 13 Tier 5.1 review). */
const PII_KEY_PATTERN = /RECIPIENT|EMAIL_ME|EMAIL_TEAM/i;

/** Show the last 4 characters of a secret; everything else becomes `*`. */
function maskSecret(value: string | undefined): string {
  if (!value) return '<unset>';
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}

/**
 * Mask the password in a Postgres connection URL while preserving everything
 * else (host, port, db). `postgresql://user:secret@host:5432/db` becomes
 * `postgresql://user:****@host:5432/db`.
 */
function maskPostgresUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '<unparseable-url>';
  }
}

/**
 * Mask a Redis URL the same way (auth segment is optional but supported).
 */
function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '****';
    return parsed.toString();
  } catch {
    return '<unparseable-url>';
  }
}

export type EnvSafe = Record<string, string | number | boolean | undefined>;

/**
 * Return a snapshot of `env` safe to log. API keys/tokens/passwords are
 * masked to show only the last 4 characters; Postgres/Redis URLs preserve
 * their structure but redact embedded passwords; public URLs and feature
 * flags pass through unchanged.
 */
export function envSafe(): EnvSafe {
  const out: EnvSafe = {};
  for (const [key, rawValue] of Object.entries(env)) {
    if (rawValue === undefined) {
      out[key] = undefined;
      continue;
    }
    if (key === 'DATABASE_URL' && typeof rawValue === 'string') {
      out[key] = maskPostgresUrl(rawValue);
      continue;
    }
    if (key === 'REDIS_URL' && typeof rawValue === 'string') {
      out[key] = maskRedisUrl(rawValue);
      continue;
    }
    if (
      typeof rawValue === 'string' &&
      (SECRET_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key))
    ) {
      out[key] = maskSecret(rawValue);
      continue;
    }
    out[key] = rawValue as string | number | boolean;
  }
  return out;
}
