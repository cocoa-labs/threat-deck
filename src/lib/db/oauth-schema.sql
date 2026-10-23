-- ═══════════════════════════════════════════════
-- OAUTH TOKEN STORAGE — PostgreSQL Schema (Plumbing)
-- Single-tenant: one row per (provider, handle).
-- Tokens are AES-256-GCM encrypted at rest using OAUTH_ENCRYPTION_KEY.
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cocoa_oauth_tokens (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,                    -- 'twitter' for now; extensible (e.g. 'mastodon', 'bluesky')
  handle TEXT NOT NULL,                      -- installation's configured X handle
  access_token_encrypted TEXT NOT NULL,      -- AES-256-GCM encrypted (iv:tag:ciphertext)
  refresh_token_encrypted TEXT,              -- nullable for tokens with no refresh
  expires_at TEXT,                           -- ISO 8601; nullable for non-expiring
  scopes TEXT[],
  created_at TEXT NOT NULL DEFAULT NOW()::text,
  last_used_at TEXT,
  UNIQUE (provider, handle)
);
CREATE INDEX IF NOT EXISTS idx_cocoa_oauth_provider ON cocoa_oauth_tokens(provider);
