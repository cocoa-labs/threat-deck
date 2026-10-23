-- Migration: 017_outbound_x_post_jobs
-- Created: 2026-05-29
-- Phase: 14.x — reload-safe background "Post to X"
--
-- Backs the non-blocking, reload-safe X posting job. The manual "Post to X"
-- modal used to run the whole compose → image-gen (up to 6 min) → publish chain
-- inside React state, blocking the UI. We now persist the job here and advance
-- it via a poll-driven state machine (the GET status endpoint IS the worker,
-- mirroring how video generation advances on each poll). State survives page
-- reloads because the truth lives in this table, not in the browser.
--
-- generated_media_id / outbound_log_id are SOFT references (plain ids, no FK)
-- to avoid cross-table type-match coupling; the rows they point at own their
-- own lifecycle. CLAUDE.md migration discipline — new migration, never edit an
-- applied one.

CREATE TABLE IF NOT EXISTS aegis_x_post_jobs (
  id                  BIGSERIAL PRIMARY KEY,
  job_token           TEXT        NOT NULL UNIQUE,
  actor_email         TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','generating_image','posting','posted','failed','needs_reconnect')),
  publish_mode        TEXT        NOT NULL
    CHECK (publish_mode IN ('single','two_post')),
  reply_mode          TEXT        NOT NULL DEFAULT 'text'
    CHECK (reply_mode IN ('text','latest_image','generate_image','latest_video')),
  primary_text        TEXT        NOT NULL,
  reply_text          TEXT,
  source_url          TEXT,
  style_tag           TEXT,
  image_blob_url      TEXT,
  video_blob_url      TEXT,
  generated_media_id  BIGINT,
  message_timestamp   BIGINT      NOT NULL,
  entity_kind         TEXT,
  entity_id           TEXT,
  source_context      JSONB,
  tweet_ids           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  error_code          TEXT,
  error_message       TEXT,
  outbound_log_id     BIGINT,
  attempts            INTEGER     NOT NULL DEFAULT 0,
  lease_until         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

-- Powers list-active (resume-on-mount) + the reaper sweep: only non-terminal rows.
CREATE INDEX IF NOT EXISTS idx_xpj_actor_active
  ON aegis_x_post_jobs (actor_email, created_at DESC)
  WHERE status NOT IN ('posted','failed','needs_reconnect');

-- Reaper scan across all owners for stalled non-terminal jobs.
CREATE INDEX IF NOT EXISTS idx_xpj_active_updated
  ON aegis_x_post_jobs (updated_at)
  WHERE status NOT IN ('posted','failed','needs_reconnect');
