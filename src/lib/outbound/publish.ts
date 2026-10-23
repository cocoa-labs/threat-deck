import { buildMediaAttachments } from '@/lib/email/attachments';
import { requireCapability } from '@/lib/security/capabilities';
import { ownsDraftMedia } from '@/lib/security/media-ownership';
import { validateEmailDraft } from '@/lib/twitter/content/format';
/**
 * Phase 9.1 — Channel-dispatching publisher.
 *
 * Called from `/api/outbound/drafts/[id]/approve` when the request body
 * includes `publish=true` (the default). Reads the draft, switches on
 * channel, and translates the draft payload into an actual outbound
 * send via the corresponding subsystem:
 *
 *     twitter → chained postTweet() with replyToTweetId threading
 *     email   → sendEmail() with the template named in draft_payload
 *     rss     → no-op (RSS feed regenerates from DB on next public GET)
 *
 * After a successful publish the dispatcher:
 *   1. INSERTs a single `aegis_outbound_log` row with the at-most-once
 *      UNIQUE constraint preventing double-sends.
 *   2. Calls `markPublished(draftId, outboundLogId)` to flip the draft.
 *   3. Fires `recordAudit(OUTBOUND_DRAFT_PUBLISHED)`.
 *
 * Fail-soft: every failure path returns a typed result so the route can
 * surface the partial state without exposing internal exceptions.
 */

import type { ReactElement } from 'react';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { recordXPost } from '@/lib/db/queries/x-posts';
import { sendEmail } from '@/lib/email/resend';
import { AgentResponseEmail } from '@/lib/email/templates/AgentResponseEmail';
import { logger } from '@/lib/logger';
import type { DraftTweet, EmailDraft, ThreadDraft } from '@/lib/twitter/content';
import { uploadTweetVideoFromUrl } from '@/lib/twitter/video-upload';
import { getDefaultDryRun, postTweet, uploadTweetImageFromUrl } from '@/lib/twitter/write-client';
import { getDraft } from './drafts';
import { markPublished } from './mutations';

export type PublishResult =
  | {
      ok: true;
      draftId: number;
      channel: string;
      tweetIds?: string[]; // populated for twitter (synthetic 'dry-*' ids in dry-run)
      dryRun?: boolean;
      outboundLogId: number | null;
    }
  | {
      ok: false;
      draftId: number;
      reason:
        | 'not_found'
        | 'not_approved'
        | 'unsupported_channel'
        | 'partial_publish'
        | 'persist_failed'
        | 'send_failed'
        | 'media_upload_failed'
        | 'no_token';
      details?: string;
      publishedCount?: number; // for partial_publish: how many tweets landed
      tweetIds?: string[];
    };

export interface PublishOptions {
  /** Override the default dry-run determination (env-based via getDefaultDryRun). */
  dryRun?: boolean;
  /** Recipient identifier for the outbound_log row. Defaults to 'the configured X account' for Twitter. */
  recipient?: string;
}

const DEFAULT_TWITTER_RECIPIENT = process.env.TWITTER_OAUTH_HANDLE || 'configured-account';

export async function publishDraft(draftId: number, opts?: PublishOptions): Promise<PublishResult> {
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, draftId, reason: 'not_found' };
  if (draft.status !== 'approved') {
    return { ok: false, draftId, reason: 'not_approved', details: `status=${draft.status}` };
  }

  if (draft.channel === 'twitter') requireCapability('x');
  if (draft.channel === 'email') requireCapability('email');
  if (!(await ownsDraftMedia(draft.draftPayload, draft.createdBy)))
    return { ok: false, draftId, reason: 'media_upload_failed', details: 'media_not_owned' };
  const claim = await query(
    'INSERT INTO security_publish_claims(draft_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING draft_id',
    [draftId],
  );
  if (!claim.rows.length)
    return {
      ok: false,
      draftId,
      reason: 'partial_publish',
      details: 'Publication already attempted; review before retrying.',
    };
  switch (draft.channel) {
    case 'twitter':
      requireCapability('x');
      return publishTwitter(draft.id, draft.draftPayload, opts);
    case 'email':
      requireCapability('email');
      // Email-reply detour — operator-reviewed replies dispatch in-thread.
      return publishEmail(draft.id, draft.draftPayload, opts);
    case 'rss':
      // RSS regenerates from the DB on the next public GET, so a draft just
      // needs its lifecycle completed — surfaced via unsupported_channel.
      return {
        ok: false,
        draftId,
        reason: 'unsupported_channel',
        details: `channel ${draft.channel} dispatch not implemented`,
      };
    default:
      return {
        ok: false,
        draftId,
        reason: 'unsupported_channel',
        details: `unknown channel ${draft.channel}`,
      };
  }
}

