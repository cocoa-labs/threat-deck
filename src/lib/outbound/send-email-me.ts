/**
 * Shared client helper: POST to /api/outbound/email-me.
 *
 * The operator-self email send — renders the AgentResponseEmail template and
 * file-attaches ready media blob URLs. Used by BOTH the manual EMAIL button
 * (`EmailMeButton`) and the conversational auto-send-when-ready path (the agent
 * defers an email whose attachment is still rendering; the media poller fires
 * this once the blob URL resolves — auto-doing what the button does manually).
 */

export interface SendEmailMeInput {
  /** Full Markdown agent response — the email body. */
  messageContent: string;
  /** ms epoch — derives the server-side dedup entity_id. */
  messageTimestamp: number;
  severity?: string | null;
  alertEntityKind?: string | null;
  alertEntityId?: string | null;
  twitterDistillation?: string | null;
  forceResend?: boolean;
  /** Ready (https) image blob URLs to file-attach. */
  attachImageUrls?: string[];
  /** Ready (https) video blob URLs to file-attach. */
  attachVideoUrls?: string[];
}

export interface SendEmailMeResult {
  ok: boolean;
  alreadySent?: boolean;
  recipient?: string;
  error?: string;
  detail?: string;
}

export async function sendEmailMe(input: SendEmailMeInput): Promise<SendEmailMeResult> {
  try {
    const res = await fetch('/api/outbound/email-me', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messageContent: input.messageContent,
        messageTimestamp: input.messageTimestamp,
        severity: input.severity ?? null,
        alertEntityKind: input.alertEntityKind ?? null,
        alertEntityId: input.alertEntityId ?? null,
        twitterDistillation: input.twitterDistillation ?? null,
        forceResend: input.forceResend ?? false,
        attachImageUrls: input.attachImageUrls ?? [],
        attachVideoUrls: input.attachVideoUrls ?? [],
      }),
    });
    const json = (await res.json().catch(() => ({}))) as SendEmailMeResult;
    if (!json.ok) {
      return {
        ok: false,
        error: json.error,
        detail: json.detail ?? json.error ?? `HTTP ${res.status}`,
      };
    }
    return { ok: true, alreadySent: Boolean(json.alreadySent), recipient: json.recipient };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'network_error' };
  }
}
