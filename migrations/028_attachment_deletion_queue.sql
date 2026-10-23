-- Durable private-file cleanup. Applied migrations remain immutable.
CREATE TABLE attachment_file_deletions (
  pathname TEXT PRIMARY KEY,
  attachment_id UUID NOT NULL,
  owner_email TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX attachment_file_deletions_due ON attachment_file_deletions(next_attempt_at);
CREATE INDEX attachment_file_deletions_owner ON attachment_file_deletions(owner_email, attachment_id);

CREATE FUNCTION queue_deleted_attachment_files() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    INSERT INTO attachment_file_deletions(pathname,attachment_id,owner_email)
      SELECT DISTINCT path, NEW.id, NEW.owner_email
      FROM unnest(ARRAY[OLD.blob_pathname,OLD.model_pathname,NEW.blob_pathname,NEW.model_pathname]) AS path
      WHERE path IS NOT NULL AND path <> '' ON CONFLICT(pathname) DO NOTHING;
    NEW.status := 'deleted';
    NEW.filename := 'Deleted attachment';
    NEW.parsed_text := NULL; NEW.summary := NULL; NEW.structured := '{}'::jsonb;
    NEW.sha256 := NULL; NEW.error_message := NULL;
    NEW.blob_url := NULL; NEW.blob_pathname := NULL;
    NEW.model_url := NULL; NEW.model_pathname := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attachment_deletion_cleanup BEFORE UPDATE ON agent_attachments
  FOR EACH ROW EXECUTE FUNCTION queue_deleted_attachment_files();
-- Upgrade older soft deletions as well, without reviving their access.
UPDATE agent_attachments SET status='deleted' WHERE deleted_at IS NOT NULL;
