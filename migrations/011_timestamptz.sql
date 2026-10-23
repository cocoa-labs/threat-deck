-- Migration: timestamptz
-- Created: 2026-05-25
-- Phase: 13 Tier 2 — Deploy gating
--
-- Converts TEXT temporal columns across 26 AEGIS tables to TIMESTAMPTZ.
-- This is the single largest semantic correctness fix in Phase 13.
--
-- Why: TEXT columns sorted with `ORDER BY published_at DESC` perform
-- lexicographic byte comparison, not chronological comparison. Strings
-- like '2024-09-15T08:00' would sort AFTER '2024-09-15T12:00' because
-- ASCII '8' > '1'. Across 136K CVEs, the CVE Timeline + Cyber Wire feed
-- + every "recent" query returns rows out of order. Plus indexes on
-- TEXT columns can't be range-scanned chronologically.
--
-- Safety analysis (run pre-migration):
--   docker exec threatdeck-postgres psql ... -c "SHOW TIMEZONE;"
--   → Etc/UTC (so naive strings cast as UTC, no drift)
--   docker exec threatdeck-postgres psql ... -c "SELECT '2024-05-25 10:00:00'::TIMESTAMPTZ;"
--   → 2024-05-25 10:00:00+00 (cast succeeds for the seed string format)
--
-- All existing writes in the codebase produce either:
--   - to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') strings (well-formed)
--   - ISO 8601 from collectors (well-formed)
-- Both cast cleanly to TIMESTAMPTZ. Zero data loss risk.
--
-- Strategy: single transaction (handled automatically by migrate.ts).
--   1. DROP 7 dependent views (PG refuses ALTER COLUMN on a referenced col).
--   2. Per table: DROP DEFAULT on created_at/updated_at FIRST (the existing
--      DEFAULT is `to_char(now(), 'YYYY-MM-DD HH24:MI:SS')` which returns
--      TEXT — PG refuses to auto-cast that to TIMESTAMPTZ during the type
--      change). THEN ALTER COLUMN TYPE. THEN re-SET DEFAULT NOW().
--   3. ALTER non-default-bearing temporal columns straightforward.
--   4. CREATE OR REPLACE views verbatim, rewriting `to_char(now(), …)`
--      filters to native `NOW()` / `INTERVAL` comparisons.
--
-- The 5 routes that already do runtime `::timestamptz` casts
-- (forecast-daily, forecast-outcomes, predictions/cve-forecast,
-- predictions/actor-forecast, twitter/content/data.ts) become no-ops
-- after this migration but stay safe (casting TIMESTAMPTZ to TIMESTAMPTZ
-- is a no-op in PG). Tier 4 will sweep them.

-- ─── 1. Drop dependent views (reverse-dep order) ─────────────────────────────

DROP VIEW IF EXISTS aegis_v_situation_signal;
DROP VIEW IF EXISTS aegis_v_top_likely_exploits;
DROP VIEW IF EXISTS aegis_v_recent_incidents;
DROP VIEW IF EXISTS aegis_v_critical_alerts;
DROP VIEW IF EXISTS aegis_v_actor_rankings;
DROP VIEW IF EXISTS aegis_v_active_kev;
DROP VIEW IF EXISTS aegis_v_cve_summary;

-- ─── 2. ALTER COLUMN TYPE TIMESTAMPTZ — per-table batched ────────────────────
-- For each created_at / updated_at column: DROP DEFAULT → ALTER TYPE → SET
-- DEFAULT NOW(). For other temporal columns, simple ALTER TYPE suffices.

ALTER TABLE aegis_cves
  ALTER COLUMN published_at     TYPE TIMESTAMPTZ USING published_at::TIMESTAMPTZ,
  ALTER COLUMN last_modified_at TYPE TIMESTAMPTZ USING last_modified_at::TIMESTAMPTZ,
  ALTER COLUMN kev_added_date   TYPE TIMESTAMPTZ USING kev_added_date::TIMESTAMPTZ,
  ALTER COLUMN created_at       DROP DEFAULT,
  ALTER COLUMN created_at       TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at       SET DEFAULT NOW(),
  ALTER COLUMN updated_at       DROP DEFAULT,
  ALTER COLUMN updated_at       TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ,
  ALTER COLUMN updated_at       SET DEFAULT NOW();

