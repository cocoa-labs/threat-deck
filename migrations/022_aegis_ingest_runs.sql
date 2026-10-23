-- Migration: aegis_ingest_runs
-- Created: 2026-06-07
--
-- This migration runs once and is recorded in the schema_migrations table.
-- Make it idempotent (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING, etc.) for safety against
-- accidental re-runs.
--
-- For schema changes that need a rollback, also create
-- NNN_aegis_ingest_runs.down.sql in this directory. The runner does not auto-
-- apply down migrations; rollback is a manual operation.

-- BEGIN MIGRATION
CREATE TABLE IF NOT EXISTS aegis_ingest_runs (
  source TEXT PRIMARY KEY,              -- 'cves' | 'kev' | 'iocs' | 'advisories' | 'breaches'
  last_cursor TEXT,                     -- NVD lastModStartDate ISO for delta windows; null for full-catalog sources
  last_run_at TEXT,
  last_success_at TEXT,
  last_count INTEGER DEFAULT 0,
  last_error TEXT,
  updated_at TEXT DEFAULT TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
-- END MIGRATION