// ─── Twitter publisher ───────────────────────────────────────────────────────

async function publishTwitter(
  draftId: number,
  payload: Record<string, unknown>,
  opts?: PublishOptions,
): Promise<PublishResult> {
  const thread = coerceThreadDraft(payload);
  if (!thread || thread.tweets.length === 0) {
    return {
      ok: false,
      draftId,
      reason: 'persist_failed',
      details: 'draft_payload is not a valid ThreadDraft',
    };
  }

  const dryRun = opts?.dryRun ?? getDefaultDryRun();
  const recipient = opts?.recipient ?? DEFAULT_TWITTER_RECIPIENT;

  // Resolve + upload the optional infographic that rides the FINAL tweet.
  // Done BEFORE posting any tweet so a media failure aborts the whole thread —
  // we never post a thread missing its closing infographic.
  let finalMediaIds: string[] | undefined;
  if (thread.mediaId) {
    const media = await resolveAndUploadMedia(thread.mediaId);
    if (!media.ok) {
      const failLogId = await logOutbound({
        draftId,
        recipient,
        status: 'failed',
        errorMessage: `media upload failed: ${media.detail}`,
      });
      void recordAudit({
        action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
        outcome: 'failure',
        targetKind: 'outbound_draft',
        targetId: String(draftId),
        errorMessage: media.detail,
        details: { stage: 'media_upload', dryRun, outboundLogId: failLogId },
      });
      return { ok: false, draftId, reason: 'media_upload_failed', details: media.detail };
    }
    finalMediaIds = [media.mediaId];
  }

  // Chain the tweets sequentially, threading via replyToTweetId. Media (if any)
  // attaches to the LAST tweet only.
  const tweetIds: string[] = [];
  // A reply draft makes the FIRST tweet reply to its target; a normal thread
  // starts at the root (undefined). X detour Step 4.
  let replyTo: string | undefined = thread.replyToTweetId;

  for (let i = 0; i < thread.tweets.length; i++) {
    const t = thread.tweets[i]!;
    const text = composeTweetText(t, thread.canonicalHashtag, i, thread.tweets.length);
    const isLast = i === thread.tweets.length - 1;
    const result = await postTweet({
      text,
      replyToTweetId: replyTo,
      mediaIds: isLast ? finalMediaIds : undefined,
      dryRun,
    });
    if (!result.ok || !result.tweetId) {
      // Auth failure (missing/expired/revoked OAuth token) is distinct from a
      // true partial publish — surface `no_token` so the UI prompts "Reconnect X"
      // instead of "partially posted". Retrying won't help until reconnected. A
      // surviving 401 (X rejected a token the post client already tried to
      // refresh) is the same class of failure.
      const isAuth = result.error === 'no_token' || result.status === 401;
      const detail = isAuth
        ? 'X token expired or not connected — reconnect X, then retry.'
        : `tweet ${i + 1}/${thread.tweets.length} failed: ${result.detail ?? result.error ?? 'unknown'}`;
      const failLogId = await logOutbound({
        draftId,
        recipient,
        status: 'failed',
        errorMessage: detail,
      });
      void recordAudit({
        action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
        outcome: 'failure',
        targetKind: 'outbound_draft',
        targetId: String(draftId),
        errorMessage: detail,
        details: {
          tweetIndex: i,
          publishedCount: tweetIds.length,
          dryRun,
          outboundLogId: failLogId,
          authFailure: isAuth,
        },
      });
      return {
        ok: false,
        draftId,
        reason: isAuth ? 'no_token' : 'partial_publish',
        details: detail,
        publishedCount: tweetIds.length,
        tweetIds,
      };
    }
    tweetIds.push(result.tweetId);
    replyTo = result.tweetId;
  }

  // All tweets landed. Write the at-most-once outbound_log row + flip the draft.
  const outboundLogId = await logOutbound({
    draftId,
    recipient,
    status: 'sent',
    tweetId: tweetIds[0]!,
    summary: `${tweetIds.length} tweet${tweetIds.length === 1 ? '' : 's'}${dryRun ? ' (dry-run)' : ''}`,
  });

  // Register our posted thread root for permalinks + reply-detection (Path B
  // previously dropped the root id — this is its first durable capture).
  void recordXPost({
    rootTweetId: tweetIds[0]!,
    tweetIds,
    handle: process.env.TWITTER_OAUTH_HANDLE ?? '',
    source: 'approval_queue',
    primaryText: thread.tweets[0]?.text ?? null,
  });

  if (outboundLogId === null) {
    // Tweets posted but log write failed — extremely rare (already-sent dedup
    // shouldn't fire because draftId is unique per draft). Log the audit
    // anyway so we have a record.
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
      outcome: 'failure',
      targetKind: 'outbound_draft',
      targetId: String(draftId),
      errorMessage: 'outbound_log INSERT returned no row',
      details: { tweetIds, dryRun },
    });
    return {
      ok: false,
      draftId,
      reason: 'persist_failed',
      details: 'outbound_log insert returned no row',
      publishedCount: tweetIds.length,
      tweetIds,
    };
  }

  const mark = await markPublished(draftId, outboundLogId);
  if (!mark.ok) {
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
      outcome: 'failure',
      targetKind: 'outbound_draft',
      targetId: String(draftId),
      errorMessage: `markPublished returned ${mark.reason}`,
      details: { tweetIds, outboundLogId, dryRun },
    });
    return {
      ok: false,
      draftId,
      reason: 'persist_failed',
      details: `markPublished: ${mark.reason}`,
      publishedCount: tweetIds.length,
      tweetIds,
    };
  }

  void recordAudit({
    action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
    outcome: 'success',
    targetKind: 'outbound_draft',
    targetId: String(draftId),
    details: { tweetIds, outboundLogId, dryRun, channel: 'twitter' },
  });

  return {
    ok: true,
    draftId,
    channel: 'twitter',
    tweetIds,
    dryRun,
    outboundLogId,
  };
}