ALTER TABLE aegis_cve_severity_history
  ALTER COLUMN observed_at TYPE TIMESTAMPTZ USING observed_at::TIMESTAMPTZ,
  ALTER COLUMN created_at  DROP DEFAULT,
  ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at  SET DEFAULT NOW();

ALTER TABLE aegis_advisories
  ALTER COLUMN published_at TYPE TIMESTAMPTZ USING published_at::TIMESTAMPTZ,
  ALTER COLUMN created_at   DROP DEFAULT,
  ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at   SET DEFAULT NOW();

ALTER TABLE aegis_advisory_signals
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_affected_packages
  ALTER COLUMN first_detected_at TYPE TIMESTAMPTZ USING first_detected_at::TIMESTAMPTZ,
  ALTER COLUMN created_at        DROP DEFAULT,
  ALTER COLUMN created_at        TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at        SET DEFAULT NOW();

ALTER TABLE aegis_affected_products
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_breach_disclosures
  ALTER COLUMN disclosed_at TYPE TIMESTAMPTZ USING disclosed_at::TIMESTAMPTZ,
  ALTER COLUMN created_at   DROP DEFAULT,
  ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at   SET DEFAULT NOW();

ALTER TABLE aegis_compromised_orgs
  ALTER COLUMN last_breach_at TYPE TIMESTAMPTZ USING last_breach_at::TIMESTAMPTZ,
  ALTER COLUMN created_at     DROP DEFAULT,
  ALTER COLUMN created_at     TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at     SET DEFAULT NOW(),
  ALTER COLUMN updated_at     DROP DEFAULT,
  ALTER COLUMN updated_at     TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ,
  ALTER COLUMN updated_at     SET DEFAULT NOW();

ALTER TABLE aegis_defense_characteristics
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_defense_mappings
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_defenses
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at DROP DEFAULT,
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ,
  ALTER COLUMN updated_at SET DEFAULT NOW();

ALTER TABLE aegis_geo_threat_events
  ALTER COLUMN occurred_at TYPE TIMESTAMPTZ USING occurred_at::TIMESTAMPTZ,
  ALTER COLUMN created_at  DROP DEFAULT,
  ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at  SET DEFAULT NOW();

ALTER TABLE aegis_incident_attributes
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_incident_ttps_observed
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_incidents
  ALTER COLUMN disclosed_at        TYPE TIMESTAMPTZ USING disclosed_at::TIMESTAMPTZ,
  ALTER COLUMN incident_started_at TYPE TIMESTAMPTZ USING incident_started_at::TIMESTAMPTZ,
  ALTER COLUMN incident_ended_at   TYPE TIMESTAMPTZ USING incident_ended_at::TIMESTAMPTZ,
  ALTER COLUMN created_at          DROP DEFAULT,
  ALTER COLUMN created_at          TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at          SET DEFAULT NOW(),
  ALTER COLUMN updated_at          DROP DEFAULT,
  ALTER COLUMN updated_at          TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ,
  ALTER COLUMN updated_at          SET DEFAULT NOW();

ALTER TABLE aegis_iocs
  ALTER COLUMN first_seen TYPE TIMESTAMPTZ USING first_seen::TIMESTAMPTZ,
  ALTER COLUMN last_seen  TYPE TIMESTAMPTZ USING last_seen::TIMESTAMPTZ,
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_kev
  ALTER COLUMN added_to_kev_at TYPE TIMESTAMPTZ USING added_to_kev_at::TIMESTAMPTZ,
  ALTER COLUMN due_date        TYPE TIMESTAMPTZ USING due_date::TIMESTAMPTZ,
  ALTER COLUMN created_at      DROP DEFAULT,
  ALTER COLUMN created_at      TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at      SET DEFAULT NOW();

ALTER TABLE aegis_news_correlations
  ALTER COLUMN published_at TYPE TIMESTAMPTZ USING published_at::TIMESTAMPTZ,
  ALTER COLUMN created_at   DROP DEFAULT,
  ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at   SET DEFAULT NOW();

