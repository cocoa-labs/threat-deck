ALTER TABLE aegis_generated_media ADD COLUMN IF NOT EXISTS owner_email text;
CREATE INDEX IF NOT EXISTS generated_media_owner_idx ON aegis_generated_media(owner_email, id);
-- Existing rows intentionally remain unowned until an administrator reviews
-- them. Never infer a private file's owner from an agent-authored message.
