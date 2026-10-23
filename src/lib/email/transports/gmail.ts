import { render } from '@react-email/render';
import { google } from 'googleapis';
import { isCapabilityEnabled } from '@/lib/security/capabilities';
import type { SendEmailInput, SendEmailResult } from '../types';

/**
 * Gmail transport — sends as Max's own Workspace mailbox via the Gmail API,
 * authenticated by a service account using domain-wide delegation (it
 * impersonates the GMAIL_SENDER mailbox). Unlike Resend's sandbox, Gmail
 * delivers to anyone, so there is no "sandbox" restriction.
 *
 * Fail-soft: never throws — returns `{ ok: false, error }` so the auth
 * magic-link provider (which throws on `ok:false`) and every other caller
 * behave exactly as they did under Resend.
 */

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** Extract the bare address from a possible display-name form ("Cocoa AI <max@x>"). */
function bareAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1]! : addr).trim();
}

/** Raw configured sender, e.g. "max@example.org". */
function senderRaw(): string {
  return (process.env.GMAIL_SENDER ?? '').trim();
}

/** Display-name From header, e.g. "Cocoa AI <max@example.org>". */
export function gmailSenderAddress(): string {
  const raw = senderRaw();
  if (!raw) return '';
  return raw.includes('<') ? raw : `Cocoa AI <${raw}>`;
}

export function isGmailConfigured(): boolean {
  if (!isCapabilityEnabled('gmail')) return false;
  return Boolean(
    senderRaw() &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim(),
  );
}

/** `.env` stores the key double-quoted with literal `\n`; some loaders leave them literal. */
function privateKey(): string {
  return (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
}

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

/** RFC 2047 encode non-ASCII header values (e.g. an emoji subject) as UTF-8 base64. */
function encodeHeaderValue(value: string): string {
  return isAscii(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function joinAddrs(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  const arr = (Array.isArray(value) ? value : [value]).map((s) => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr.join(', ') : undefined;
}

/** base64-encode a UTF-8 string, wrapped at 76 chars/line per MIME (text/html parts). */
function b64Body(body: string): string {
  return Buffer.from(body, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');
}

/** Line-wrap an ALREADY-base64 string at 76 chars/line per MIME (attachment parts — do NOT re-encode). */
function wrapBase64(b64: string): string {
  return b64.replace(/\s+/g, '').replace(/(.{76})/g, '$1\r\n');
}

function buildRawMessage(
  input: SendEmailInput,
  fromHeader: string,
  html: string,
  text: string,
): string {
  const to = joinAddrs(input.to);
  const cc = joinAddrs(input.cc);
  const bcc = joinAddrs(input.bcc);
  const seed = Buffer.from(`${fromHeader}:${to ?? ''}:${input.subject}`)
    .toString('hex')
    .slice(0, 24);
  const altBoundary = `cocoa_alt_${seed}`;

  // Common top-level headers. The Content-Type is added last and depends on
  // whether attachments require a multipart/mixed wrapper.
  const headers: string[] = [`From: ${fromHeader}`];
  if (to) headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references) headers.push(`References: ${input.references}`);
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    headers.push(`${key}: ${value}`);
  }
  headers.push('MIME-Version: 1.0');

  const altPart = (mime: string, body: string): string =>
    [
      `--${altBoundary}`,
      `Content-Type: ${mime}; charset="UTF-8"`,
      'Content-Transfer-Encoding: base64',
      '',
      b64Body(body),
      '',
    ].join('\r\n');

  // The text/html body, as a self-contained multipart/alternative block.
  const alternative = [
    altPart('text/plain', text.length > 0 ? text : ' '),
    altPart('text/html', html),
    `--${altBoundary}--`,
  ].join('\r\n');

  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    // No attachments → the message body IS the multipart/alternative.
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return [headers.join('\r\n'), '', alternative, ''].join('\r\n');
  }

  // Attachments present → wrap the alternative inside a multipart/mixed envelope
  // (distinct boundary) and append one base64 attachment part each.
  // Gmail messages.send caps the raw message at ~35MB incl. ~33% base64
  // inflation; our infographics (~1-2MB PNG) and short clips are well under.
  const mixedBoundary = `cocoa_mix_${seed}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

  const attachmentParts = attachments.map((att) =>
    [
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType ?? 'application/octet-stream'}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      wrapBase64(att.content),
      '',
    ].join('\r\n'),
  );

  return [
    headers.join('\r\n'),
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    alternative,
    '',
    ...attachmentParts,
    `--${mixedBoundary}--`,
    '',
  ].join('\r\n');
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendViaGmail(input: SendEmailInput): Promise<SendEmailResult> {
  const fromHeader = input.from ?? gmailSenderAddress();
  const sandbox = false;

  if (!isGmailConfigured()) {
    console.warn(
      '[email/gmail] not configured (GMAIL_SENDER / GOOGLE_SERVICE_ACCOUNT_* missing) — email skipped',
      { subject: input.subject, to: input.to },
    );
    return { ok: false, error: 'Gmail transport not configured', from: fromHeader, sandbox };
  }

  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: privateKey(),
      scopes: [GMAIL_SEND_SCOPE],
      // Domain-wide delegation: impersonate Max's mailbox.
      subject: bareAddress(fromHeader),
    });

    const html = await render(input.react);
    const text = input.text ?? (await render(input.react, { plainText: true }));
    const raw = toBase64Url(buildRawMessage(input, fromHeader, html, text));

    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
    });

    return {
      ok: true,
      id: res.data.id ?? undefined,
      from: fromHeader,
      sandbox,
      threadId: res.data.threadId ?? undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email/gmail] Send failed:', msg);
    return { ok: false, error: msg, from: fromHeader, sandbox };
  }
}
