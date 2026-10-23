-- Migration: 016_agent_post_draft_type
-- Created: 2026-05-28
-- Phase: 14.x — conversational X posting
--
-- Adds 'agent_post' to the aegis_outbound_drafts.draft_type CHECK so the
-- in-app `post_to_x` agent tool (and the unified "Post to X" button) can stage
-- operator-initiated threads/singles through the SAME approval → publish
-- pipeline as the autonomous Cyber Wire generators. Keeps the SQL CHECK in
-- sync with src/lib/outbound/constants.ts DRAFT_TYPES (CLAUDE.md migration
-- discipline — new migration, never edit an applied one).

ALTER TABLE aegis_outbound_drafts
  DROP CONSTRAINT IF EXISTS aegis_outbound_drafts_draft_type_check;

ALTER TABLE aegis_outbound_drafts
  ADD CONSTRAINT aegis_outbound_drafts_draft_type_check
  CHECK (draft_type IN (
    'daily_brief',
    'breaking',
    'weekly_deepdive',
    'patch_thread',
    'predictions_thread',
    'agent_post'
  ));