// ─── Email publisher (email-reply detour) ─────────────────────────────────────

async function publishEmail(
  draftId: number,
  payload: Record<string, unknown>,
  opts?: PublishOptions,
): Promise<PublishResult> {
  const email = coerceEmailDraft(payload);
  if (!email) {
    return {
      ok: false,
      draftId,
      reason: 'persist_failed',
      details: 'draft_payload is not a valid EmailDraft',
    };
  }
  const recipient = opts?.recipient ?? email.to[0]!;

  // Render the operator-edited Markdown body through the standard email shell.
  let reactEl: ReactElement;
  try {
    reactEl = AgentResponseEmail({
      responseText: email.bodyMarkdown,
      twitterDistillation: null,
      severity: null,
      alertEntityKind: null,
      alertEntityId: null,
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'render failed';
    const failLogId = await logOutbound({
      channel: 'email',
      draftId,
      recipient,
      status: 'failed',
      errorMessage: `render failed: ${detail}`,
    });
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
      outcome: 'failure',
      targetKind: 'outbound_draft',
      targetId: String(draftId),
      errorMessage: detail,
      details: { stage: 'render', channel: 'email', outboundLogId: failLogId },
    });
    return { ok: false, draftId, reason: 'send_failed', details: `email render failed: ${detail}` };
  }

  // Send in-thread: inReplyTo/references/threadId carry the reply into the
  // original conversation; `track` records it in the sent-email registry.
  const media = email.mediaIds?.length
    ? await query<{ blob_url: string; media_kind: 'image' | 'video' }>(
        `SELECT blob_url, media_kind FROM aegis_generated_media WHERE id = ANY($1::bigint[]) AND status IN ('ready', 'published')`,
        [email.mediaIds],
      )
    : { rows: [] };
  const attachments = await buildMediaAttachments(
    media.rows.map((r) => ({ blobUrl: r.blob_url, kind: r.media_kind })),
  );
  const sendResult = await sendEmail({
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    attachments: attachments.attachments,
    subject: email.subject,
    react: reactEl,
    ...(email.inReplyToMessageId ? { inReplyTo: email.inReplyToMessageId } : {}),
    ...(email.references ? { references: email.references } : {}),
    ...(email.gmailThreadId ? { threadId: email.gmailThreadId } : {}),
    track: {
      source: 'reply',
      entityKind: 'email_reply',
      entityId: email.inReplyToMessageId ?? null,
    },
  });

  if (!sendResult.ok) {
    const failLogId = await logOutbound({
      channel: 'email',
      draftId,
      recipient,
      status: 'failed',
      errorMessage: sendResult.error,
    });
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
      outcome: 'failure',
      targetKind: 'outbound_draft',
      targetId: String(draftId),
      errorMessage: sendResult.error,
      details: {
        stage: 'send',
        channel: 'email',
        outboundLogId: failLogId,
        sandbox: sendResult.sandbox,
      },
    });
    return {
      ok: false,
      draftId,
      reason: 'send_failed',
      details: sendResult.error ?? 'unknown send failure',
    };
  }

  const outboundLogId = await logOutbound({
    channel: 'email',
    draftId,
    recipient,
    status: 'sent',
    summary: `email reply to ${email.to.join(', ')}${sendResult.sandbox ? ' (sandbox)' : ''}`,
  });
  if (outboundLogId === null) {
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
      outcome: 'failure',
      targetKind: 'outbound_draft',
      targetId: String(draftId),
      errorMessage: 'outbound_log INSERT returned no row',
      details: { channel: 'email', recipients: email.to },
    });
    return {
      ok: false,
      draftId,
      reason: 'persist_failed',
      details: 'outbound_log insert returned no row',
    };
  }

  const mark = await markPublished(draftId, outboundLogId);
  if (!mark.ok) {
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
      outcome: 'failure',
      targetKind: 'outbound_draft',
      targetId: String(draftId),
      errorMessage: `markPublished returned ${mark.reason}`,
      details: { channel: 'email', outboundLogId },
    });
    return {
      ok: false,
      draftId,
      reason: 'persist_failed',
      details: `markPublished: ${mark.reason}`,
    };
  }

  void recordAudit({
    action: AUDIT_ACTIONS.OUTBOUND_DRAFT_PUBLISHED,
    outcome: 'success',
    targetKind: 'outbound_draft',
    targetId: String(draftId),
    details: { outboundLogId, channel: 'email', recipients: email.to, sandbox: sendResult.sandbox },
  });

  return { ok: true, draftId, channel: 'email', dryRun: sendResult.sandbox, outboundLogId };
}

