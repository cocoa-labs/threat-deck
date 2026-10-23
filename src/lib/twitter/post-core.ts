/**
 * Shared X-publish core — the dedup → media-upload → postTweet(primary+reply)
 * → audit → outbound-log pipeline, extracted from `/api/twitter/post` so BOTH
 * the synchronous route AND the background job worker
 * (`src/lib/twitter/x-post-job-service.ts`) run identical posting + dedup +
 * audit logic. Callers do their own validation/normalization and pass an
 * already-composed reply; `postCore` owns everything from the dedup reserve
 * onward and never throws (returns a typed `PostCoreResult`).
 */

import { createHash } from 'node:crypto';
import { AUDIT_ACTIONS, auditDenied, auditFailure, auditSuccess } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { recordXPost } from '@/lib/db/queries/x-posts';
import { effectiveTweetLength } from '@/lib/twitter/length';
import { uploadTweetVideoFromUrl } from '@/lib/twitter/video-upload';
import {
  type PostTweetResult,
  postTweet,
  uploadTweetImageFromUrl,
} from '@/lib/twitter/write-client';

const CHANNEL = 'twitter';
const ENTITY_KIND = 'agent_response';

export type PublishMode = 'single' | 'two_post';

export interface PostCoreActor {
  id: string;
  ip?: string | null;
  ua?: string | null;
}

export interface PostCoreInput {
  /** Validated: non-empty, ≤ 25k chars. */
  text: string;
  messageTimestamp: number;
  publishMode: PublishMode;
  /** Already composed (reply + sourceUrl) for two_post; '' for single. */
  replyText: string;
  imageBlobUrl: string | null;
  videoBlobUrl: string | null;
  sourceUrl: string | null;
  alertEntityKind: string | null;
  alertEntityId: string | null;
  actor: PostCoreActor;
}

export interface PostCoreResult {
  ok: boolean;
  tweetIds: string[];
  replyTweetId: string | null;
  error?: string;
  detail?: string;
  /** Upstream HTTP status for twitter_api_error / no_token. */
  status?: number;
  missingScopes?: string[];
  partial: boolean;
  outboundLogId: number | null;
  /** True when posts were dry-run (dev / not actually sent). */
  dryRun?: boolean;
}

/** Append the source URL to the reply if not already present. */
export function composeReplyText(replyText: string, sourceUrl: string | null): string {
  const trimmed = replyText.trim();
  if (!sourceUrl) return trimmed;
  if (trimmed.includes(sourceUrl)) return trimmed;
  return trimmed ? `${trimmed}\n${sourceUrl}` : sourceUrl;
}

export function formatRecipient(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return 'the configured X account';
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

/** Normalize an http(s) URL or return null. */
export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function deriveAgentResponseEntityId(
  messageTimestamp: number,
  publishPackage: {
    text: string;
    publishMode: PublishMode;
    replyText: string;
    imageBlobUrl: string | null;
    videoBlobUrl: string | null;
    sourceUrl: string | null;
  },
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(publishPackage))
    .digest('hex')
    .slice(0, 16);
  return `agent-${Math.trunc(messageTimestamp)}-${hash}`;
}

async function updateOutboundLog(
  logRowId: number,
  status: 'sent' | 'failed',
  errorMessage: string | null,
): Promise<void> {
  try {
    await query(
      `UPDATE aegis_outbound_log
       SET status = $1, sent_at = NOW(), error_message = $2
       WHERE id = $3`,
      [status, errorMessage, logRowId],
    );
  } catch (err) {
    console.error('[twitter/post-core] outbound log update failed:', err);
  }
}

/**
 * Run the publish pipeline. Reserves the dedup row, uploads optional media,
 * posts the primary tweet + optional reply, audits, and flips the log row.
 * Returns a typed result the caller maps to HTTP / job status.
 */
