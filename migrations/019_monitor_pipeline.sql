-- Migration: 019_monitor_pipeline
-- Created: 2026-06-06
-- Phase: 2 — watchlist activation
--
-- The `monitors` table (keyword watchlists) shipped in the initial schema but
-- was never wired: no CRUD, no scan, the monitor.keyword_match trigger never
-- fired. This adds the columns the scan needs (severity to grade the alert,
-- sources to scope which feeds to match, last_scanned_at as the cursor) plus a
-- match-dedup log so a given (monitor, item) only ever alerts once.

ALTER TABLE monitors ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE monitors
  ADD COLUMN IF NOT EXISTS sources TEXT[] NOT NULL DEFAULT ARRAY['cve', 'kev', 'breach', 'news', 'tweet'];
ALTER TABLE monitors ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;

-- Per-(monitor, source, item) dedup. The UNIQUE constraint + INSERT ON CONFLICT
-- DO NOTHING gives atomic "fire once" semantics for the scan cron.
CREATE TABLE IF NOT EXISTS monitor_match_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  source TEXT NOT NULL,            -- cve | kev | breach | news | tweet
  item_id TEXT NOT NULL,           -- stable id from the collector item
  matched_keyword TEXT,
  item_title TEXT,
  item_url TEXT,
  fired_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (monitor_id, source, item_id)
);
CREATE INDEX IF NOT EXISTS idx_monitor_match_monitor ON monitor_match_log(monitor_id, fired_at DESC);