ALTER TABLE aegis_outbound_log
  ALTER COLUMN sent_at    TYPE TIMESTAMPTZ USING sent_at::TIMESTAMPTZ,
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_pipeline_alerts
  ALTER COLUMN published_at  TYPE TIMESTAMPTZ USING published_at::TIMESTAMPTZ,
  ALTER COLUMN triaged_at    TYPE TIMESTAMPTZ USING triaged_at::TIMESTAMPTZ,
  ALTER COLUMN escalated_at  TYPE TIMESTAMPTZ USING escalated_at::TIMESTAMPTZ,
  ALTER COLUMN resolved_at   TYPE TIMESTAMPTZ USING resolved_at::TIMESTAMPTZ,
  ALTER COLUMN created_at    DROP DEFAULT,
  ALTER COLUMN created_at    TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at    SET DEFAULT NOW(),
  ALTER COLUMN updated_at    DROP DEFAULT,
  ALTER COLUMN updated_at    TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ,
  ALTER COLUMN updated_at    SET DEFAULT NOW();

ALTER TABLE aegis_remediations
  ALTER COLUMN released_at TYPE TIMESTAMPTZ USING released_at::TIMESTAMPTZ,
  ALTER COLUMN created_at  DROP DEFAULT,
  ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at  SET DEFAULT NOW();

ALTER TABLE aegis_threat_actor_campaigns
  ALTER COLUMN start_date TYPE TIMESTAMPTZ USING start_date::TIMESTAMPTZ,
  ALTER COLUMN end_date   TYPE TIMESTAMPTZ USING end_date::TIMESTAMPTZ,
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_threat_actor_scores
  ALTER COLUMN created_at DROP DEFAULT,
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE aegis_threat_actor_targets
  ALTER COLUMN attack_date TYPE TIMESTAMPTZ USING attack_date::TIMESTAMPTZ,
  ALTER COLUMN created_at  DROP DEFAULT,
  ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at  SET DEFAULT NOW();

ALTER TABLE aegis_threat_actor_ttps
  ALTER COLUMN first_observed_at TYPE TIMESTAMPTZ USING first_observed_at::TIMESTAMPTZ,
  ALTER COLUMN created_at        DROP DEFAULT,
  ALTER COLUMN created_at        TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at        SET DEFAULT NOW();

ALTER TABLE aegis_threat_actors
  ALTER COLUMN first_observed_at TYPE TIMESTAMPTZ USING first_observed_at::TIMESTAMPTZ,
  ALTER COLUMN last_active_at    TYPE TIMESTAMPTZ USING last_active_at::TIMESTAMPTZ,
  ALTER COLUMN created_at        DROP DEFAULT,
  ALTER COLUMN created_at        TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ,
  ALTER COLUMN created_at        SET DEFAULT NOW(),
  ALTER COLUMN updated_at        DROP DEFAULT,
  ALTER COLUMN updated_at        TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ,
  ALTER COLUMN updated_at        SET DEFAULT NOW();

-- ─── 3. Recreate views (forward-dep order, with native TIMESTAMPTZ filters) ──

CREATE OR REPLACE VIEW aegis_v_cve_summary AS
SELECT c.cve_id,
       c.published_at,
       c.severity,
       c.cvss_v3_score,
       c.epss_score,
       c.epss_percentile,
       c.is_kev,
       c.kev_added_date,
       c.exploited_in_wild,
       c.poc_public,
       c.summary,
       c.nvd_source_url,
       c.tags,
       k.due_date AS kev_due_date,
       k.required_action AS kev_required_action,
       k.known_ransomware_use,
       (SELECT COUNT(*) FROM aegis_remediations r WHERE r.cve_id = c.cve_id) AS remediation_count,
       (SELECT MIN(r.released_at) FROM aegis_remediations r WHERE r.cve_id = c.cve_id) AS first_patch_at,
       (SELECT COUNT(*) FROM aegis_affected_products p WHERE p.cve_id = c.cve_id) AS affected_product_count
  FROM aegis_cves c
  LEFT JOIN aegis_kev k ON k.cve_id = c.cve_id;

CREATE OR REPLACE VIEW aegis_v_active_kev AS
SELECT c.cve_id,
       c.severity,
       c.cvss_v3_score,
       c.epss_score,
       c.summary,
       k.added_to_kev_at,
       k.due_date,
       k.required_action,
       k.vulnerability_name,
       k.vendor_project,
       k.product,
       k.known_ransomware_use
  FROM aegis_kev k
  JOIN aegis_cves c ON c.cve_id = k.cve_id
 WHERE k.due_date IS NULL OR k.due_date >= NOW()
 ORDER BY k.added_to_kev_at DESC;

