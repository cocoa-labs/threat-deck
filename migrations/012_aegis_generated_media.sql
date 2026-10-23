-- Migration: 012_aegis_generated_media
-- Created: 2026-05-25
-- Phase: 14.A.1 — visual generation foundation
--
-- Tracks all AI-generated media (images now, video Tier C). Links to
-- aegis_outbound_drafts (for Tier B cron-staged auto-publish) and
-- aegis_outbound_log (for dedup against actual published outbound).
--

CREATE TABLE IF NOT EXISTS aegis_generated_media (
  id BIGSERIAL PRIMARY KEY,
  outbound_log_id INTEGER REFERENCES aegis_outbound_log(id) ON DELETE SET NULL,
  draft_id INTEGER REFERENCES aegis_outbound_drafts(id) ON DELETE CASCADE,
  entity_kind TEXT,
  entity_id TEXT,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video')),
  style_tag TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_used TEXT,
  blob_url TEXT,
  blob_size_bytes BIGINT,
  cost_usd NUMERIC(8, 4),
  generation_duration_ms INTEGER,
  review_count INTEGER NOT NULL DEFAULT 0,
  review_outcome TEXT CHECK (review_outcome IN ('pass', 'fail') OR review_outcome IS NULL),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'published', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  source_agent_message_ts BIGINT,
  source_agent_message_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_gm_outbound_log
  ON aegis_generated_media(outbound_log_id);

CREATE INDEX IF NOT EXISTS idx_gm_entity
  ON aegis_generated_media(entity_kind, entity_id) WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_status
  ON aegis_generated_media(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_style
  ON aegis_generated_media(style_tag, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_msg_hash
  ON aegis_generated_media(source_agent_message_hash) WHERE source_agent_message_hash IS NOT NULL;

-- View for Tier A operator-IMG dedup: same agent message + same style = same image
CREATE OR REPLACE VIEW aegis_v_generated_media_by_message AS
  SELECT
    source_agent_message_hash AS message_hash,
    style_tag,
    MAX(id) AS latest_id,
    MAX(created_at) AS latest_at,
    COUNT(*) AS generation_count
  FROM aegis_generated_media
  WHERE source_agent_message_hash IS NOT NULL
  GROUP BY source_agent_message_hash, style_tag;
