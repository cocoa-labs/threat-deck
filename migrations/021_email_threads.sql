-- Migration: 021_email_threads
-- Created: 2026-06-07
-- Phase: Email detour — sent-email registry (the email twin of aegis_x_posts)
--
-- Durable record of OUR sent emails so inbound replies can be matched back to
-- the thread we started. The matching key depends on transport:
--   - Gmail transport → gmail_thread_id (send + receive share one Workspace
--     mailbox, so the reply lands in the same Gmail thread).
--   - Resend transport → message_id (our RFC 5322 Message-ID); the recipient's
--     reply echoes it in In-Reply-To / References, which the reader matches.
-- Written by sendEmail() on success for every TRACKED email (digest, alert,
-- agent response, agent conversation, escalation, reply). Idempotent upsert on
-- the unique message_id. Reply detection stays dormant until the Gmail reader
-- is granted the gmail.readonly scope — this table fills regardless.

CREATE TABLE IF NOT EXISTS aegis_email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL UNIQUE,        -- our RFC 5322 Message-ID (<cocoa-…@domain>)
  provider_id TEXT,                       -- Resend id or Gmail message id (provider's own)
  gmail_thread_id TEXT,                   -- Gmail threadId when sent via the Gmail transport
  recipients JSONB NOT NULL DEFAULT '[]', -- to + cc + bcc addresses, in order
  subject TEXT,
  source TEXT NOT NULL,                   -- 'digest' | 'alert' | 'agent_response' | 'agent_conversation' | 'escalation' | 'reply'
  entity_kind TEXT,                       -- mirrors aegis_outbound_log (cve / breach / agent_conversation / …)
  entity_id TEXT,
  message_timestamp BIGINT,               -- originating Max message (ms epoch), if any
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,            -- last reply-scan time
  reply_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_email_threads_sent ON aegis_email_threads(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_threads_gthread ON aegis_email_threads(gmail_thread_id);
