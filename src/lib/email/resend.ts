import { randomUUID } from 'node:crypto';
import { Resend } from 'resend';
import { isCapabilityEnabled } from '@/lib/security/capabilities';
import { recordSentEmail } from '../db/queries/email-threads';
import { gmailSenderAddress, sendViaGmail } from './transports/gmail';
import type { SendEmailInput, SendEmailResult } from './types';

/**
 * Outbound email dispatcher for Cocoa AI Threat Deck.
 *
 * Despite the filename, this is the provider-agnostic entry point: every caller
 * (the email_conversation tool, digest, alerts, escalation, "EMAIL ME", and the
 * NextAuth magic-link provider) imports `sendEmail` from here. It dispatches on
 * `EMAIL_PROVIDER`:
 *   - `gmail`  → Gmail API as Max's own mailbox (delivers to anyone; see transports/gmail.ts)
 *   - `resend` → Resend/SES (default; kept as a config-flip fallback)
 *
 * Both transports honor the same `SendEmailInput → SendEmailResult` contract and
 * are fail-soft: they return `{ ok: false, error }` rather than throwing, so the
 * auth magic-link provider's error handling and outbound dedup keep working.
 */

// Re-export the shared contract so existing `@/lib/email/resend` imports keep working.
export type { EmailAttachment, SendEmailInput, SendEmailResult } from './types';

/** Selected transport. Defaults to 'resend' for back-compat. */
function provider(): 'gmail' | 'resend' {
  return process.env.EMAIL_PROVIDER?.trim().toLowerCase() === 'gmail' ? 'gmail' : 'resend';
}

// ─────────────────────────────────────────────────────────────────────────────
// Resend transport (inline)
// ─────────────────────────────────────────────────────────────────────────────

let cachedClient: Resend | null | undefined;

function getClient(): Resend | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    cachedClient = null;
    return null;
  }
  cachedClient = new Resend(apiKey);
  return cachedClient;
}

/** Resend's shared sandbox sender — only delivers to the Resend account owner's own address. */
const SANDBOX_FROM = 'onboarding@resend.dev';

function resendDefaultFrom(): string {
  // `||` (not `??`) so empty-string env values still fall back to the sandbox —
  // `.env` parsers turn `RESEND_FROM_EMAIL=` into "" which is not nullish.
  return process.env.RESEND_FROM_EMAIL?.trim() || `Cocoa AI <${SANDBOX_FROM}>`;
}

/** Drop nullish / blank / empty-array recipient fields so Resend never sees them. */
function normalizeRecipientField(
  value: string | string[] | undefined,
): string | string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => v.trim()).filter((v) => v.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function sendViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  const from = input.from ?? resendDefaultFrom();
  const sandbox = from.toLowerCase().includes(SANDBOX_FROM);
  const client = getClient();
  if (!client) {
    console.warn('[email/resend] RESEND_API_KEY not set — email skipped', {
      subject: input.subject,
      to: input.to,
    });
    return { ok: false, error: 'RESEND_API_KEY not set — email skipped', from, sandbox };
  }

  try {
    const cc = normalizeRecipientField(input.cc);
    const bcc = normalizeRecipientField(input.bcc);
    const headers: Record<string, string> = {
      ...(input.inReplyTo ? { 'In-Reply-To': input.inReplyTo } : {}),
      ...(input.references ? { References: input.references } : {}),
      ...(input.headers ?? {}),
    };
    const payload = {
      from,
      to: input.to,
      subject: input.subject,
      react: input.react,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };

    const options = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined;
    const result = await client.emails.send(payload, options);

    if (result.error) {
      const msg = result.error.message ?? String(result.error);
      console.error('[email/resend] Send failed:', msg);
      return { ok: false, error: msg, from, sandbox };
    }
    return { ok: true, id: result.data?.id, from, sandbox };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email/resend] Unexpected error:', msg);
    return { ok: false, error: msg, from, sandbox };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider-agnostic public API
// ─────────────────────────────────────────────────────────────────────────────

/** The sender address that `sendEmail` would use right now (for pre-send reporting). */
export function senderAddress(): string {
  return provider() === 'gmail' ? gmailSenderAddress() || resendDefaultFrom() : resendDefaultFrom();
}

/**
 * True only when the active transport is Resend AND its sender is the shared
 * sandbox (which delivers only to the account owner). Always false for Gmail,
 * which delivers to any recipient. Callers use this to avoid reporting an
 * undeliverable send as delivered.
 */
export function isSandboxSender(from?: string): boolean {
  if (provider() === 'gmail') return false;
  return (from ?? resendDefaultFrom()).toLowerCase().includes(SANDBOX_FROM);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reply tracking (Step 1 — email detour)
// ─────────────────────────────────────────────────────────────────────────────

/** The mailbox recipients should reply to (read by the Gmail inbound reader). */
function replySinkAddress(): string | undefined {
  const sink = process.env.EMAIL_REPLY_TO?.trim();
  return sink && sink.length > 0 ? sink : undefined;
}

/** Domain for our generated Message-IDs — derived from the reply sink / sender. */
function messageIdDomain(): string {
  const source =
    replySinkAddress() ?? process.env.RESEND_FROM_EMAIL ?? process.env.GMAIL_SENDER ?? '';
  const m = source.match(/@([^>\s]+)/);
  return m?.[1]?.trim() || 'localhost';
}

/** A stable RFC 5322 Message-ID we control, so inbound replies are matchable. */
function makeMessageId(): string {
  return `<cocoa-${randomUUID()}@${messageIdDomain()}>`;
}

/** Read a caller-provided Message-ID header (any casing), if present. */
function existingMessageId(headers?: Record<string, string>): string | undefined {
  if (!headers) return undefined;
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'message-id' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function asArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
}

export async function sendEmail(
  input: SendEmailInput,
  purpose: 'outbound' | 'authentication' = 'outbound',
): Promise<SendEmailResult> {
  if (purpose !== 'authentication' && !isCapabilityEnabled('email'))
    return {
      ok: false,
      error: 'capability_disabled:email',
      from: senderAddress(),
      sandbox: isSandboxSender(),
    };
  const track = input.track;
  // Untracked sends (e.g. the auth magic-link) go straight through unchanged.
  if (!track) {
    return provider() === 'gmail' ? sendViaGmail(input) : sendViaResend(input);
  }

  // Tracked threat email: stamp a Reply-To + a stable Message-ID we can match
  // inbound replies against, then record the send in the registry on success.
  const messageId = existingMessageId(input.headers) ?? makeMessageId();
  const replyTo = input.replyTo ?? replySinkAddress();
  const prepared: SendEmailInput = {
    ...input,
    ...(replyTo ? { replyTo } : {}),
    headers: { ...(input.headers ?? {}), 'Message-ID': messageId },
  };

  const result =
    provider() === 'gmail' ? await sendViaGmail(prepared) : await sendViaResend(prepared);

  if (result.ok) {
    void recordSentEmail({
      messageId,
      providerId: result.id ?? null,
      gmailThreadId: result.threadId ?? null,
      recipients: [...asArray(input.to), ...asArray(input.cc), ...asArray(input.bcc)],
      subject: input.subject,
      source: track.source,
      entityKind: track.entityKind ?? null,
      entityId: track.entityId ?? null,
      messageTimestamp: track.messageTimestamp ?? null,
    });
  }
  return result;
}

/** For tests — clears the cached Resend client so subsequent calls re-read env vars. */
export function _resetResendClient(): void {
  cachedClient = undefined;
}