// ─── Internals ───────────────────────────────────────────────────────────────

/** Translate a stored draft_payload JSON object back into a typed ThreadDraft. */
function coerceThreadDraft(payload: Record<string, unknown>): ThreadDraft | null {
  const tweetsRaw = payload.tweets;
  if (!Array.isArray(tweetsRaw)) return null;
  const tweets: DraftTweet[] = [];
  for (const t of tweetsRaw) {
    if (!t || typeof t !== 'object') return null;
    const tt = t as Record<string, unknown>;
    if (typeof tt.text !== 'string') return null;
    const draft: DraftTweet = { text: tt.text };
    if (typeof tt.link === 'string' && tt.link.startsWith('http')) draft.link = tt.link;
    tweets.push(draft);
  }
  const hashtag =
    typeof payload.canonicalHashtag === 'string' ? payload.canonicalHashtag : '#AICyber';
  const result: ThreadDraft = { tweets, canonicalHashtag: hashtag };
  if (typeof payload.mediaId === 'string' && payload.mediaId.trim()) {
    result.mediaId = payload.mediaId;
  }
  if (payload.mediaKind === 'image' || payload.mediaKind === 'video') {
    result.mediaKind = payload.mediaKind;
  }
  if (typeof payload.replyToTweetId === 'string' && payload.replyToTweetId.trim()) {
    result.replyToTweetId = payload.replyToTweetId;
  }
  return result;
}

/** Translate a stored draft_payload JSON object back into a typed EmailDraft. */
function coerceEmailDraft(payload: Record<string, unknown>): EmailDraft | null {
  const toRaw = payload.to;
  if (!Array.isArray(toRaw)) return null;
  const to = toRaw.filter((x): x is string => typeof x === 'string' && x.includes('@'));
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const bodyMarkdown = typeof payload.bodyMarkdown === 'string' ? payload.bodyMarkdown : '';
  if (to.length === 0 || subject.length === 0 || bodyMarkdown.trim().length === 0) return null;
  const result: EmailDraft = {
    to,
    subject,
    bodyMarkdown,
    cc: payload.cc as string[] | undefined,
    bcc: payload.bcc as string[] | undefined,
    mediaIds: payload.mediaIds as string[] | undefined,
  };
  if (validateEmailDraft(result)) return null;
  if (typeof payload.inReplyToMessageId === 'string' && payload.inReplyToMessageId.trim()) {
    result.inReplyToMessageId = payload.inReplyToMessageId;
  }
  if (typeof payload.references === 'string' && payload.references.trim()) {
    result.references = payload.references;
  }
  if (typeof payload.gmailThreadId === 'string' && payload.gmailThreadId.trim()) {
    result.gmailThreadId = payload.gmailThreadId;
  }
  return result;
}

