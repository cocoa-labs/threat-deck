-- Migration: 015_agent_attachments
-- Created: 2026-05-27
-- Phase: Max Agent Attachments -- chat-scoped uploaded evidence

CREATE TABLE IF NOT EXISTS agent_attachments (
  id UUID PRIMARY KEY,
  owner_email TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'chat' CHECK (scope IN ('chat')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'docx', 'spreadsheet', 'text')),
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'uploaded', 'processing', 'ready', 'failed', 'deleted')),
  blob_url TEXT,
  blob_pathname TEXT,
  model_url TEXT,
  model_pathname TEXT,
  model_content_type TEXT,
  model_size_bytes BIGINT,
  sha256 TEXT,
  parsed_text TEXT,
  structured JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_attachments_owner_status
  ON agent_attachments(owner_email, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_attachments_owner_created
  ON agent_attachments(owner_email, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_attachments_blob_pathname
  ON agent_attachments(blob_pathname)
  WHERE blob_pathname IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_attachments_sha256
  ON agent_attachments(sha256)
  WHERE sha256 IS NOT NULL;

CREATE OR REPLACE FUNCTION set_agent_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_attachments_updated_at ON agent_attachments;
CREATE TRIGGER trg_agent_attachments_updated_at
BEFORE UPDATE ON agent_attachments
FOR EACH ROW
EXECUTE FUNCTION set_agent_attachments_updated_at();
