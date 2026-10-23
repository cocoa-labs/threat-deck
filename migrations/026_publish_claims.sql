CREATE TABLE IF NOT EXISTS security_publish_claims (
  draft_id bigint PRIMARY KEY REFERENCES aegis_outbound_drafts(id),
  claimed_at timestamptz NOT NULL DEFAULT now()
);
-- Claims survive uncertain provider responses. An operator must review and
-- create a new draft to retry; never silently replay an external publication.
