/**
 * Reload-safe background "Post to X" — the job state machine.
 *
 * Truth lives in `aegis_x_post_jobs`. The job is advanced by a poll-driven
 * worker: `advanceXPostJob` performs exactly ONE committed transition per call
 * (the GET status endpoint and the reaper cron both call it), so the post
 * survives page reloads and serverless instance churn — there is no long-lived
 * worker to die. A `lease_until` single-flight guard + postCore's existing
 * outbound-log dedup prevent double-posting under concurrent polls.
 *
 *   queued → generating_image → posting → posted | failed | needs_reconnect
 */

import { randomUUID } from 'node:crypto';
import { query, queryOne } from '@/lib/db/client';
import { startImageGeneration } from '@/lib/visual/image-generation-service';
import { getConfiguredTwitterHandle } from './oauth';
import { buildTweetUrl } from './permalink';
import { composeReplyText, type PostCoreActor, type PublishMode, postCore } from './post-core';

export type XPostJobStatus =
  | 'queued'
  | 'generating_image'
  | 'posting'
  | 'posted'
  | 'failed'
  | 'needs_reconnect';

export type XReplyMode = 'text' | 'latest_image' | 'generate_image' | 'latest_video';

const TERMINAL: ReadonlySet<XPostJobStatus> = new Set(['posted', 'failed', 'needs_reconnect']);
const MAX_ATTEMPTS = 200;
const LEASE_SECONDS = 30;
const POLL_BASE = '/api/outbound/x/jobs/';

export interface StartXPostJobInput {
  actorEmail: string;
  primaryText: string;
  publishMode: PublishMode;
  replyMode: XReplyMode;
  replyText?: string | null;
  sourceUrl?: string | null;
  styleTag?: string | null;
  imageBlobUrl?: string | null;
  videoBlobUrl?: string | null;
  messageTimestamp: number;
  entityKind?: string | null;
  entityId?: string | null;
  sourceContext?: unknown;
}

export interface XPostJobView {
  ok: true;
  jobToken: string;
  status: XPostJobStatus;
  pollUrl: string;
  publishMode: PublishMode;
  primaryTextPreview: string;
  tweetIds: string[];
  replyTweetId: string | null;
  /** Public permalink to the thread root (tweetIds[0]); null until posted. */
  tweetUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  generatedMediaId: string | null;
  messageTimestamp: number;
  createdAt: string;
  updatedAt: string;
}

export type AdvanceResult = XPostJobView | { ok: false; error: 'not_found' | 'forbidden' };

interface JobRow {
  job_token: string;
  actor_email: string;
  status: XPostJobStatus;
  publish_mode: PublishMode;
  reply_mode: XReplyMode;
  primary_text: string;
  reply_text: string | null;
  source_url: string | null;
  style_tag: string | null;
  image_blob_url: string | null;
  video_blob_url: string | null;
  generated_media_id: string | number | null;
  message_timestamp: string | number;
  entity_kind: string | null;
  entity_id: string | null;
  source_context: unknown;
  tweet_ids: unknown;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  created_at: unknown;
  updated_at: unknown;
}

const SELECT_COLS = `job_token, actor_email, status, publish_mode, reply_mode, primary_text, reply_text,
  source_url, style_tag, image_blob_url, video_blob_url, generated_media_id, message_timestamp,
  entity_kind, entity_id, source_context, tweet_ids, error_code, error_message, attempts,
  created_at, updated_at`;

const UPDATABLE = new Set([
  'status',
  'image_blob_url',
  'video_blob_url',
  'generated_media_id',
  'tweet_ids',
  'error_code',
  'error_message',
  'outbound_log_id',
  'lease_until',
  'completed_at',
]);

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value as number).toISOString();
}

