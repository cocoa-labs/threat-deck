-- ═══════════════════════════════════════════════
-- AEGIS INTELLIGENCE — PostgreSQL Schema (Cybersecurity)
-- Repurposed from atlas-schema.sql for Cocoa AI Threat Deck.
-- 26 tables across 7 subsystems + 5 views.
-- ═══════════════════════════════════════════════

-- ─── Subsystem A: Vulnerabilities (6 tables) ───

-- A1: Master CVE record
CREATE TABLE IF NOT EXISTS aegis_cves (
  cve_id TEXT PRIMARY KEY,                 -- "CVE-2024-12345"
  published_at TEXT NOT NULL,
  last_modified_at TEXT,
  summary TEXT,
  cwe_id TEXT,                             -- "CWE-79"
  cvss_v3_score DOUBLE PRECISION,
  cvss_v3_vector TEXT,
  cvss_v4_score DOUBLE PRECISION,
  cvss_v4_vector TEXT,
  epss_score DOUBLE PRECISION,             -- 0-1 exploit prediction score
  epss_percentile DOUBLE PRECISION,
  severity TEXT,                           -- critical/high/medium/low
  is_kev BOOLEAN DEFAULT FALSE,
  kev_added_date TEXT,
  exploited_in_wild BOOLEAN DEFAULT FALSE,
  poc_public BOOLEAN DEFAULT FALSE,
  nvd_source_url TEXT,
  tags TEXT[],
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_cves_severity ON aegis_cves(severity);
CREATE INDEX IF NOT EXISTS idx_aegis_cves_published ON aegis_cves(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_aegis_cves_kev ON aegis_cves(is_kev) WHERE is_kev = TRUE;
CREATE INDEX IF NOT EXISTS idx_aegis_cves_exploited ON aegis_cves(exploited_in_wild) WHERE exploited_in_wild = TRUE;

-- A2: CVSS/EPSS history over time — powers timeline lifecycle visualization
CREATE TABLE IF NOT EXISTS aegis_cve_severity_history (
  id SERIAL PRIMARY KEY,
  cve_id TEXT NOT NULL REFERENCES aegis_cves(cve_id) ON DELETE CASCADE,
  observed_at TEXT NOT NULL,
  cvss_score DOUBLE PRECISION,
  epss_score DOUBLE PRECISION,
  epss_percentile DOUBLE PRECISION,
  event_type TEXT,                         -- published / poc_published / exploited_in_wild / patched
  source TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_cve_history_cve ON aegis_cve_severity_history(cve_id);
CREATE INDEX IF NOT EXISTS idx_aegis_cve_history_observed ON aegis_cve_severity_history(observed_at);

-- A3: Affected products (CPE / package matching, foundation for v2 personalization)
CREATE TABLE IF NOT EXISTS aegis_affected_products (
  id SERIAL PRIMARY KEY,
  cve_id TEXT NOT NULL REFERENCES aegis_cves(cve_id) ON DELETE CASCADE,
  vendor TEXT,
  product TEXT,
  cpe_uri TEXT,
  version_range_start TEXT,
  version_range_end TEXT,
  package_ecosystem TEXT,                  -- npm / pypi / maven / apt / cargo / etc
  package_name TEXT,
  is_workaround_available BOOLEAN DEFAULT FALSE,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_affected_cve ON aegis_affected_products(cve_id);
CREATE INDEX IF NOT EXISTS idx_aegis_affected_vendor ON aegis_affected_products(vendor);
CREATE INDEX IF NOT EXISTS idx_aegis_affected_ecosystem ON aegis_affected_products(package_ecosystem, package_name);

-- A4: Remediations (patch versions, vendor advisories — powers fix-architect mode)
CREATE TABLE IF NOT EXISTS aegis_remediations (
  id SERIAL PRIMARY KEY,
  cve_id TEXT NOT NULL REFERENCES aegis_cves(cve_id) ON DELETE CASCADE,
  vendor TEXT,
  advisory_id TEXT,                        -- "MSRC-XXX", "USN-XXX", "RHSA-XXX"
  advisory_url TEXT,
  patch_version TEXT,
  released_at TEXT,
  severity_rating_vendor TEXT,
  mitre_mitigation_id TEXT,                -- "M1042"
  notes TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_remediations_cve ON aegis_remediations(cve_id);
CREATE INDEX IF NOT EXISTS idx_aegis_remediations_released ON aegis_remediations(released_at);

-- A5: Indicators of Compromise (from abuse.ch URLhaus / MalwareBazaar / ThreatFox)
CREATE TABLE IF NOT EXISTS aegis_iocs (
  id SERIAL PRIMARY KEY,
  ioc_type TEXT NOT NULL,                  -- sha256 / md5 / url / ip / domain / email
  value TEXT NOT NULL UNIQUE,
  first_seen TEXT,
  last_seen TEXT,
  source TEXT,                             -- urlhaus / malwarebazaar / threatfox
  confidence DOUBLE PRECISION,
  tags TEXT[],
  related_cve_id TEXT REFERENCES aegis_cves(cve_id) ON DELETE SET NULL,
  related_actor_id TEXT,                   -- FK declared in B1
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_iocs_type ON aegis_iocs(ioc_type);
CREATE INDEX IF NOT EXISTS idx_aegis_iocs_value ON aegis_iocs(value);
CREATE INDEX IF NOT EXISTS idx_aegis_iocs_first_seen ON aegis_iocs(first_seen DESC);

-- A6: CISA KEV cache (separate from cves so KEV-only metadata stays isolated)
CREATE TABLE IF NOT EXISTS aegis_kev (
  cve_id TEXT PRIMARY KEY REFERENCES aegis_cves(cve_id) ON DELETE CASCADE,
  added_to_kev_at TEXT NOT NULL,
  due_date TEXT,
  required_action TEXT,
  vulnerability_name TEXT,
  vendor_project TEXT,
  product TEXT,
  short_description TEXT,
  known_ransomware_use TEXT,
  notes TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_kev_due ON aegis_kev(due_date);

-- ─── Subsystem B: Threat Actors (5 tables) ───

-- B1: Threat actor master records (APT / ransomware / hacktivist / criminal / insider)
CREATE TABLE IF NOT EXISTS aegis_threat_actors (
  actor_id TEXT PRIMARY KEY,               -- "APT29", "LockBit", "FIN7"
  display_name TEXT NOT NULL,
  aliases TEXT[],                          -- ["Cozy Bear", "Nobelium"]
  actor_type TEXT,                         -- apt / ransomware / hacktivist / criminal / insider
  attribution_country TEXT,
  first_observed_at TEXT,
  last_active_at TEXT,
  motivation TEXT,                         -- espionage / financial / disruption / hacktivism
  sophistication TEXT,                     -- low / medium / high / expert
  summary TEXT,
  mitre_group_id TEXT,                     -- "G0016"
  reference_urls TEXT[],
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_actors_type ON aegis_threat_actors(actor_type);
CREATE INDEX IF NOT EXISTS idx_aegis_actors_country ON aegis_threat_actors(attribution_country);

-- B2: Threat actor scores (mirrors atlas_market_scores: capability / reach / recency / composite / grade)
CREATE TABLE IF NOT EXISTS aegis_threat_actor_scores (
  actor_id TEXT PRIMARY KEY REFERENCES aegis_threat_actors(actor_id) ON DELETE CASCADE,
  capability_score DOUBLE PRECISION,       -- tool sophistication, custom tooling, 0day usage
  reach_score DOUBLE PRECISION,            -- breadth of victim base, geographies
  recency_score DOUBLE PRECISION,          -- how active in last 90 days
  velocity_score DOUBLE PRECISION,         -- incident frequency
  attribution_confidence DOUBLE PRECISION, -- how confident the attribution is
  composite_score DOUBLE PRECISION,
  actor_grade TEXT,                        -- A / B / C / D / F (mirror atlas grade bands)
  actor_tier TEXT,                         -- tier1 / tier2 / tier3
  last_updated TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_actor_scores_grade ON aegis_threat_actor_scores(actor_grade);
CREATE INDEX IF NOT EXISTS idx_aegis_actor_scores_composite ON aegis_threat_actor_scores(composite_score DESC);

-- B3: Threat actor campaigns
CREATE TABLE IF NOT EXISTS aegis_threat_actor_campaigns (
  id SERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES aegis_threat_actors(actor_id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,                           -- NULL = ongoing
  target_sectors TEXT[],
  target_geographies TEXT[],
  summary TEXT,
  cve_ids_exploited TEXT[],                -- ["CVE-2024-XXX", "CVE-2024-YYY"]
  reference_urls TEXT[],
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_campaigns_actor ON aegis_threat_actor_campaigns(actor_id);
CREATE INDEX IF NOT EXISTS idx_aegis_campaigns_start ON aegis_threat_actor_campaigns(start_date DESC);

-- B4: MITRE ATT&CK technique mappings per actor
CREATE TABLE IF NOT EXISTS aegis_threat_actor_ttps (
  id SERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES aegis_threat_actors(actor_id) ON DELETE CASCADE,
  mitre_tactic_id TEXT,                    -- "TA0001"
  mitre_technique_id TEXT,                 -- "T1566"
  mitre_subtechnique_id TEXT,              -- "T1566.001"
  confidence DOUBLE PRECISION,
  first_observed_at TEXT,
  source TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_ttps_actor ON aegis_threat_actor_ttps(actor_id);
CREATE INDEX IF NOT EXISTS idx_aegis_ttps_technique ON aegis_threat_actor_ttps(mitre_technique_id);

-- B5: Targets per actor (powers the force-directed graph edges)
CREATE TABLE IF NOT EXISTS aegis_threat_actor_targets (
  id SERIAL PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES aegis_threat_actors(actor_id) ON DELETE CASCADE,
  org_name TEXT,
  industry TEXT,
  geography TEXT,
  attack_date TEXT,
  outcome TEXT,                            -- compromised / repelled / partial / unknown
  incident_id INTEGER,                     -- FK declared in C1
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_targets_actor ON aegis_threat_actor_targets(actor_id);
CREATE INDEX IF NOT EXISTS idx_aegis_targets_industry ON aegis_threat_actor_targets(industry);

-- ─── Subsystem C: Incidents + Comps (3 tables) ───

-- C1: Incidents (breach disclosures, ransomware events — mirrors atlas_sales_comps)
CREATE TABLE IF NOT EXISTS aegis_incidents (
  id SERIAL PRIMARY KEY,
  incident_id TEXT UNIQUE,                 -- "INC-2024-MOVEit-1234"
  organization TEXT,
  org_domain TEXT,
  industry TEXT,
  country TEXT,
  disclosed_at TEXT,
  incident_started_at TEXT,
  incident_ended_at TEXT,
  incident_type TEXT,                      -- ransomware / data_breach / credential_stuffing / supply_chain / ddos
  initial_access_vector TEXT,
  actor_id TEXT REFERENCES aegis_threat_actors(actor_id) ON DELETE SET NULL,
  records_compromised BIGINT,
  estimated_loss_usd DOUBLE PRECISION,
  summary TEXT,
  reference_urls TEXT[],
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_incidents_disclosed ON aegis_incidents(disclosed_at DESC);
CREATE INDEX IF NOT EXISTS idx_aegis_incidents_actor ON aegis_incidents(actor_id);
CREATE INDEX IF NOT EXISTS idx_aegis_incidents_industry ON aegis_incidents(industry);
CREATE INDEX IF NOT EXISTS idx_aegis_incidents_type ON aegis_incidents(incident_type);

-- C2: Flexible EAV attributes for comp matching
CREATE TABLE IF NOT EXISTS aegis_incident_attributes (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES aegis_incidents(id) ON DELETE CASCADE,
  attribute_type TEXT NOT NULL,            -- blast_radius / dwell_time_days / exfil_volume_gb / etc
  value_numeric DOUBLE PRECISION,
  value_text TEXT,
  confidence DOUBLE PRECISION,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_incident_attrs ON aegis_incident_attributes(incident_id, attribute_type);

-- C3: MITRE techniques observed per incident
CREATE TABLE IF NOT EXISTS aegis_incident_ttps_observed (
  id SERIAL PRIMARY KEY,
  incident_id INTEGER NOT NULL REFERENCES aegis_incidents(id) ON DELETE CASCADE,
  mitre_tactic_id TEXT,
  mitre_technique_id TEXT,
  evidence_summary TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_inc_ttps_incident ON aegis_incident_ttps_observed(incident_id);
CREATE INDEX IF NOT EXISTS idx_aegis_inc_ttps_technique ON aegis_incident_ttps_observed(mitre_technique_id);

-- ─── Subsystem D: Defenses (3 tables, mirrors capital sources) ───

-- D1: Defense controls / tools (mirrors atlas_capital_sources)
CREATE TABLE IF NOT EXISTS aegis_defenses (
  id SERIAL PRIMARY KEY,
  defense_id TEXT UNIQUE,
  name TEXT NOT NULL,
  defense_type TEXT,                       -- edr / siem / waf / mfa / network_segmentation / patch_mgmt / awareness_training
  vendor TEXT,
  cost_tier TEXT,                          -- free / low / mid / high
  complexity_tier TEXT,                    -- low / medium / high
  deployment_target TEXT,                  -- endpoint / network / cloud / identity / data
  frameworks TEXT[],                       -- ["NIST CSF: PR.AC", "CIS Control 6"]
  summary TEXT,
  reference_urls TEXT[],
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_defenses_type ON aegis_defenses(defense_type);
CREATE INDEX IF NOT EXISTS idx_aegis_defenses_target ON aegis_defenses(deployment_target);

-- D2: Defense → mitigated CVE / TTP / control mappings
CREATE TABLE IF NOT EXISTS aegis_defense_mappings (
  id SERIAL PRIMARY KEY,
  defense_id INTEGER NOT NULL REFERENCES aegis_defenses(id) ON DELETE CASCADE,
  mapping_type TEXT NOT NULL,              -- mitigates_cve / mitigates_technique / satisfies_control
  target_id TEXT NOT NULL,                 -- CVE-XXX / T1566 / NIST PR.AC-1
  efficacy_score DOUBLE PRECISION,         -- 0.0-1.0
  evidence_url TEXT,
  notes TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_def_map_defense ON aegis_defense_mappings(defense_id);
CREATE INDEX IF NOT EXISTS idx_aegis_def_map_target ON aegis_defense_mappings(target_id);
CREATE INDEX IF NOT EXISTS idx_aegis_def_map_type ON aegis_defense_mappings(mapping_type);

-- D3: Detection-quality characteristics per defense (mirrors atlas_loan_characteristics)
CREATE TABLE IF NOT EXISTS aegis_defense_characteristics (
  id SERIAL PRIMARY KEY,
  defense_id INTEGER NOT NULL REFERENCES aegis_defenses(id) ON DELETE CASCADE,
  characteristic_type TEXT NOT NULL,       -- detection_latency_seconds / false_positive_rate / coverage_pct
  value_numeric DOUBLE PRECISION,
  value_text TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_def_char_defense ON aegis_defense_characteristics(defense_id);

-- ─── Subsystem E: Org Exposure (3 tables) ───

-- E1: Compromised orgs (mirrors atlas_draper_leads)
CREATE TABLE IF NOT EXISTS aegis_compromised_orgs (
  id SERIAL PRIMARY KEY,
  org_name TEXT NOT NULL,
  org_domain TEXT UNIQUE,
  industry TEXT,
  country TEXT,
  state_region TEXT,
  breach_count INTEGER DEFAULT 0,
  last_breach_at TEXT,
  total_records_compromised BIGINT,
  has_active_ransom BOOLEAN DEFAULT FALSE,
  enrichment_status TEXT DEFAULT 'pending', -- pending / enriched / failed
  enrichment_source TEXT,
  notes TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_orgs_industry ON aegis_compromised_orgs(industry);
CREATE INDEX IF NOT EXISTS idx_aegis_orgs_country ON aegis_compromised_orgs(country);
CREATE INDEX IF NOT EXISTS idx_aegis_orgs_last_breach ON aegis_compromised_orgs(last_breach_at DESC);

-- E2: Append-only breach disclosure event log
CREATE TABLE IF NOT EXISTS aegis_breach_disclosures (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES aegis_compromised_orgs(id) ON DELETE CASCADE,
  disclosed_at TEXT NOT NULL,
  source TEXT,                             -- sec_8k / hibp / state_ag / news
  source_url TEXT,
  breach_type TEXT,
  records_compromised BIGINT,
  attestation_quality TEXT,                -- low / medium / high
  related_cve_ids TEXT[],
  notes TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_breaches_org ON aegis_breach_disclosures(org_id);
CREATE INDEX IF NOT EXISTS idx_aegis_breaches_disclosed ON aegis_breach_disclosures(disclosed_at DESC);

-- E3: Affected packages — empty in v1, placeholder for v2 stack-aware personalization
CREATE TABLE IF NOT EXISTS aegis_affected_packages (
  id SERIAL PRIMARY KEY,
  org_id INTEGER REFERENCES aegis_compromised_orgs(id) ON DELETE SET NULL,
  ecosystem TEXT NOT NULL,                 -- npm / pypi / maven / go / cargo / nuget / gem
  package_name TEXT NOT NULL,
  version TEXT,
  cve_id TEXT REFERENCES aegis_cves(cve_id) ON DELETE SET NULL,
  first_detected_at TEXT,
  is_fixed BOOLEAN DEFAULT FALSE,
  source TEXT,                             -- github / sbom / scan
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_pkgs_ecosystem ON aegis_affected_packages(ecosystem, package_name);
CREATE INDEX IF NOT EXISTS idx_aegis_pkgs_cve ON aegis_affected_packages(cve_id);

-- ─── Subsystem F: Advisories + Geo (3 tables) ───

-- F1: National CERT advisories (geo-stamped — map can color by jurisdiction)
CREATE TABLE IF NOT EXISTS aegis_advisories (
  id SERIAL PRIMARY KEY,
  advisory_id TEXT UNIQUE,                 -- "CISA AA24-XXX-A"
  issuer TEXT NOT NULL,                    -- cisa / ncsc_uk / enisa / cert_eu / jpcert / acsc / cccs / vendor
  issuer_geography TEXT,                   -- us / uk / eu / jp / au / ca
  published_at TEXT NOT NULL,
  severity TEXT,                           -- critical / high / medium / low
  title TEXT,
  summary TEXT,
  affected_cves TEXT[],
  affected_products TEXT[],
  advisory_url TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_advisories_issuer ON aegis_advisories(issuer);
CREATE INDEX IF NOT EXISTS idx_aegis_advisories_geo ON aegis_advisories(issuer_geography);
CREATE INDEX IF NOT EXISTS idx_aegis_advisories_published ON aegis_advisories(published_at DESC);

-- F2: Signal flags per advisory (drives autonomous triggers)
CREATE TABLE IF NOT EXISTS aegis_advisory_signals (
  id SERIAL PRIMARY KEY,
  advisory_id INTEGER NOT NULL REFERENCES aegis_advisories(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,               -- kev_addition / zero_day / active_exploitation / widespread_impact
  signal_strength DOUBLE PRECISION,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_signals_advisory ON aegis_advisory_signals(advisory_id);
CREATE INDEX IF NOT EXISTS idx_aegis_signals_type ON aegis_advisory_signals(signal_type);

-- F3: Hot table for the live attack map — written by collectors, read by Mapbox layer
CREATE TABLE IF NOT EXISTS aegis_geo_threat_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,                -- attack / disclosure / takedown / c2_observed
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  country TEXT,
  region TEXT,
  city TEXT,
  severity TEXT,
  target_org_id INTEGER REFERENCES aegis_compromised_orgs(id) ON DELETE SET NULL,
  actor_id TEXT REFERENCES aegis_threat_actors(actor_id) ON DELETE SET NULL,
  cve_id TEXT REFERENCES aegis_cves(cve_id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL,
  summary TEXT,
  source TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_geo_occurred ON aegis_geo_threat_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_aegis_geo_severity ON aegis_geo_threat_events(severity);
CREATE INDEX IF NOT EXISTS idx_aegis_geo_event_type ON aegis_geo_threat_events(event_type);

-- ─── Subsystem G: Operational Glue (3 tables) ───

-- G1: Pipeline alerts — the "active board" of new/triaging/escalated items (mirrors atlas_pipeline_deals)
CREATE TABLE IF NOT EXISTS aegis_pipeline_alerts (
  id SERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,                -- new_cve / new_kev / new_breach / new_patch / new_ioc / advisory
  entity_kind TEXT NOT NULL,               -- cve / incident / advisory / ioc — polymorphic
  entity_id TEXT NOT NULL,                 -- string PK of the referenced entity
  severity TEXT NOT NULL,                  -- critical / high / medium / low
  headline TEXT,
  summary TEXT,
  published_at TEXT NOT NULL,
  triaged_at TEXT,
  escalated_at TEXT,
  resolved_at TEXT,
  assigned_to TEXT,
  status TEXT DEFAULT 'new',               -- new / triaging / escalated / resolved / dismissed
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  updated_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_pipeline_status ON aegis_pipeline_alerts(status);
CREATE INDEX IF NOT EXISTS idx_aegis_pipeline_severity ON aegis_pipeline_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_aegis_pipeline_published ON aegis_pipeline_alerts(published_at DESC);

-- G2: External news articles linked back to AEGIS entities (news anchor mode context)
CREATE TABLE IF NOT EXISTS aegis_news_correlations (
  id SERIAL PRIMARY KEY,
  cve_id TEXT REFERENCES aegis_cves(cve_id) ON DELETE CASCADE,
  incident_id INTEGER REFERENCES aegis_incidents(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES aegis_threat_actors(actor_id) ON DELETE CASCADE,
  news_url TEXT NOT NULL,
  news_source TEXT,
  news_title TEXT,
  published_at TEXT,
  confidence_score DOUBLE PRECISION,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_aegis_news_corr_cve ON aegis_news_correlations(cve_id);
CREATE INDEX IF NOT EXISTS idx_aegis_news_corr_incident ON aegis_news_correlations(incident_id);

-- G3: Outbound audit trail for email / RSS / Twitter sends (prevents duplicate alerts)
CREATE TABLE IF NOT EXISTS aegis_outbound_log (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,                   -- email / rss / twitter / toast
  recipient TEXT,                          -- email address, twitter handle, or 'public' for RSS
  entity_kind TEXT,                        -- cve / incident / advisory / ioc / digest
  entity_id TEXT,
  payload_summary TEXT,
  sent_at TEXT,
  status TEXT DEFAULT 'queued',            -- queued / sent / failed
  error_message TEXT,
  created_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(channel, entity_kind, entity_id, recipient)
);
CREATE INDEX IF NOT EXISTS idx_aegis_outbound_channel ON aegis_outbound_log(channel);
CREATE INDEX IF NOT EXISTS idx_aegis_outbound_sent ON aegis_outbound_log(sent_at DESC);

-- ═══════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════

-- V1: CVE summary — joins cves + remediations + KEV status for the pipeline panel
CREATE OR REPLACE VIEW aegis_v_cve_summary AS
SELECT
  c.cve_id,
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

-- V2: Threat actor rankings by composite score (mirrors atlas_v_market_rankings)
CREATE OR REPLACE VIEW aegis_v_actor_rankings AS
SELECT
  a.actor_id,
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
ORDER BY COALESCE(s.composite_score, 0) DESC;

-- V3: Active KEV — within deadline window
CREATE OR REPLACE VIEW aegis_v_active_kev AS
SELECT
  c.cve_id,
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
WHERE k.due_date IS NULL OR k.due_date >= TO_CHAR(NOW(), 'YYYY-MM-DD')
ORDER BY k.added_to_kev_at DESC;

-- V4: Recent incidents — last 90 days, with actor + attribute summary
CREATE OR REPLACE VIEW aegis_v_recent_incidents AS
SELECT
  i.id,
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
WHERE i.disclosed_at >= TO_CHAR(NOW() - INTERVAL '90 days', 'YYYY-MM-DD');

-- V5: Critical alerts — feeds the RSS output and the pipeline panel default view
CREATE OR REPLACE VIEW aegis_v_critical_alerts AS
SELECT
  id,
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
WHERE severity IN ('critical', 'high')
  AND status IN ('new', 'triaging')
ORDER BY published_at DESC;
