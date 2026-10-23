-- Let already-issued 15-minute upload grants expire before claiming final deletion.
ALTER TABLE attachment_file_deletions ADD COLUMN not_before TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE FUNCTION attachment_cleanup_window() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE earliest TIMESTAMPTZ;
BEGIN
  SELECT greatest(created_at+interval '16 minutes', CASE WHEN status='processing' THEN NOW()+interval '2 minutes' ELSE NOW() END)
    INTO earliest FROM agent_attachments WHERE id=NEW.attachment_id AND owner_email=NEW.owner_email;
  NEW.not_before := greatest(NEW.not_before, earliest);
  NEW.next_attempt_at := greatest(NEW.next_attempt_at, NEW.not_before);
  RETURN NEW;
END $$;
CREATE TRIGGER attachment_cleanup_window BEFORE INSERT ON attachment_file_deletions
  FOR EACH ROW EXECUTE FUNCTION attachment_cleanup_window();
