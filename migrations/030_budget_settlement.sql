-- Preserve admission estimates; separately record usage-based settlement.
-- NULL means usage was unavailable, so an opted-in cap retains the estimate.
ALTER TABLE security_budget_reservations
  ADD COLUMN settled_usd numeric(14,6) CHECK (settled_usd >= 0);
