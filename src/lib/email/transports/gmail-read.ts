import { type gmail_v1, google } from 'googleapis';
import { isCapabilityEnabled } from '@/lib/security/capabilities';
import type { EmailThreadRow } from '../../db/queries/email-threads';

/**
 * Gmail INBOUND reader — the email twin of `fetchRepliesForConversation` in the
 * X collector. Reads replies to emails WE sent, from a Workspace mailbox, via
 * the Gmail API (service account + domain-wide delegation, the same auth the
 * send transport uses — but a separate read-only scope).
 *
 * STRICTLY FAIL-SOFT: returns `[]` on every degradation path (not configured,
 * read scope not granted → 403, transient API error, or any throw). Never
 * throws, never returns demo data — an empty result must be trustworthy so the
 * panel/agent can honestly say "no replies (or reads unavailable)".
 *
 * Until Workspace Admin grants the SA domain-wide delegation for
 * `gmail.readonly`, this returns `[]` and the feature stays dormant — exactly
 * how X reply detection behaved on an unknown API tier.
 */

const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** Headers we pull per message (metadata format — no body fetch). */
const META_HEADERS = ['From', 'Subject', 'Date', 'Message-ID', 'In-Reply-To', 'References'];

export interface EmailReply {
  /** Gmail message id. */
  id: string;
  /** Raw From header (display-name + address). */
  from: string;
  subject: string;
  /** Gmail's short plaintext preview. */
  snippet: string;
  /** ISO timestamp the reply was received, if known. */
  receivedAt: string | null;
  /** Best-effort Gmail web link (only meaningful when signed into that mailbox). */
  url?: string;
}

/** `.env` stores the key double-quoted with literal `\n`; some loaders leave them literal. */
function privateKey(): string {
  return (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

/** Mailbox the reader scans — the reply sink. Defaults to the send mailbox. */
function inboxMailbox(): string {
  return (process.env.GMAIL_INBOX ?? process.env.GMAIL_SENDER ?? '').trim();
}

/** Bare lowercase address from a possible display-name form ("Cocoa AI <max@x>"). */
function bareAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1]! : addr).trim().toLowerCase();
}

/** True only when the SA creds + an inbox mailbox are all present. */
export function isGmailReadConfigured(): boolean {
  if (!isCapabilityEnabled('gmail')) return false;
  return Boolean(
    inboxMailbox() &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim(),
  );
}

function headerVal(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const h of headers) {
    if ((h.name ?? '').toLowerCase() === lower && h.value) return h.value;
  }
  return undefined;
}

/** Recent-search query for the Resend fallback path (no Gmail thread to walk). */
function buildSearchQuery(thread: EmailThreadRow, selfBare: string): string {
  const parts = ['newer_than:30d', `-from:${selfBare}`];
  if (thread.subject?.trim()) parts.push(`subject:${JSON.stringify(thread.subject.trim())}`);
  return parts.join(' ');
}

/**
 * Fetch replies to one of OUR sent emails. Two strategies:
 *   - Gmail-sent (thread.gmail_thread_id set): walk the Gmail thread, return
 *     every message that isn't ours. Rock-solid threading.
 *   - Resend-sent (no thread id): recent-search the inbox by subject, then
 *     confirm each candidate's In-Reply-To/References echoes our Message-ID.
 */
export async function fetchRepliesForThread(
  thread: EmailThreadRow,
  maxResults = 20,
): Promise<EmailReply[]> {
  if (!isGmailReadConfigured()) return [];
  try {
    const mailbox = inboxMailbox();
    const selfBare = bareAddress(mailbox);
    const ourId = thread.message_id;

    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey(),
      scopes: [GMAIL_READ_SCOPE],
      subject: selfBare, // domain-wide delegation: impersonate the inbox mailbox
    });
    const gmail = google.gmail({ version: 'v1', auth });

    // Gather candidate messages (already metadata-loaded for the thread path).
    let candidates: gmail_v1.Schema$Message[] = [];
    if (thread.gmail_thread_id) {
      const res = await gmail.users.threads.get({
        userId: 'me',
        id: thread.gmail_thread_id,
        format: 'metadata',
        metadataHeaders: META_HEADERS,
      });
      candidates = res.data.messages ?? [];
    } else {
      const list = await gmail.users.messages.list({
        userId: 'me',
        q: buildSearchQuery(thread, selfBare),
        maxResults,
      });
      const ids = (list.data.messages ?? [])
        .map((m) => m.id)
        .filter((id): id is string => Boolean(id));
      for (const id of ids) {
        const g = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: META_HEADERS,
        });
        candidates.push(g.data);
      }
    }

    const replies: EmailReply[] = [];
    for (const msg of candidates) {
      const headers = msg.payload?.headers;
      const from = headerVal(headers, 'From') ?? '';
      const mid = headerVal(headers, 'Message-ID') ?? '';
      // Skip our own original send and any message from the inbox mailbox itself.
      if (mid && ourId && mid === ourId) continue;
      if (from && bareAddress(from) === selfBare) continue;
      // Resend fallback: confirm the candidate actually references our message.
      if (!thread.gmail_thread_id && ourId) {
        const refs = `${headerVal(headers, 'In-Reply-To') ?? ''} ${headerVal(headers, 'References') ?? ''}`;
        if (!refs.includes(ourId)) continue;
      }
      replies.push({
        id: msg.id ?? '',
        from,
        subject: headerVal(headers, 'Subject') ?? '(no subject)',
        snippet: typeof msg.snippet === 'string' ? msg.snippet : '',
        receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
        ...(thread.gmail_thread_id
          ? { url: `https://mail.google.com/mail/u/0/#all/${thread.gmail_thread_id}` }
          : {}),
      });
      if (replies.length >= maxResults) break;
    }
    return replies;
  } catch (err) {
    console.warn(
      '[gmail-read] fetchRepliesForThread failed (fail-soft → []):',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
