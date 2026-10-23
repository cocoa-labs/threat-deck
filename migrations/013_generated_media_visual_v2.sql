-- Migration: 013_generated_media_visual_v2
-- Created: 2026-05-26
-- Phase: 14.A.2 -- IMG Button V2 model-rendered infographics
--
-- Persists the structured VisualBrief and source context used to generate
-- each model-rendered intelligence infographic.

ALTER TABLE aegis_generated_media
  ADD COLUMN IF NOT EXISTS visual_schema_version TEXT,
  ADD COLUMN IF NOT EXISTS visual_payload JSONB,
  ADD COLUMN IF NOT EXISTS source_context JSONB;

CREATE INDEX IF NOT EXISTS idx_gm_visual_schema
  ON aegis_generated_media(visual_schema_version, created_at DESC)
  WHERE visual_schema_version IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_visual_payload_gin
  ON aegis_generated_media USING GIN (visual_payload)
  WHERE visual_payload IS NOT NULL;
