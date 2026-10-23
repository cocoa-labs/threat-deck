-- Migration: 020_x_posts
-- Created: 2026-06-07
-- Phase: X detour — our-posts registry
--
-- Durable record of OUR posted X threads. The root tweet id == the conversation_id
-- on X, which is what reply-detection queries (`conversation_id:<root>`). Written
-- by BOTH publish paths (the background job path via postCore, and the
-- approval-queue path via publishTwitter — whose root id was previously dropped).
-- Also powers permalinks. Idempotent upsert on the unique root id.

CREATE TABLE IF NOT EXISTS aegis_x_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_tweet_id TEXT NOT NULL UNIQUE,    -- == conversation_id on X
  tweet_ids JSONB NOT NULL DEFAULT '[]', -- every tweet id in the thread, in order
  handle TEXT,                           -- posting account handle (no @)
  source TEXT NOT NULL,                  -- 'job' | 'approval_queue'
  message_timestamp BIGINT,              -- originating Max message (ms epoch), if any
  primary_text TEXT,
  posted_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,           -- last reply-scan time
  reply_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_x_posts_posted ON aegis_x_posts(posted_at DESC);
