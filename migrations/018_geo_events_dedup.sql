-- Migration: 018_geo_events_dedup
-- Created: 2026-06-06
-- Phase: 1C — live geo pipeline
--
-- aegis_geo_threat_events was seed-only: 6 static 2024 rows, no collector ever
-- wrote to it (the globe showed live data only via client-side keyword
-- geotagging). The new geo-events.ts collector writes attack/disclosure rows on
-- a 30-min cron. This adds a stable upsert key + the indexes its consumers need.
--
-- dedup_hash is a NULLABLE unique column: existing seed rows keep NULL (NULLs do
-- not conflict in Postgres), while every collector-written row carries a sha256
-- of its logical identity. The collector upserts ON CONFLICT (dedup_hash),
-- refreshing occurred_at so the live 30-day window always shows current activity
-- without duplicating rows. CLAUDE.md migration discipline — new migration,
-- never edit an applied one.

ALTER TABLE aegis_geo_threat_events ADD COLUMN IF NOT EXISTS dedup_hash TEXT;

-- Upsert target (unique index backs ON CONFLICT (dedup_hash)).
CREATE UNIQUE INDEX IF NOT EXISTS idx_aegis_geo_dedup
  ON aegis_geo_threat_events(dedup_hash);

-- War-room arc query filters actor_id IS NOT NULL; the consumer route LEFT JOINs
-- on actor_id and cve_id. Index both.
CREATE INDEX IF NOT EXISTS idx_aegis_geo_actor ON aegis_geo_threat_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_aegis_geo_cve ON aegis_geo_threat_events(cve_id);
