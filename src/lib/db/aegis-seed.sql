-- ═══════════════════════════════════════════════
-- AEGIS Seed Data — minimal dev seed for Phase 3 handler verification
-- Idempotent: uses ON CONFLICT DO NOTHING so re-apply is safe.
-- ═══════════════════════════════════════════════

-- ─── Vulnerabilities (CVEs + KEV + remediations + IOCs) ───

INSERT INTO aegis_cves (cve_id, published_at, last_modified_at, summary, cwe_id, cvss_v3_score, cvss_v3_vector, epss_score, epss_percentile, severity, is_kev, kev_added_date, exploited_in_wild, poc_public, nvd_source_url, tags) VALUES
('CVE-2024-3094', '2024-03-29', '2024-04-15', 'Malicious code injection in XZ Utils liblzma 5.6.0 and 5.6.1 allowing unauthorized remote access via SSH backdoor.', 'CWE-506', 10.0, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 0.94, 99.8, 'critical', TRUE, '2024-04-02', TRUE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-3094', ARRAY['supply-chain','backdoor','ssh','xz-utils']),
('CVE-2024-21413', '2024-02-13', '2024-03-01', 'Microsoft Outlook Remote Code Execution Vulnerability via crafted Moniker links bypassing Protected View.', 'CWE-20', 9.8, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 0.87, 98.5, 'critical', TRUE, '2024-02-14', TRUE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-21413', ARRAY['microsoft','outlook','rce','moniker']),
('CVE-2024-23897', '2024-01-24', '2024-02-10', 'Jenkins arbitrary file read vulnerability via CLI command parser allowing unauthenticated file disclosure.', 'CWE-22', 9.8, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 0.92, 99.3, 'critical', TRUE, '2024-01-29', TRUE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-23897', ARRAY['jenkins','file-read','cli']),
('CVE-2024-1709', '2024-02-20', '2024-02-22', 'ConnectWise ScreenConnect authentication bypass using alternate path or channel allowing unauthenticated remote access.', 'CWE-288', 10.0, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 0.95, 99.9, 'critical', TRUE, '2024-02-22', TRUE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-1709', ARRAY['screenconnect','auth-bypass','rmm']),
('CVE-2024-27198', '2024-03-04', '2024-03-15', 'JetBrains TeamCity authentication bypass via alternative path allowing administrative access.', 'CWE-288', 9.8, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 0.89, 98.9, 'critical', TRUE, '2024-03-07', TRUE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-27198', ARRAY['teamcity','auth-bypass','ci-cd']),
('CVE-2024-26229', '2024-04-09', '2024-04-15', 'Windows CSC Service elevation of privilege via insecure file operations.', 'CWE-269', 7.8, 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 0.45, 92.0, 'high', FALSE, NULL, FALSE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-26229', ARRAY['windows','privesc']),
('CVE-2024-20767', '2024-03-12', '2024-03-15', 'Adobe ColdFusion improper access control leading to arbitrary file system read.', 'CWE-284', 7.4, 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:N/A:N', 0.32, 87.5, 'high', FALSE, NULL, FALSE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-20767', ARRAY['adobe','coldfusion','file-read']),
('CVE-2024-24919', '2024-05-28', '2024-06-01', 'Check Point Security Gateways information disclosure via path traversal in remote access VPN.', 'CWE-22', 8.6, 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', 0.93, 99.5, 'high', TRUE, '2024-05-30', TRUE, TRUE, 'https://nvd.nist.gov/vuln/detail/CVE-2024-24919', ARRAY['checkpoint','vpn','info-disclosure'])
ON CONFLICT (cve_id) DO NOTHING;

INSERT INTO aegis_kev (cve_id, added_to_kev_at, due_date, required_action, vulnerability_name, vendor_project, product, short_description, known_ransomware_use) VALUES
('CVE-2024-3094', '2024-04-02', '2024-04-16', 'Apply mitigations per vendor instructions or discontinue use of the product.', 'XZ Utils Embedded Malicious Code', 'XZ Utils', 'XZ Utils', 'Malicious code embedded in liblzma allowing SSH bypass.', 'Unknown'),
('CVE-2024-21413', '2024-02-14', '2024-03-06', 'Apply mitigations per Microsoft instructions.', 'Microsoft Outlook Improper Input Validation', 'Microsoft', 'Outlook', 'Crafted Moniker link RCE bypassing Protected View.', 'Unknown'),
('CVE-2024-23897', '2024-01-29', '2024-02-29', 'Apply mitigations per Jenkins instructions or discontinue use.', 'Jenkins Path Traversal', 'Jenkins', 'Jenkins', 'CLI command parser arbitrary file read.', 'Known'),
('CVE-2024-1709', '2024-02-22', '2024-02-29', 'Apply mitigations per ConnectWise instructions.', 'ConnectWise ScreenConnect Authentication Bypass', 'ConnectWise', 'ScreenConnect', 'Authentication bypass via alternate path.', 'Known'),
('CVE-2024-27198', '2024-03-07', '2024-03-28', 'Apply mitigations per JetBrains instructions.', 'JetBrains TeamCity Authentication Bypass', 'JetBrains', 'TeamCity', 'Authentication bypass via alternative path.', 'Known'),
('CVE-2024-24919', '2024-05-30', '2024-06-20', 'Apply mitigations per Check Point instructions.', 'Check Point Quantum Security Gateways Information Disclosure', 'Check Point', 'Quantum Security Gateway', 'Path traversal in remote access VPN.', 'Unknown')
ON CONFLICT (cve_id) DO NOTHING;

INSERT INTO aegis_affected_products (cve_id, vendor, product, cpe_uri, version_range_start, version_range_end, package_ecosystem, package_name, is_workaround_available) VALUES
('CVE-2024-3094', 'XZ Utils', 'liblzma', 'cpe:2.3:a:xz_utils:liblzma:5.6.0:*:*:*:*:*:*:*', '5.6.0', '5.6.1', 'apt', 'xz-utils', TRUE),
('CVE-2024-21413', 'Microsoft', 'Outlook 2016', 'cpe:2.3:a:microsoft:outlook:2016:*:*:*:*:*:*:*', '16.0.0', '16.0.5435', NULL, NULL, TRUE),
('CVE-2024-23897', 'Jenkins', 'Jenkins Core', 'cpe:2.3:a:jenkins:jenkins:*:*:*:*:lts:*:*:*', '0', '2.426.2', NULL, NULL, TRUE),
('CVE-2024-1709', 'ConnectWise', 'ScreenConnect', 'cpe:2.3:a:connectwise:screenconnect:*:*:*:*:*:*:*:*', '0', '23.9.8', NULL, NULL, TRUE),
('CVE-2024-27198', 'JetBrains', 'TeamCity', 'cpe:2.3:a:jetbrains:teamcity:*:*:*:*:*:*:*:*', '0', '2023.11.4', NULL, NULL, TRUE),
('CVE-2024-24919', 'Check Point', 'Quantum Security Gateway R81', 'cpe:2.3:h:checkpoint:quantum_security_gateway:r81:*:*:*:*:*:*:*', 'R77.20', 'R81.20', NULL, NULL, TRUE);

INSERT INTO aegis_remediations (cve_id, vendor, advisory_id, advisory_url, patch_version, released_at, severity_rating_vendor, mitre_mitigation_id, notes) VALUES
('CVE-2024-3094', 'XZ Utils', 'XZ-3094-2024', 'https://tukaani.org/xz-backdoor/', '5.6.2', '2024-04-04', 'Critical', 'M1051', 'Downgrade to 5.4.x or upgrade to clean 5.6.2.'),
('CVE-2024-21413', 'Microsoft', 'CVE-2024-21413', 'https://msrc.microsoft.com/update-guide/vulnerability/CVE-2024-21413', '16.0.5435.1000', '2024-02-13', 'Critical', 'M1049', 'Apply February 2024 cumulative update.'),
('CVE-2024-23897', 'Jenkins', '2024-01-24-LTS', 'https://www.jenkins.io/security/advisory/2024-01-24/', '2.426.3', '2024-01-24', 'High', 'M1042', 'Upgrade Jenkins LTS to 2.426.3 or weekly to 2.442.'),
('CVE-2024-1709', 'ConnectWise', 'CWE-CVE-2024-1709', 'https://www.connectwise.com/company/trust/security-bulletins/connectwise-screenconnect-23.9.8', '23.9.8', '2024-02-19', 'Critical', 'M1032', 'Upgrade to 23.9.8 or later. Cloud customers already patched.'),
('CVE-2024-27198', 'JetBrains', 'TC-2024-03', 'https://blog.jetbrains.com/teamcity/2024/03/teamcity-2023-11-4-is-out/', '2023.11.4', '2024-03-04', 'Critical', 'M1032', 'Upgrade to TeamCity 2023.11.4 or later.'),
('CVE-2024-24919', 'Check Point', 'sk182336', 'https://support.checkpoint.com/results/sk/sk182336', 'R81.20 Jumbo HFA T55', '2024-05-28', 'High', 'M1037', 'Apply hotfix; rotate VPN credentials.');

INSERT INTO aegis_iocs (ioc_type, value, first_seen, last_seen, source, confidence, tags, related_cve_id) VALUES
('sha256', 'a4c4f7f93eea0eccfd0acea1c63d4b2e8ec03ec4f4f3f99c2cbf91a1f7d92a99', '2024-03-29', '2024-04-05', 'malwarebazaar', 0.95, ARRAY['xz-backdoor','liblzma'], 'CVE-2024-3094'),
('url', 'https://malicious-c2-1.example.com/beacon', '2024-04-10', '2024-04-15', 'urlhaus', 0.88, ARRAY['lockbit','c2'], NULL),
('domain', 'rmm-update.example-attacker.net', '2024-02-22', '2024-03-05', 'threatfox', 0.92, ARRAY['screenconnect','exploitation'], 'CVE-2024-1709'),
('ip', '203.0.113.42', '2024-05-29', '2024-06-02', 'threatfox', 0.85, ARRAY['checkpoint-vpn','probing'], 'CVE-2024-24919'),
('sha256', 'b2e9a4c8d3f1e5a7c9b6d8e0f2a4c6b8d0e2f4a6c8b0d2e4f6a8c0b2d4e6f8a0', '2024-03-10', '2024-04-01', 'malwarebazaar', 0.91, ARRAY['lockbit','ransomware'], NULL);

-- ─── Threat Actors + Scores + Campaigns ───

INSERT INTO aegis_threat_actors (actor_id, display_name, aliases, actor_type, attribution_country, first_observed_at, last_active_at, motivation, sophistication, summary, mitre_group_id, reference_urls) VALUES
('APT29', 'APT29', ARRAY['Cozy Bear','Nobelium','Midnight Blizzard','The Dukes'], 'apt', 'RU', '2008-01-01', '2024-05-15', 'espionage', 'expert', 'Russian SVR-attributed state-sponsored actor. Targets government, NGOs, healthcare, and energy sectors. Known for long-term stealth operations and supply-chain attacks (SolarWinds, Microsoft 365 email theft 2024).', 'G0016', ARRAY['https://attack.mitre.org/groups/G0016/','https://www.microsoft.com/en-us/security/blog/2024/01/19/midnight-blizzard/']),
('LockBit', 'LockBit', ARRAY['LockBit 2.0','LockBit 3.0','LockBit Black'], 'ransomware', 'RU', '2019-09-01', '2024-04-30', 'financial', 'high', 'Most prolific ransomware-as-a-service operation 2022-2024. ~25% of all global ransomware attacks. Disrupted by Operation Cronos (Feb 2024) but reconstituted within weeks.', 'G1015', ARRAY['https://attack.mitre.org/groups/G1015/','https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-325a']),
('FIN7', 'FIN7', ARRAY['Carbon Spider','Carbanak Group','Anunak'], 'criminal', 'RU', '2013-01-01', '2024-03-20', 'financial', 'high', 'Financially-motivated group targeting retail, hospitality, restaurant sectors. Pivoted to ransomware affiliation (REvil, Conti, BlackBasta).', 'G0046', ARRAY['https://attack.mitre.org/groups/G0046/'])
ON CONFLICT (actor_id) DO NOTHING;

INSERT INTO aegis_threat_actor_scores (actor_id, capability_score, reach_score, recency_score, velocity_score, attribution_confidence, composite_score, actor_grade, actor_tier, last_updated) VALUES
('APT29', 95.0, 78.0, 88.0, 65.0, 0.92, 88.5, 'A', 'tier1', '2024-05-20'),
('LockBit', 82.0, 96.0, 91.0, 88.0, 0.85, 90.2, 'A', 'tier1', '2024-05-01'),
('FIN7', 75.0, 70.0, 72.0, 55.0, 0.78, 70.8, 'B', 'tier2', '2024-03-25')
ON CONFLICT (actor_id) DO NOTHING;

INSERT INTO aegis_threat_actor_campaigns (actor_id, campaign_name, start_date, end_date, target_sectors, target_geographies, summary, cve_ids_exploited, reference_urls) VALUES
('APT29', 'Microsoft 365 Senior Leadership Email Theft', '2023-11-01', '2024-01-12', ARRAY['technology','government'], ARRAY['US','UK'], 'Password spray + OAuth abuse against Microsoft senior leadership Office 365 accounts, exfiltrating emails for months before detection.', ARRAY[]::TEXT[], ARRAY['https://msrc.microsoft.com/blog/2024/01/microsoft-actions-following-attack-by-nation-state-actor-midnight-blizzard/']),
('LockBit', 'Operation Cronos Targets', '2023-01-01', '2024-02-19', ARRAY['healthcare','manufacturing','financial-services'], ARRAY['US','UK','EU','JP'], '2000+ ransomware victims across all sectors. ~$120M extorted over campaign. Disrupted by NCA-led Operation Cronos in Feb 2024.', ARRAY['CVE-2023-4966','CVE-2024-1709'], ARRAY['https://www.nationalcrimeagency.gov.uk/news/nca-leads-international-investigation-targeting-worlds-most-harmful-ransomware-group']);

INSERT INTO aegis_threat_actor_ttps (actor_id, mitre_tactic_id, mitre_technique_id, confidence, first_observed_at, source) VALUES
('APT29', 'TA0001', 'T1078.004', 0.95, '2023-11-15', 'mitre'),
('APT29', 'TA0006', 'T1110.003', 0.90, '2023-11-20', 'microsoft'),
('APT29', 'TA0009', 'T1114.002', 0.92, '2023-12-01', 'microsoft'),
('LockBit', 'TA0001', 'T1190', 0.93, '2023-03-10', 'cisa'),
('LockBit', 'TA0008', 'T1021.001', 0.88, '2023-04-15', 'mitre'),
('LockBit', 'TA0040', 'T1486', 0.99, '2023-01-15', 'mitre'),
('FIN7', 'TA0001', 'T1566.001', 0.85, '2022-06-01', 'mandiant'),
('FIN7', 'TA0005', 'T1027', 0.80, '2022-08-15', 'mandiant');

INSERT INTO aegis_threat_actor_targets (actor_id, org_name, industry, geography, attack_date, outcome) VALUES
('APT29', 'Microsoft Corporation', 'technology', 'US', '2023-11-15', 'compromised'),
('APT29', 'Hewlett Packard Enterprise', 'technology', 'US', '2024-01-30', 'compromised'),
('LockBit', 'Royal Mail', 'logistics', 'UK', '2023-01-10', 'compromised'),
('LockBit', 'Boeing', 'aerospace', 'US', '2023-10-27', 'partial'),
('FIN7', 'unnamed retail chain', 'retail', 'US', '2023-08-01', 'compromised');

-- ─── Incidents + Comps ───

INSERT INTO aegis_incidents (incident_id, organization, org_domain, industry, country, disclosed_at, incident_started_at, incident_ended_at, incident_type, initial_access_vector, actor_id, records_compromised, estimated_loss_usd, summary, reference_urls) VALUES
('INC-2024-MS365-MidnightBlizzard', 'Microsoft Corporation', 'microsoft.com', 'technology', 'US', '2024-01-19', '2023-11-15', '2024-01-12', 'data_breach', 'password_spray_oauth_abuse', 'APT29', 1, 50000000, 'APT29 (Midnight Blizzard) breached Microsoft corporate email systems via password spray against legacy non-production test tenant, then exfiltrated senior leadership emails and source code for ~2 months.', ARRAY['https://msrc.microsoft.com/blog/2024/01/microsoft-actions-following-attack-by-nation-state-actor-midnight-blizzard/']),
('INC-2024-CHANGE-Healthcare', 'Change Healthcare', 'changehealthcare.com', 'healthcare', 'US', '2024-02-21', '2024-02-12', '2024-03-13', 'ransomware', 'compromised_vpn_credentials', 'LockBit', 100000000, 2300000000, 'BlackCat/ALPHV (LockBit affiliate) ransomware on UnitedHealth subsidiary. ~$22M ransom paid. Caused weeks-long disruption to US healthcare prescription claims processing. 100M+ records exposed.', ARRAY['https://www.unitedhealthgroup.com/ns/changehealthcare.html']),
('INC-2024-CDK-Global', 'CDK Global', 'cdkglobal.com', 'software', 'US', '2024-06-19', '2024-06-19', '2024-07-04', 'ransomware', 'unknown', 'LockBit', 1, 1000000000, 'CDK Global SaaS ransomware impacting ~15,000 US car dealerships for 2+ weeks. ~$25M ransom reportedly paid. Estimated $1B+ industry-wide revenue loss.', ARRAY['https://www.bleepingcomputer.com/news/security/blackcat-ransomware-claims-attack-on-cdk-global/']),
('INC-2024-Snowflake-Mass', 'Snowflake (customers)', 'snowflake.com', 'technology', 'US', '2024-05-31', '2024-04-14', '2024-06-30', 'credential_stuffing', 'infostealer_credentials_no_mfa', NULL, 560000000, 200000000, 'Mass campaign against ~165 Snowflake customer tenants (Ticketmaster, Santander, AT&T, etc.) using credentials stolen by infostealers from customer employees. Snowflake itself uncompromised — failure to require MFA.', ARRAY['https://www.snowflake.com/blog/detecting-unauthorized-activity/'])
ON CONFLICT (incident_id) DO NOTHING;

-- JOIN-based inserts — avoid hardcoding SERIAL ids (which advance even on failed inserts).
INSERT INTO aegis_incident_attributes (incident_id, attribute_type, value_numeric, value_text, confidence)
SELECT i.id, a.attr_type, a.val_num, a.val_text, a.conf
FROM aegis_incidents i
JOIN (VALUES
  ('INC-2024-MS365-MidnightBlizzard', 'dwell_time_days', 59::float8, NULL::text, 0.95),
  ('INC-2024-MS365-MidnightBlizzard', 'blast_radius', 1::float8, 'corporate-tenant-only'::text, 0.90),
  ('INC-2024-CHANGE-Healthcare', 'dwell_time_days', 9::float8, NULL, 0.85),
  ('INC-2024-CHANGE-Healthcare', 'blast_radius', 100::float8, 'industry-wide-prescription-disruption'::text, 1.00),
  ('INC-2024-CDK-Global', 'dwell_time_days', 0::float8, 'sudden-encryption'::text, 0.90),
  ('INC-2024-CDK-Global', 'blast_radius', 100::float8, 'industry-wide-dealership-outage'::text, 0.95),
  ('INC-2024-Snowflake-Mass', 'dwell_time_days', 47::float8, NULL, 0.80),
  ('INC-2024-Snowflake-Mass', 'blast_radius', 85::float8, '165-tenants-affected'::text, 0.85)
) AS a(inc_key, attr_type, val_num, val_text, conf)
ON i.incident_id = a.inc_key
ON CONFLICT DO NOTHING;

INSERT INTO aegis_incident_ttps_observed (incident_id, mitre_tactic_id, mitre_technique_id, evidence_summary)
SELECT i.id, t.tactic, t.technique, t.evidence
FROM aegis_incidents i
JOIN (VALUES
  ('INC-2024-MS365-MidnightBlizzard', 'TA0001', 'T1078.004', 'Password spray against legacy test tenant'),
  ('INC-2024-MS365-MidnightBlizzard', 'TA0006', 'T1110.003', 'Distributed brute force via residential proxies'),
  ('INC-2024-MS365-MidnightBlizzard', 'TA0009', 'T1114.002', 'Email collection from compromised mailboxes via Graph API'),
  ('INC-2024-CHANGE-Healthcare', 'TA0001', 'T1078.001', 'Default/valid VPN credentials with no MFA'),
  ('INC-2024-CHANGE-Healthcare', 'TA0040', 'T1486', 'Data encrypted for impact across IT systems'),
  ('INC-2024-CDK-Global', 'TA0040', 'T1486', 'Ransomware encryption of SaaS infrastructure'),
  ('INC-2024-Snowflake-Mass', 'TA0001', 'T1078.001', 'Credentials harvested by infostealer on customer endpoints'),
  ('INC-2024-Snowflake-Mass', 'TA0009', 'T1530', 'Data from cloud storage object queries')
) AS t(inc_key, tactic, technique, evidence)
ON i.incident_id = t.inc_key
ON CONFLICT DO NOTHING;

-- ─── Defenses + Mappings ───

INSERT INTO aegis_defenses (defense_id, name, defense_type, vendor, cost_tier, complexity_tier, deployment_target, frameworks, summary, reference_urls) VALUES
('mfa-required', 'Mandatory Multi-Factor Authentication', 'mfa', 'multiple', 'low', 'low', 'identity', ARRAY['NIST CSF: PR.AC-7','CIS Control 6'], 'Require MFA for all user accounts, especially admin and remote access. Eliminates ~99% of account compromise attempts.', ARRAY['https://www.cisa.gov/MFA']),
('crowdstrike-edr', 'CrowdStrike Falcon EDR', 'edr', 'CrowdStrike', 'high', 'medium', 'endpoint', ARRAY['NIST CSF: DE.CM-7','MITRE D3-PM'], 'Cloud-native endpoint detection and response with behavioral analytics. Strong against living-off-the-land and ransomware encryption.', ARRAY['https://www.crowdstrike.com/products/endpoint-security/falcon-prevent/']),
('cloudflare-waf', 'Cloudflare WAF', 'waf', 'Cloudflare', 'low', 'low', 'network', ARRAY['NIST CSF: PR.AC-5','OWASP Top 10'], 'Reverse-proxy WAF with managed rulesets. Catches common injection and authentication bypass patterns.', ARRAY['https://www.cloudflare.com/application-services/products/waf/']),
('patch-mgmt-automated', 'Automated Patch Management (SCCM/Intune/Jamf)', 'patch_mgmt', 'Microsoft/Apple', 'mid', 'medium', 'endpoint', ARRAY['NIST CSF: PR.IP-12','CIS Control 7'], 'Automated patch deployment with phased rollout. Critical for KEV remediation within CISA-mandated deadlines.', ARRAY['https://www.cisa.gov/known-exploited-vulnerabilities-catalog']),
('veeam-immutable-backup', 'Veeam Immutable Backup', 'backup', 'Veeam', 'mid', 'medium', 'data', ARRAY['NIST CSF: PR.IP-4','CIS Control 11'], 'Immutable, air-gapped backups with cryptographic verification. Last-line defense against ransomware encryption.', ARRAY['https://www.veeam.com/']),
('phishing-training-quarterly', 'Quarterly Phishing Awareness Training', 'awareness_training', 'KnowBe4/Proofpoint', 'low', 'low', 'identity', ARRAY['NIST CSF: PR.AT-1'], 'Regular phishing simulations + targeted retraining for click-through users. Reduces click rate from ~30% baseline to ~5% with consistency.', ARRAY['https://www.knowbe4.com/'])
ON CONFLICT (defense_id) DO NOTHING;

INSERT INTO aegis_defense_mappings (defense_id, mapping_type, target_id, efficacy_score, evidence_url, notes) VALUES
(1, 'mitigates_technique', 'T1110.003', 0.99, NULL, 'Password spray defeated by MFA at first compromised credential.'),
(1, 'mitigates_technique', 'T1078.001', 0.95, NULL, 'Valid account use blocked at first interactive auth attempt.'),
(1, 'mitigates_technique', 'T1078.004', 0.85, NULL, 'Cloud account compromise blocked unless MFA is bypassed (e.g., session token theft).'),
(2, 'mitigates_technique', 'T1486', 0.92, NULL, 'Ransomware encryption behaviorally detected pre-completion.'),
(2, 'mitigates_technique', 'T1027', 0.80, NULL, 'Obfuscated payloads detected via behavioral patterns vs signature.'),
(3, 'mitigates_cve', 'CVE-2024-1709', 0.70, NULL, 'WAF rule deployed within 24h of disclosure for ScreenConnect auth bypass.'),
(3, 'mitigates_cve', 'CVE-2024-23897', 0.65, NULL, 'WAF rule for Jenkins CLI parser file read.'),
(4, 'mitigates_cve', 'CVE-2024-21413', 0.95, NULL, 'Microsoft cumulative update deployed automatically.'),
(4, 'mitigates_cve', 'CVE-2024-1709', 0.95, NULL, 'ConnectWise patch deployed via SCCM/Intune.'),
(5, 'mitigates_technique', 'T1486', 0.85, NULL, 'Recovery from immutable backup vs paying ransom.'),
(6, 'mitigates_technique', 'T1566.001', 0.65, NULL, 'Reduces phishing click rate via consistent training.');

-- ─── Compromised Orgs + Breach Disclosures ───

INSERT INTO aegis_compromised_orgs (org_name, org_domain, industry, country, state_region, breach_count, last_breach_at, total_records_compromised, has_active_ransom, enrichment_status) VALUES
('Change Healthcare', 'changehealthcare.com', 'healthcare', 'US', 'TN', 1, '2024-02-21', 100000000, FALSE, 'enriched'),
('Microsoft Corporation', 'microsoft.com', 'technology', 'US', 'WA', 2, '2024-01-19', 1, FALSE, 'enriched'),
('CDK Global', 'cdkglobal.com', 'software', 'US', 'IL', 1, '2024-06-19', 1, FALSE, 'enriched'),
('Ticketmaster', 'ticketmaster.com', 'entertainment', 'US', 'CA', 1, '2024-05-28', 560000000, FALSE, 'enriched'),
('AT&T', 'att.com', 'telecommunications', 'US', 'TX', 2, '2024-04-12', 73000000, FALSE, 'enriched'),
('Santander Bank', 'santander.com', 'financial-services', 'ES', NULL, 1, '2024-05-14', 30000000, FALSE, 'enriched')
ON CONFLICT (org_domain) DO NOTHING;

INSERT INTO aegis_breach_disclosures (org_id, disclosed_at, source, source_url, breach_type, records_compromised, attestation_quality, related_cve_ids) VALUES
(1, '2024-02-21', 'sec_8k', 'https://www.sec.gov/Archives/edgar/data/731766/000073176624000048/unh-20240221.htm', 'ransomware', 100000000, 'high', ARRAY[]::TEXT[]),
(2, '2024-01-19', 'sec_8k', 'https://www.sec.gov/Archives/edgar/data/789019/000119312524012064/d693019d8k.htm', 'data_breach', 1, 'high', ARRAY[]::TEXT[]),
(3, '2024-06-19', 'news', 'https://www.bleepingcomputer.com/news/security/blackcat-ransomware-claims-attack-on-cdk-global/', 'ransomware', 1, 'high', ARRAY[]::TEXT[]),
(4, '2024-05-28', 'news', 'https://www.bleepingcomputer.com/news/security/ticketmaster-confirms-massive-breach-after-stolen-data-for-sale-online/', 'data_breach', 560000000, 'medium', ARRAY[]::TEXT[]),
(5, '2024-04-12', 'news', 'https://www.att.com/support/article/wireless/KM1515113/', 'data_breach', 73000000, 'high', ARRAY[]::TEXT[]),
(6, '2024-05-14', 'press_release', 'https://www.santander.com/en/press-room/press-releases/2024/05/banco-santander-informs-of-a-cybersecurity-incident', 'data_breach', 30000000, 'medium', ARRAY[]::TEXT[]);

-- ─── Advisories + Geo Events ───

INSERT INTO aegis_advisories (advisory_id, issuer, issuer_geography, published_at, severity, title, summary, affected_cves, affected_products, advisory_url) VALUES
('CISA-AA24-060A', 'cisa', 'us', '2024-02-29', 'critical', '#StopRansomware: Phobos Ransomware', 'Joint advisory on Phobos ransomware tactics targeting state/local government, education, healthcare.', ARRAY['CVE-2023-4966'], ARRAY['various'], 'https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-060a'),
('CISA-AA24-241A', 'cisa', 'us', '2024-08-28', 'critical', 'Iran-Based Cyber Actors Enabling Ransomware Attacks on US Organizations', 'Iranian APT actors compromising US targets and selling access to ransomware affiliates.', ARRAY['CVE-2024-3400','CVE-2024-24919'], ARRAY['Palo Alto PAN-OS','Check Point'], 'https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-241a'),
('NCSC-2024-XZ', 'ncsc_uk', 'uk', '2024-04-02', 'critical', 'XZ Utils Backdoor (CVE-2024-3094)', 'UK NCSC advisory on the XZ Utils supply-chain backdoor.', ARRAY['CVE-2024-3094'], ARRAY['liblzma'], 'https://www.ncsc.gov.uk/news/xz-utils-backdoor');

INSERT INTO aegis_advisory_signals (advisory_id, signal_type, signal_strength) VALUES
(1, 'active_exploitation', 0.95),
(1, 'widespread_impact', 0.85),
(2, 'active_exploitation', 0.92),
(2, 'kev_addition', 1.0),
(3, 'zero_day', 1.0),
(3, 'widespread_impact', 0.90);

INSERT INTO aegis_geo_threat_events (event_type, latitude, longitude, country, region, city, severity, actor_id, cve_id, occurred_at, summary, source) VALUES
('attack', 36.1627, -86.7816, 'US', 'TN', 'Nashville', 'critical', 'LockBit', NULL, '2024-02-21', 'Change Healthcare ransomware attack disclosed.', 'sec_8k'),
('attack', 47.6062, -122.3321, 'US', 'WA', 'Redmond', 'high', 'APT29', NULL, '2024-01-19', 'Microsoft corporate email breach disclosed.', 'sec_8k'),
('attack', 41.8781, -87.6298, 'US', 'IL', 'Chicago', 'critical', 'LockBit', NULL, '2024-06-19', 'CDK Global ransomware attack disclosed.', 'news'),
('disclosure', 51.5074, -0.1278, 'UK', NULL, 'London', 'critical', NULL, 'CVE-2024-3094', '2024-04-02', 'NCSC-UK XZ Utils backdoor advisory.', 'ncsc_uk'),
('takedown', 51.5074, -0.1278, 'UK', NULL, 'London', 'high', 'LockBit', NULL, '2024-02-19', 'NCA Operation Cronos takes down LockBit infrastructure.', 'nca'),
('disclosure', 38.9072, -77.0369, 'US', 'DC', 'Washington', 'critical', NULL, 'CVE-2024-24919', '2024-05-30', 'CISA KEV addition: Check Point Quantum VPN info disclosure.', 'cisa');

-- ─── Pipeline Alerts ───

INSERT INTO aegis_pipeline_alerts (alert_type, entity_kind, entity_id, severity, headline, summary, published_at, status) VALUES
('new_kev', 'cve', 'CVE-2024-24919', 'critical', 'CISA KEV: Check Point Quantum VPN Information Disclosure (CVE-2024-24919)', 'CISA added CVE-2024-24919 to KEV with 21-day deadline. Active exploitation observed in wild.', '2024-05-30', 'new'),
('new_cve', 'cve', 'CVE-2024-3094', 'critical', 'CVE-2024-3094: XZ Utils SSH Backdoor', 'Malicious code in liblzma 5.6.0/5.6.1 allowing unauthorized SSH access. CVSS 10.0.', '2024-03-29', 'triaging'),
('new_breach', 'incident', 'INC-2024-CHANGE-Healthcare', 'critical', 'Change Healthcare Ransomware — 100M+ records', 'BlackCat/ALPHV ransomware on UnitedHealth subsidiary. Estimated $2.3B impact.', '2024-02-21', 'escalated'),
('new_cve', 'cve', 'CVE-2024-27198', 'critical', 'CVE-2024-27198: JetBrains TeamCity Auth Bypass', 'Authentication bypass via alternative path. Active exploitation confirmed.', '2024-03-04', 'resolved');
