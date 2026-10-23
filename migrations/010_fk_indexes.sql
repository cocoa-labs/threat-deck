-- Migration: fk_indexes
-- Created: 2026-05-25
-- Phase: 13 Tier 2 — Deploy gating
--
-- Adds indexes for 7 foreign-key columns that were declared in earlier
-- migrations (002, 003, 008) but never indexed. Without these, JOINs +
-- cascade-delete operations table-scan their child tables — slow today
-- with 136K CVEs, untenable at production scale.
--
-- Audit (run pre-migration to confirm gap):
--   SELECT c.conrelid::regclass, a.attname,
--          (EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid
--             AND a.attnum=ANY(i.indkey))) AS indexed
--     FROM pg_constraint c
--     JOIN unnest(c.conkey) AS conk(attnum) ON TRUE
--     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=conk.attnum
--    WHERE c.contype='f' AND c.conrelid::regclass::text LIKE 'aegis_%';
--
-- Also adds one composite index for the polymorphic forecast-outcomes
-- discriminator (forecast_id, forecast_kind) — Phase 11.0's existing
-- index covers forecast_kind + model_version but not the forecast_id
-- side of the lookup, so the daily outcome-backfill cron table-scans.

CREATE INDEX IF NOT EXISTS idx_aegis_iocs_related_cve
  ON aegis_iocs (related_cve_id)
  WHERE related_cve_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aegis_affected_packages_org
  ON aegis_affected_packages (org_id);

CREATE INDEX IF NOT EXISTS idx_aegis_geo_events_actor
  ON aegis_geo_threat_events (actor_id)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aegis_geo_events_cve
  ON aegis_geo_threat_events (cve_id)
  WHERE cve_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aegis_geo_events_target_org
  ON aegis_geo_threat_events (target_org_id)
  WHERE target_org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aegis_news_correlations_actor
  ON aegis_news_correlations (actor_id)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aegis_outbound_drafts_log
  ON aegis_outbound_drafts (outbound_log_id)
  WHERE outbound_log_id IS NOT NULL;

-- Phase 11 polymorphic forecast outcomes — lookup by (forecast_id, forecast_kind)
-- is the canonical "did this forecast get scored yet?" query in the
-- forecast-outcomes cron. The existing index leads with forecast_kind +
-- model_version which doesn't help; this composite covers the discriminator
-- + payload pair the cron filters on.
CREATE INDEX IF NOT EXISTS idx_outcomes_forecast_lookup
  ON aegis_forecast_outcomes (forecast_id, forecast_kind);