CREATE OR REPLACE VIEW aegis_v_actor_rankings AS
SELECT a.actor_id,
       a.display_name,
       a.aliases,
       a.actor_type,
       a.attribution_country,
       a.sophistication,
       a.last_active_at,
       s.composite_score,
       s.actor_grade,
       s.actor_tier,
       s.capability_score,
       s.reach_score,
       s.recency_score,
       s.velocity_score,
       s.attribution_confidence,
       (SELECT COUNT(*) FROM aegis_threat_actor_campaigns c WHERE c.actor_id = a.actor_id) AS campaign_count,
       (SELECT COUNT(*) FROM aegis_threat_actor_targets t WHERE t.actor_id = a.actor_id) AS target_count
  FROM aegis_threat_actors a
  LEFT JOIN aegis_threat_actor_scores s ON s.actor_id = a.actor_id
 ORDER BY COALESCE(s.composite_score, 0::double precision) DESC;

CREATE OR REPLACE VIEW aegis_v_critical_alerts AS
SELECT id,
       alert_type,
       entity_kind,
       entity_id,
       severity,
       headline,
       summary,
       published_at,
       triaged_at,
       status,
       assigned_to,
       created_at
  FROM aegis_pipeline_alerts
 WHERE severity = ANY (ARRAY['critical'::text, 'high'::text])
   AND status   = ANY (ARRAY['new'::text, 'triaging'::text])
 ORDER BY published_at DESC;

CREATE OR REPLACE VIEW aegis_v_recent_incidents AS
SELECT i.id,
       i.incident_id,
       i.organization,
       i.org_domain,
       i.industry,
       i.country,
       i.disclosed_at,
       i.incident_type,
       i.initial_access_vector,
       i.records_compromised,
       i.estimated_loss_usd,
       i.summary,
       a.display_name AS actor_name,
       a.actor_type,
       (SELECT COUNT(*) FROM aegis_incident_ttps_observed t WHERE t.incident_id = i.id) AS ttp_count
  FROM aegis_incidents i
  LEFT JOIN aegis_threat_actors a ON a.actor_id = i.actor_id
 WHERE i.disclosed_at >= NOW() - INTERVAL '90 days';

CREATE OR REPLACE VIEW aegis_v_top_likely_exploits AS
WITH latest_per_cve AS (
  SELECT DISTINCT ON (cve_id, model_version)
         cve_id, model_version, forecast_date, p_exploited_30d, p_exploited_60d, p_exploited_90d,
         ci_low, ci_high, generated_at
    FROM aegis_cve_forecasts
   ORDER BY cve_id, model_version, forecast_date DESC
)
SELECT l.cve_id,
       c.severity,
       c.cvss_v3_score,
       c.epss_score,
       c.epss_percentile,
       c.published_at,
       l.p_exploited_30d,
       l.p_exploited_60d,
       l.p_exploited_90d,
       l.ci_low,
       l.ci_high,
       l.model_version,
       l.forecast_date,
       l.generated_at
  FROM latest_per_cve l
  JOIN aegis_cves c ON c.cve_id = l.cve_id
 WHERE COALESCE(c.is_kev, FALSE) = FALSE
 ORDER BY l.p_exploited_30d DESC
 LIMIT 50;

CREATE OR REPLACE VIEW aegis_v_situation_signal AS
SELECT COALESCE((SELECT AVG(p_exploited_30d) FROM aegis_v_top_likely_exploits LIMIT 20), 0::numeric)::numeric(5,4) AS next_30d_aggregate_p,
       COALESCE((SELECT trend FROM aegis_timeseries_forecasts
                  WHERE metric_name = 'kev_adds' AND horizon_days = 30
                  ORDER BY forecast_date DESC LIMIT 1), 'flat'::text) AS kev_trend_label,
       COALESCE((SELECT p_mid FROM aegis_timeseries_forecasts
                  WHERE metric_name = 'kev_adds' AND horizon_days = 7
                  ORDER BY forecast_date DESC LIMIT 1), 0::numeric)::numeric(8,2) AS kev_7d_projection,
       NOW() AS computed_at;