function view(row: JobRow): XPostJobView {
  const tweetIds = Array.isArray(row.tweet_ids) ? row.tweet_ids.map((t) => String(t)) : [];
  return {
    ok: true,
    jobToken: row.job_token,
    status: row.status,
    pollUrl: `${POLL_BASE}${row.job_token}`,
    publishMode: row.publish_mode,
    primaryTextPreview: row.primary_text.slice(0, 100),
    tweetIds,
    replyTweetId: tweetIds[1] ?? null,
    tweetUrl: tweetIds[0] ? buildTweetUrl(tweetIds[0], getConfiguredTwitterHandle()) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    generatedMediaId: row.generated_media_id == null ? null : String(row.generated_media_id),
    messageTimestamp: Number(row.message_timestamp),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** Whitelisted dynamic UPDATE + `updated_at`; releases the lease unless told otherwise. */
async function patchJob(jobToken: string, fields: Record<string, unknown>): Promise<JobRow | null> {
  const cols = Object.keys(fields);
  for (const c of cols) {
    if (!UPDATABLE.has(c)) throw new Error(`patchJob: non-whitelisted column ${c}`);
  }
  const sets = cols.map((c, i) =>
    c === 'tweet_ids' ? `${c} = $${i + 2}::jsonb` : `${c} = $${i + 2}`,
  );
  sets.push('updated_at = NOW()');
  const values = cols.map((c) => (c === 'tweet_ids' ? JSON.stringify(fields[c] ?? []) : fields[c]));
  const { rows } = await query<JobRow>(
    `UPDATE aegis_x_post_jobs SET ${sets.join(', ')} WHERE job_token = $1 RETURNING ${SELECT_COLS}`,
    [jobToken, ...values],
  );
  return rows[0] ?? null;
}

/** Insert a queued job. Returns the view (no work done yet). */
export async function startXPostJob(input: StartXPostJobInput): Promise<XPostJobView> {
  const jobToken = `xpost_${randomUUID()}`;
  const { rows } = await query<JobRow>(
    `INSERT INTO aegis_x_post_jobs
       (job_token, actor_email, status, publish_mode, reply_mode, primary_text, reply_text,
        source_url, style_tag, image_blob_url, video_blob_url, message_timestamp,
        entity_kind, entity_id, source_context)
     VALUES ($1,$2,'queued',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     RETURNING ${SELECT_COLS}`,
    [
      jobToken,
      input.actorEmail,
      input.publishMode,
      input.replyMode,
      input.primaryText,
      input.replyText ?? null,
      input.sourceUrl ?? null,
      input.styleTag ?? null,
      input.imageBlobUrl ?? null,
      input.videoBlobUrl ?? null,
      Math.trunc(input.messageTimestamp),
      input.entityKind ?? null,
      input.entityId ?? null,
      JSON.stringify(input.sourceContext ?? null),
    ],
  );
  return view(rows[0]!);
}

/** Non-terminal jobs for an actor (resume-on-mount + reaper scoping). */
export async function listActiveXPostJobs(actorEmail: string): Promise<XPostJobView[]> {
  const { rows } = await query<JobRow>(
    `SELECT ${SELECT_COLS} FROM aegis_x_post_jobs
     WHERE actor_email = $1 AND status NOT IN ('posted','failed','needs_reconnect')
     ORDER BY created_at DESC LIMIT 20`,
    [actorEmail],
  );
  return rows.map(view);
}

/**
 * Advance the job by ONE committed step under a single-flight lease. Idempotent
 * and crash-safe — any caller (poll, reload-resume, reaper) drives it forward.
 */
export async function advanceXPostJob(
  jobToken: string,
  actorEmail: string,
  actor: PostCoreActor,
): Promise<AdvanceResult> {
  const existing = await queryOne<JobRow>(
    `SELECT ${SELECT_COLS} FROM aegis_x_post_jobs WHERE job_token = $1`,
    [jobToken],
  );
  if (!existing) return { ok: false, error: 'not_found' };
  if (existing.actor_email !== actorEmail) return { ok: false, error: 'forbidden' };
  if (TERMINAL.has(existing.status)) return view(existing);

  // Acquire the lease: only one poll advances at a time.
  const leased = await queryOne<JobRow>(
    `UPDATE aegis_x_post_jobs
       SET lease_until = NOW() + ($2 || ' seconds')::interval,
           attempts = attempts + 1,
           started_at = COALESCE(started_at, NOW()),
           updated_at = NOW()
     WHERE job_token = $1
       AND status NOT IN ('posted','failed','needs_reconnect')
       AND (lease_until IS NULL OR lease_until < NOW())
     RETURNING ${SELECT_COLS}`,
    [jobToken, String(LEASE_SECONDS)],
  );
  if (!leased) return view(existing); // another poll holds the lease, or it just went terminal

  if (leased.attempts > MAX_ATTEMPTS) {
    const done = await patchJob(jobToken, {
      status: 'failed',
      error_code: 'stalled',
      error_message: 'job exceeded max attempts',
      lease_until: null,
      completed_at: new Date().toISOString(),
    });
    return view(done ?? leased);
  }

  try {
    switch (leased.status) {
      case 'queued': {
        if (leased.reply_mode === 'generate_image' && !leased.image_blob_url) {
          const marker = await startImageGeneration({
            messageContent: leased.primary_text,
            messageTimestamp: Number(leased.message_timestamp),
            styleTag: (leased.style_tag as never) ?? undefined,
            entityKind: leased.entity_kind ?? undefined,
            entityId: leased.entity_id ?? undefined,
            sourceContext: (leased.source_context as never) ?? undefined,
            bluf: leased.primary_text.slice(0, 280),
            actorEmail,
          });
          if (!marker.ok) {
            return finalize(jobToken, 'failed', {
              error_code: 'image_generation_failed',
              error_message: marker.detail ?? marker.error ?? 'image generation failed',
            });
          }
          if (marker.status === 'ready' && marker.blobUrl) {
            return release(jobToken, {
              status: 'posting',
              image_blob_url: marker.blobUrl,
              generated_media_id: marker.generatedMediaId ?? null,
            });
          }
          return release(jobToken, {
            status: 'generating_image',
            generated_media_id: marker.generatedMediaId ?? null,
          });
        }
        return release(jobToken, { status: 'posting' });
      }

      case 'generating_image': {
        const media = await queryOne<{ status: string; blob_url: string | null }>(
          `SELECT status, blob_url FROM aegis_generated_media WHERE id = $1`,
          [leased.generated_media_id],
        );
        if (media?.status === 'ready' && media.blob_url) {
          return release(jobToken, { status: 'posting', image_blob_url: media.blob_url });
        }
        if (media?.status === 'failed') {
          return finalize(jobToken, 'failed', {
            error_code: 'image_generation_failed',
            error_message: 'image generation failed',
          });
        }
        return release(jobToken, {}); // still pending — release lease, stay generating_image
      }

      case 'posting': {
        const replyText =
          leased.publish_mode === 'two_post'
            ? composeReplyText(leased.reply_text ?? '', leased.source_url)
            : '';
        const core = await postCore({
          text: leased.primary_text,
          messageTimestamp: Number(leased.message_timestamp),
          publishMode: leased.publish_mode,
          replyText,
          imageBlobUrl: leased.image_blob_url,
          videoBlobUrl: leased.video_blob_url,
          sourceUrl: leased.source_url,
          alertEntityKind: leased.entity_kind,
          alertEntityId: leased.entity_id,
          actor,
        });
        if (core.ok) {
          return finalize(jobToken, 'posted', {
            tweet_ids: core.tweetIds,
            outbound_log_id: core.outboundLogId,
          });
        }
        // A surviving 401 (the in-client refresh+retry already failed) means the
        // grant is dead on X's side — prompt reconnect instead of a dead-end fail.
        if (core.error === 'no_token' || core.error === 'missing_scope' || core.status === 401) {
          return finalize(jobToken, 'needs_reconnect', {
            error_code: core.error,
            error_message: core.detail ?? null,
            tweet_ids: core.tweetIds,
            outbound_log_id: core.outboundLogId,
          });
        }
        return finalize(jobToken, 'failed', {
          error_code: core.error ?? 'twitter_api_error',
          error_message: core.detail ?? null,
          tweet_ids: core.tweetIds,
          outbound_log_id: core.outboundLogId,
        });
      }

      default:
        return view(leased);
    }
  } catch (err) {
    return finalize(jobToken, 'failed', {
      error_code: 'worker_error',
      error_message: err instanceof Error ? err.message.slice(0, 500) : String(err),
    });
  }
}

/** Apply a non-terminal patch + release the lease; return the fresh view. */
async function release(jobToken: string, fields: Record<string, unknown>): Promise<XPostJobView> {
  const row = await patchJob(jobToken, { ...fields, lease_until: null });
  return view(row!);
}

/** Apply a terminal status + release the lease + stamp completion. */
async function finalize(
  jobToken: string,
  status: Extract<XPostJobStatus, 'posted' | 'failed' | 'needs_reconnect'>,
  fields: Record<string, unknown>,
): Promise<XPostJobView> {
  const row = await patchJob(jobToken, {
    ...fields,
    status,
    lease_until: null,
    completed_at: new Date().toISOString(),
  });
  return view(row!);
}

/** Reaper: advance every stalled non-terminal job (called by the cron). */
export async function reapStalledXPostJobs(olderThanSeconds = 20): Promise<number> {
  const { rows } = await query<{ job_token: string; actor_email: string }>(
    `SELECT job_token, actor_email FROM aegis_x_post_jobs
     WHERE status NOT IN ('posted','failed','needs_reconnect')
       AND updated_at < NOW() - ($1 || ' seconds')::interval
     ORDER BY updated_at ASC LIMIT 25`,
    [String(olderThanSeconds)],
  );
  let advanced = 0;
  for (const r of rows) {
    await advanceXPostJob(r.job_token, r.actor_email, { id: 'cron:x-post-reaper' });
    advanced += 1;
  }
  return advanced;
}
