-- Migration: 014_generated_media_provider_state
-- Created: 2026-05-27
-- Phase: 14.C/D -- provider-side async media job state
--
-- Adds generic provider job tracking for async media backends such as
-- Higgsfield Seedance. Image generation can ignore these columns; video
-- generation uses them to persist the external job id/status/payload while
-- the client polls /api/outbound/generated-media/:id.

ALTER TABLE aegis_generated_media
  ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS provider_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_gm_provider_job
  ON aegis_generated_media(provider, provider_job_id)
  WHERE provider_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_provider_status
  ON aegis_generated_media(provider, provider_status, created_at DESC)
  WHERE provider_status IS NOT NULL;
