-- Forward-only security ledger. Reservations remain charged for 24 hours,
-- including failed requests: a lost response must never create free retries.
CREATE TABLE IF NOT EXISTS security_budget_reservations (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('ai', 'media')),
  reserved_usd numeric(14,6) NOT NULL CHECK (reserved_usd > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  released_at timestamptz
);
CREATE INDEX IF NOT EXISTS security_budget_window_idx
  ON security_budget_reservations(provider, created_at);
