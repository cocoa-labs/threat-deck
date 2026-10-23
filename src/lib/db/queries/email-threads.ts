import { query } from '../client';

/**
 * Registry of OUR sent emails (the email twin of `aegis_x_posts`). Lets the
 * inbound reader match a reply back to the thread we started — by Gmail
 * `threadId` (Gmail transport) or by our RFC Message-ID echoed in the reply's
 * In-Reply-To/References (Resend transport). Written by `sendEmail()` on
 * success for tracked emails; read by the reply-check tool + panel.
 */

export interface EmailThreadRow {
  id: string;
  message_id: string;
  provider_id: string | null;
  gmail_thread_id: string | null;
  recipients: string[];
  subject: string | null;
  source: string;
  entity_kind: string | null;
  entity_id: string | null;
  message_timestamp: string | null;
  sent_at: string;
  last_checked_at: string | null;
  reply_count: number;
}

/**
 * Record one of OUR sent emails. Never throws — a registry write must not break
 * the actual send (callers `void recordSentEmail(...)`). Idempotent on the
 * unique message_id.
 */
export async function recordSentEmail(params: {
  messageId: string;
  providerId?: string | null;
  gmailThreadId?: string | null;
  recipients: string[];
  subject?: string | null;
  source: string;
  entityKind?: string | null;
  entityId?: string | null;
  messageTimestamp?: number | null;
}): Promise<void> {
  if (!params.messageId) return;
  try {
    await query(
      `INSERT INTO aegis_email_threads
         (message_id, provider_id, gmail_thread_id, recipients, subject,
          source, entity_kind, entity_id, message_timestamp)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       ON CONFLICT (message_id) DO UPDATE SET
         provider_id = COALESCE(EXCLUDED.provider_id, aegis_email_threads.provider_id),
         gmail_thread_id = COALESCE(EXCLUDED.gmail_thread_id, aegis_email_threads.gmail_thread_id)`,
      [
        params.messageId,
        params.providerId ?? null,
        params.gmailThreadId ?? null,
        JSON.stringify(params.recipients ?? []),
        params.subject ?? null,
        params.source,
        params.entityKind ?? null,
        params.entityId ?? null,
        params.messageTimestamp ?? null,
      ],
    );
  } catch (err) {
    console.warn(
      '[email-threads] recordSentEmail failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function getRecentSentEmails(limit = 20): Promise<EmailThreadRow[]> {
  try {
    const { rows } = await query<EmailThreadRow>(
      'SELECT * FROM aegis_email_threads ORDER BY sent_at DESC LIMIT $1',
      [limit],
    );
    return rows;
  } catch (err) {
    console.warn(
      '[email-threads] getRecentSentEmails failed:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function touchEmailChecked(messageId: string, replyCount: number): Promise<void> {
  try {
    await query(
      'UPDATE aegis_email_threads SET last_checked_at = NOW(), reply_count = $2 WHERE message_id = $1',
      [messageId, replyCount],
    );
  } catch (err) {
    console.warn(
      '[email-threads] touchEmailChecked failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