/**
 * Resolve a generated-media row to an X media id at publish time. Re-checks
 * readiness here (not at stage time) so a video that finished processing after
 * the draft was staged still attaches. The uploaders honor the dev dry-run
 * guard internally, so this never touches the network in local runs.
 */
async function resolveAndUploadMedia(
  mediaId: string,
): Promise<{ ok: true; mediaId: string } | { ok: false; detail: string }> {
  let row: { media_kind: string; blob_url: string | null; status: string } | undefined;
  try {
    const { rows } = await query<{ media_kind: string; blob_url: string | null; status: string }>(
      `SELECT media_kind, blob_url, status FROM aegis_generated_media WHERE id = $1 LIMIT 1`,
      [mediaId],
    );
    row = rows[0];
  } catch (err) {
    return {
      ok: false,
      detail: `media lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!row) return { ok: false, detail: `media ${mediaId} not found` };
  if (row.status !== 'ready' && row.status !== 'published') {
    return { ok: false, detail: `media ${mediaId} is not ready (status=${row.status})` };
  }
  if (!row.blob_url) return { ok: false, detail: `media ${mediaId} has no blob_url` };

  const upload =
    row.media_kind === 'video'
      ? await uploadTweetVideoFromUrl(row.blob_url)
      : await uploadTweetImageFromUrl(row.blob_url);
  if (!upload.ok || !upload.mediaId) {
    return {
      ok: false,
      detail: `${row.media_kind} upload to X failed: ${upload.error ?? 'unknown'}${upload.detail ? ` (${upload.detail})` : ''}`,
    };
  }
  return { ok: true, mediaId: upload.mediaId };
}

/**
 * Render a tweet's final text by appending the link (collapsed by X to ~23
 * chars) at the end. T1 already has the canonical hashtag baked in by the
 * generator (validated via validateThreadDraft); subsequent tweets do not
 * re-add it.
 */
function composeTweetText(
  t: DraftTweet,
  _canonicalHashtag: string,
  _index: number,
  _total: number,
): string {
  if (t.link) {
    return `${t.text} ${t.link}`;
  }
  return t.text;
}

/**
 * Write a single `aegis_outbound_log` row keyed by
 * `(channel, entity_kind='draft', entity_id=draftId, recipient)`. The
 * existing UNIQUE constraint on that 4-tuple prevents accidental
 * double-publishes — a second concurrent call returns the existing row's id.
 */
async function logOutbound(input: {
  /** Defaults to 'twitter' for back-compat with the Twitter publisher. */
  channel?: string;
  draftId: number;
  recipient: string;
  status: 'sent' | 'failed';
  tweetId?: string;
  summary?: string;
  errorMessage?: string;
}): Promise<number | null> {
  try {
    const { rows } = await query<{ id: number }>(
      // Phase 13.011 migrated aegis_outbound_log.sent_at from TEXT to
      // TIMESTAMPTZ. Use NOW() directly (was to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')).
      `INSERT INTO aegis_outbound_log
         (channel, recipient, entity_kind, entity_id, payload_summary, sent_at, status, error_message)
       VALUES ($6, $1, 'draft', $2, $3, NOW(), $4, $5)
       ON CONFLICT (channel, entity_kind, entity_id, recipient) DO UPDATE
         SET status = EXCLUDED.status,
             payload_summary = EXCLUDED.payload_summary,
             error_message = EXCLUDED.error_message,
             sent_at = EXCLUDED.sent_at
       RETURNING id`,
      [
        input.recipient,
        String(input.draftId),
        input.summary ?? null,
        input.status,
        input.errorMessage ?? null,
        input.channel ?? 'twitter',
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.warn('[outbound] logOutbound failed', {
      draftId: input.draftId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