export async function postCore(input: PostCoreInput): Promise<PostCoreResult> {
  const { text, messageTimestamp, publishMode, replyText, imageBlobUrl, videoBlobUrl, sourceUrl } =
    input;
  const { id: actorId, ip: actorIp, ua: actorUa } = input.actor;
  const { alertEntityKind, alertEntityId } = input;

  const effLen = effectiveTweetLength(text);
  const replyEffLen = effectiveTweetLength(replyText);
  const recipient = formatRecipient(process.env.TWITTER_OAUTH_HANDLE ?? '');
  const entityId = deriveAgentResponseEntityId(messageTimestamp, {
    text,
    publishMode,
    replyText,
    imageBlobUrl,
    videoBlobUrl,
    sourceUrl,
  });

  // ─── 1. Reserve the dedup row ───
  let logRowId: number | null = null;
  try {
    const insertResult = await query<{ id: number }>(
      `
      INSERT INTO aegis_outbound_log
        (channel, recipient, entity_kind, entity_id, payload_summary, status, error_message)
      VALUES ($1, $2, $3, $4, $5, 'queued', NULL)
      ON CONFLICT (channel, entity_kind, entity_id, recipient) DO UPDATE
        SET payload_summary = EXCLUDED.payload_summary,
            status = 'queued',
            error_message = NULL,
            sent_at = NULL
        WHERE aegis_outbound_log.status = 'failed'
      RETURNING id
      `,
      [CHANNEL, recipient, ENTITY_KIND, entityId, text.slice(0, 280)],
    );
    logRowId = insertResult.rows[0]?.id ?? null;
  } catch (err) {
    console.error('[twitter/post-core] outbound log pre-insert failed:', err);
    void auditFailure(AUDIT_ACTIONS.OUTBOUND_TWEET_FAILED, err, {
      actorId,
      actorIp,
      actorUa,
      targetKind: ENTITY_KIND,
      targetId: entityId,
      details: { recipient, alertEntityKind, alertEntityId, phase: 'dedup_insert' },
    });
    return {
      ok: false,
      tweetIds: [],
      replyTweetId: null,
      error: 'log_failed',
      detail: 'Could not reserve outbound log row for this post',
      partial: false,
      outboundLogId: null,
    };
  }

  if (!logRowId) {
    void auditDenied(AUDIT_ACTIONS.OUTBOUND_TWEET_DUPLICATE, 'duplicate_post', {
      actorId,
      actorIp,
      actorUa,
      targetKind: ENTITY_KIND,
      targetId: entityId,
      details: { recipient, alertEntityKind, alertEntityId },
    });
    return {
      ok: false,
      tweetIds: [],
      replyTweetId: null,
      error: 'duplicate_post',
      detail: 'This response text has already been queued or posted',
      partial: false,
      outboundLogId: null,
    };
  }

  // ─── 2. Optional media upload (rides the reply; one kind per tweet) ───
  let mediaIds: string[] | undefined;
  const mediaUrl = videoBlobUrl ?? imageBlobUrl;
  if (publishMode === 'two_post' && mediaUrl) {
    const mediaKind = videoBlobUrl ? 'video' : 'image';
    const upload = videoBlobUrl
      ? await uploadTweetVideoFromUrl(videoBlobUrl)
      : await uploadTweetImageFromUrl(mediaUrl);
    if (!upload.ok || !upload.mediaId) {
      const detail = upload.detail ?? 'Media upload failed';
      const error = upload.error ?? 'twitter_api_error';
      void auditFailure(
        AUDIT_ACTIONS.OUTBOUND_TWEET_FAILED,
        new Error(`${error}: ${detail}`.slice(0, 200)),
        {
          actorId,
          actorIp,
          actorUa,
          targetKind: ENTITY_KIND,
          targetId: entityId,
          details: { recipient, phase: 'media_upload', mediaKind, mediaUrl },
        },
      );
      await updateOutboundLog(logRowId, 'failed', `${error}: ${detail}`);
      return {
        ok: false,
        tweetIds: [],
        replyTweetId: null,
        error,
        detail,
        status: upload.status,
        missingScopes: upload.missingScopes,
        partial: false,
        outboundLogId: logRowId,
      };
    }
    mediaIds = [upload.mediaId];
  }

  // ─── 3. Post primary + optional reply ───
  const result: PostTweetResult = await postTweet({ text });
  const tweetIds = result.ok && result.tweetId ? [result.tweetId] : [];
  let replyResult: PostTweetResult | null = null;

  if (result.ok && result.tweetId && publishMode === 'two_post') {
    replyResult = await postTweet({
      text: replyText || 'Visual brief',
      replyToTweetId: result.tweetId,
      mediaIds,
    });
    if (replyResult.ok && replyResult.tweetId) tweetIds.push(replyResult.tweetId);
  }

  const finalResult = replyResult && !replyResult.ok ? replyResult : result;
  const finalOk = result.ok && (!replyResult || replyResult.ok);

  // ─── 4. Audit + log ───
  if (finalOk) {
    void auditSuccess(AUDIT_ACTIONS.OUTBOUND_TWEET_POSTED, {
      actorId,
      actorIp,
      actorUa,
      targetKind: ENTITY_KIND,
      targetId: entityId,
      details: {
        recipient,
        tweetId: result.tweetId ?? null,
        tweetIds,
        publishMode,
        hasReply: publishMode === 'two_post',
        hasImage: Boolean(imageBlobUrl),
        hasVideo: Boolean(videoBlobUrl),
        chars: text.length,
        effectiveChars: effLen,
        replyEffectiveChars: publishMode === 'two_post' ? replyEffLen : null,
        alertEntityKind,
        alertEntityId,
      },
    });
  } else {
    void auditFailure(
      AUDIT_ACTIONS.OUTBOUND_TWEET_FAILED,
      new Error(`${finalResult.error}: ${finalResult.detail ?? ''}`.slice(0, 200)),
      {
        actorId,
        actorIp,
        actorUa,
        targetKind: ENTITY_KIND,
        targetId: entityId,
        details: {
          recipient,
          tweetIds,
          publishMode,
          twitterStatus: finalResult.status ?? null,
          alertEntityKind,
          alertEntityId,
        },
      },
    );
  }

  await updateOutboundLog(
    logRowId,
    finalOk ? 'sent' : 'failed',
    finalOk ? null : `${finalResult.error}: ${finalResult.detail ?? ''}`.slice(0, 500),
  );

  // Register our posted thread root (== conversation_id) for permalinks + reply-detection.
  if (finalOk && tweetIds[0]) {
    void recordXPost({
      rootTweetId: tweetIds[0],
      tweetIds,
      handle: process.env.TWITTER_OAUTH_HANDLE ?? '',
      source: 'job',
      messageTimestamp,
      primaryText: text,
    });
  }

  if (!finalOk) {
    return {
      ok: false,
      tweetIds,
      replyTweetId: tweetIds[1] ?? null,
      error: finalResult.error,
      detail: finalResult.detail,
      status: finalResult.status,
      partial: tweetIds.length > 0,
      outboundLogId: logRowId,
    };
  }

  return {
    ok: true,
    tweetIds,
    replyTweetId: tweetIds[1] ?? null,
    partial: false,
    outboundLogId: logRowId,
    dryRun: result.dryRun,
  };
}
