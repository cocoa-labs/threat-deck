import type { ReactElement } from 'react';

/**
 * Transport-agnostic email types. Shared by the dispatcher (`resend.ts`) and
 * every transport (`transports/gmail.ts`, the inline Resend transport). Kept in
 * its own module so transports can import the contract without a circular import
 * back through the dispatcher.
 */

/** A file attachment. `content` is base64-encoded. */
export type EmailAttachment = {
  filename: string;
  /** base64-encoded file content */
  content: string;
  /** MIME type; derived from the filename if omitted. */
  contentType?: string;
};

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  react: ReactElement;
  /** Optional idempotency key (Resend dedups on it; ignored by Gmail). */
  idempotencyKey?: string;
  /** Override the resolved sender. */
  from?: string;
  /** CC recipients — visible to all recipients. */
  cc?: string | string[];
  /** BCC recipients — hidden from other recipients. */
  bcc?: string | string[];
  /** Plaintext fallback body. Auto-rendered from `react` if omitted. */
  text?: string;
  /** File attachments. */
  attachments?: EmailAttachment[];
  /** RFC 5322 In-Reply-To header (Message-ID being replied to) — for in-thread replies. */
  inReplyTo?: string;
  /** RFC 5322 References header (chain of Message-IDs). */
  references?: string;
  /** Provider thread id (Gmail `threadId`) to group the reply under an existing thread. */
  threadId?: string;
  /** Reply-To address — where recipient replies should land (the inbound sink mailbox). */
  replyTo?: string;
  /** Extra raw headers to set on the outgoing message. */
  headers?: Record<string, string>;
  /**
   * When set, this email is TRACKED: the dispatcher stamps a stable Message-ID
   * + Reply-To and records the send in `aegis_email_threads` so inbound replies
   * can be matched back to it. Omit for auth/magic-link (those aren't replied to).
   */
  track?: {
    /** 'digest' | 'alert' | 'agent_response' | 'agent_conversation' | 'escalation' | 'reply' */
    source: string;
    entityKind?: string | null;
    entityId?: string | null;
    messageTimestamp?: number | null;
  };
};

export type SendEmailResult = {
  ok: boolean;
  id?: string;
  error?: string;
  /** The resolved sender address actually used (or that would have been used). */
  from: string;
  /**
   * True only for Resend's shared sandbox sender, which delivers ONLY to the
   * Resend account owner. Always false for Gmail (which delivers to anyone).
   */
  sandbox: boolean;
  /** Provider thread id of the sent message, when available (Gmail). */
  threadId?: string;
};
