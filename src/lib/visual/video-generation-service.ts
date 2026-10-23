import { createHash } from 'node:crypto';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { reserveBudget } from '@/lib/security/budget';
import { requireCapability } from '@/lib/security/capabilities';
import { safeFetch } from '@/lib/security/safe-fetch';
import { checkOutboundVisualSpend } from '@/lib/security/visual-spend';
import { uploadVisualBlob } from '@/lib/storage/vercel-blob';
import type { GeneratedMediaMarker } from '@/lib/visual/image-generation-service';
import {
  HIGGSFIELD_SEEDANCE_MODEL,
  HIGGSFIELD_VIDEO_PROVIDER,
  HiggsfieldCliError,
  type HiggsfieldJobState,
  isTransientHiggsfieldError,
} from '@/lib/visual/providers/higgsfield-cli-video';
import { getVideoProvider } from '@/lib/visual/providers/video-provider';
import { type NormalizedVideoParams, normalizeVideoParams } from '@/lib/visual/video-params';
import type { VisualBriefSourceContext } from '@/lib/visual/visual-brief';

const VIDEO_STYLE_TAG = 'seedance_vertical';
// Bumped from video-v1: the dedup hash now includes the render parameters, so
// old hashes must not collide with new ones.
const VIDEO_SCHEMA_VERSION = 'video-v2';
const MAX_PROMPT_CHARS = 2400;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;
/** A pending row older than this can no longer block a re-render, and the
 *  reaper declares it dead. Seedance quotes ~1-3 min. */
const STALE_PENDING_MINUTES = 30;
const RENDER_TTL_MINUTES = 30;
const MAX_POLL_FAILURES = 5;
/** How long a finalize claim is honoured before another caller may take it
 *  over. Must exceed VIDEO_DOWNLOAD_TIMEOUT_MS plus the Blob upload. */
const FINALIZE_CLAIM_TTL_SECONDS = 180;

/**
 * A jsonb OBJECT we can safely `jsonb_set` on.
 *
 * `provider_payload` holds whatever the CLI returned. That is usually an object,
 * but `generate create` can answer with a bare ARRAY of job ids — and
 * `jsonb_set(<array>, '{__key}', …)` raises "path element at position 1 is not
 * an integer", which would abort the very failure-recording paths that are
 * supposed to keep a render from getting stuck. Preserve the original under
 * `__raw` rather than discarding it.
 */
const PAYLOAD_OBJECT = `CASE
  WHEN jsonb_typeof(provider_payload) = 'object' THEN provider_payload
  WHEN provider_payload IS NULL THEN '{}'::jsonb
  ELSE jsonb_build_object('__raw', provider_payload)
END`;

// Seedance bills in Higgsfield credits, not USD, and the create call doesn't
// return a price — so we book an estimate at insert time so video counts against
// the shared 24h visual spend cap (checkOutboundVisualSpend sums cost_usd).
//
// $/credit: Higgsfield top-up packs run ~$5 / 100 credits = $0.05/credit. We use
// that marginal rate (the bulk-subscription rate is a cheaper ~$0.033-0.039) so
// the spend cap can't under-count.
const VIDEO_CREDIT_USD = 0.05;

/**
 * Credits per second, measured against the live API with
 * `higgsfield generate cost seedance_2_0` at 4s / 8s / 15s per cell. Price is
 * exactly linear in duration within a cell, so one rate each is sufficient.
 *
 * An earlier version of this used a flat 3.5/sec with a guessed ×2 for `std`.
 * That is right only at 720p/fast — the one cell the UI could reach at the time
 * — and wrong in both directions everywhere else, most dangerously at 4k where
 * it under-counted by 3.1× (7.0 assumed vs 22.0 actual). Since the popover now
 * exposes resolution, and the agent tool always could, the priciest renders are
 * exactly the ones the 24h cap has to price correctly.
 *
 * `fast` has no 1080p/4k row because the API rejects that pairing (the CEL rule
 * `mode != "fast" || !(resolution in ["1080p","4k"])`); normalizeVideoParams
 * promotes such requests to `std` before they get here.
 */
const CREDITS_PER_SECOND: Record<string, Record<string, number>> = {
  fast: { '480p': 1.5, '720p': 3.5 },
  std: { '480p': 3.0, '720p': 4.5, '1080p': 9.0, '4k': 22.0 },
};

/** Costliest known rate. Used when a combination isn't in the table — a wrong
 *  guess must over-count, never under-count, or the cap stops being a cap. */
const MAX_CREDITS_PER_SECOND = 22.0;

export function estimateVideoCredits(
  durationSeconds: number,
  mode: string,
  resolution: string,
): number {
  const rate = CREDITS_PER_SECOND[mode]?.[resolution] ?? MAX_CREDITS_PER_SECOND;
  return rate * durationSeconds;
}

function estimateVideoCostUsd(durationSeconds: number, mode: string, resolution: string): number {
  const usd = estimateVideoCredits(durationSeconds, mode, resolution) * VIDEO_CREDIT_USD;
  return Math.round(usd * 100) / 100;
}

export interface StartVideoGenerationInput {
  content: string;
  messageTimestamp?: unknown;
  sourceContext?: VisualBriefSourceContext;
  entityKind?: string;
  entityId?: string;
  styleTag?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  mode?: string;
  genre?: string;
  actorEmail?: string | null;
}

interface ExistingVideoRow {
  id: string;
  blob_url: string | null;
  status: 'pending' | 'ready' | 'published' | 'failed';
  style_tag: string;
  provider_job_id: string | null;
  provider_status: string | null;
}

interface InsertedVideoRow {
  id: string;
}

interface RefreshVideoRow {
  id: string;
  status: string;
  blob_url: string | null;
  provider: string;
  provider_job_id: string | null;
  provider_status: string | null;
  style_tag: string;
}

function resolveMessageTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return Date.now();
}

function truncateClean(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}...`;
}

function sanitizeSeedanceNarrative(value: string): string {
  return value
    .replace(/\b(air\s*strike|airstrike|strike|bombing|missile|rocket|explosion)\b/gi, 'operation')
    .replace(/\b(weapon|weapons|gunfire|shooting)\b/gi, 'security event')
    .replace(/\b(killed|kills|killing|dead|death|deaths|fatalities|casualties)\b/gi, 'loss reports')
    .replace(/\b(injured|injury|wounded|blood|gore|bodies|body)\b/gi, 'sensitive field detail');
}

function asksForHumanPresenter(value: string): boolean {
  return /\b(presenter|host|anchor|narrator|spokesperson|reporter|woman|man|person|human|blonde|brunette|blue[-\s]?eyed|brown[-\s]?eyed|green[-\s]?eyed)\b/i.test(
    value,
  );
}

function buildSeedancePrompt(input: StartVideoGenerationInput): string {
  const content = truncateClean(sanitizeSeedanceNarrative(input.content), MAX_PROMPT_CHARS);
  const presenterDirection = asksForHumanPresenter(input.content)
    ? 'Presenter direction: a fictional adult professional presenter may appear. Use benign appearance descriptors from the user as visual direction. Keep wardrobe and framing broadcast-news appropriate.'
    : 'Visual direction: prioritize maps, network graphs, terminal overlays, signal lines, data walls, satellite-style silhouettes, and editorial title-card motion.';
  return [
    'Create a vertical cinematic intelligence brief video for Cocoa AI Threat Deck.',
    'Visual style: dark command-center, Matrix green interface light, Cocoa brown accent, precise editorial pacing.',
    presenterDirection,
    'Provider-safe treatment: clean editorial visuals, workplace-safe tone, fictional-only people if any appear, no incident reenactments.',
    `Sanitized narrative source: ${content}`,
  ].join('\n');
}

function providerFailureMessage(job: HiggsfieldJobState): string {
  const rawStatus = job.rawStatus.trim().toLowerCase();
  if (
    ['nsfw', 'moderated', 'blocked', 'rejected', 'content_policy', 'policy_violation'].includes(
      rawStatus,
    )
  ) {
    return `Higgsfield moderation blocked this Seedance prompt (${rawStatus}). Try a more neutral editorial wording or regenerate.`;
  }
  return `Higgsfield video generation failed (${job.rawStatus}).`;
}

function mediaStatusFromProvider(status: string): 'pending' | 'ready' | 'failed' {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  return 'pending';
}

export async function startVideoGeneration(
  input: StartVideoGenerationInput,
): Promise<GeneratedMediaMarker> {
  requireCapability('media');
  const content = input.content.trim();
  if (!content) {
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      error: 'content is required',
    };
  }

  const spendCheck = await checkOutboundVisualSpend();
  if (!spendCheck.allowed) {
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_VISUAL_BLOCKED_COST,
      outcome: 'denied',
      actorId: input.actorEmail ?? 'agent:tool:generate_video',
      targetKind: 'generated_media',
      details: {
        mediaKind: 'video',
        estimatedSpend24hUsd: spendCheck.estimatedSpend24hUsd,
        hardCapUsd: spendCheck.hardCapUsd,
        reason: spendCheck.reason,
      },
    }).catch((err: unknown) => console.error('[generate-video] audit BLOCKED_COST failed:', err));

    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      error: 'visual_spend_cap_exceeded',
      detail: `Daily visual spend hard cap of $${spendCheck.hardCapUsd} reached.`,
    };
  }

  const styleTag = input.styleTag?.trim() || VIDEO_STYLE_TAG;
  const params = normalizeVideoParams(input);
  const prompt = buildSeedancePrompt(input);
  // The render knobs MUST be part of the dedup identity. They never reach the
  // prompt text, so hashing the prompt alone meant re-rendering the same message
  // at a different Length/Format/Genre silently returned the previous clip.
  const messageHash = createHash('sha256')
    .update(
      JSON.stringify({
        ownerEmail: input.actorEmail,
        schemaVersion: VIDEO_SCHEMA_VERSION,
        styleTag,
        prompt,
        params,
        sourceContext: input.sourceContext ?? null,
      }),
    )
    .digest('hex');

  // A 'pending' row only blocks a re-render while it could plausibly still be
  // live. Without the age bound, one row orphaned by an outage matched every
  // subsequent identical request forever and the feature stayed wedged.
  const existingResult = await query<ExistingVideoRow>(
    `SELECT id::text, blob_url, status, style_tag, provider_job_id, provider_status
       FROM aegis_generated_media
       WHERE source_agent_message_hash = $1
         AND style_tag = $2
         AND media_kind = 'video'
         AND (
           status IN ('ready', 'published')
           OR (status = 'pending' AND created_at > now() - ($3 || ' minutes')::interval)
         )
       ORDER BY id DESC
       LIMIT 1`,
    [messageHash, styleTag, String(STALE_PENDING_MINUTES)],
  );

  let existingRow = existingResult.rows[0];
  if (existingRow) {
    // Don't claim "already running" on faith — drive the job forward first, so
    // a dead render reports as dead instead of as in-flight, and one that has
    // just finished reports its blob instead of another spinner.
    if (existingRow.status === 'pending') {
      await refreshGeneratedVideoIfNeeded(existingRow.id).catch((err: unknown) =>
        console.error('[generate-video] dedup liveness refresh failed:', err),
      );
      const recheck = await query<ExistingVideoRow>(
        `SELECT id::text, blob_url, status, style_tag, provider_job_id, provider_status
           FROM aegis_generated_media WHERE id = $1`,
        [existingRow.id],
      );
      const fresh = recheck.rows[0];
      if (fresh?.status === 'failed') {
        return {
          ok: false,
          __generated_media: true,
          mediaKind: 'video',
          error: 'previous_render_failed',
          detail: 'The previous render of this response failed. Generate again to retry.',
        };
      }
      if (fresh) existingRow = fresh;
    }
    const done = existingRow.status === 'ready' || existingRow.status === 'published';
    return {
      ok: true,
      __generated_media: true,
      mediaKind: 'video',
      generatedMediaId: existingRow.id,
      status: existingRow.status,
      blobUrl: existingRow.blob_url
        ? `/api/outbound/generated-media/${existingRow.id}/content`
        : null,
      styleTag: existingRow.style_tag,
      pollUrl: `/api/outbound/generated-media/${existingRow.id}`,
      dedup: true,
      instruction: done
        ? 'Video is ready. Mention that the generated video is attached below the response.'
        : 'Seedance video generation is already running. Tell the user the clip is being generated and will attach when ready.',
    };
  }

  let job: HiggsfieldJobState;
  try {
    const provider = getVideoProvider();
    const release = await reserveBudget('media', Number(process.env.VIDEO_RESERVATION_USD || 20));
    try {
      job = await provider.startVideo({
        prompt,
        aspectRatio: params.aspectRatio,
        durationSeconds: params.durationSeconds,
        resolution: params.resolution,
        mode: params.mode,
        genre: params.genre,
      });
    } finally {
      await release();
    }
  } catch (err) {
    // Record the failure BEFORE returning. Previously a start-time failure wrote
    // nothing at all — no row, no audit, no log — so the only trace was the
    // popover text, which vanished when the popover closed.
    await recordStartFailure(input, styleTag, prompt, messageHash, params, err);
    return higgfieldErrorMarker(err);
  }

  const insertResult = await query<InsertedVideoRow>(
    `INSERT INTO aegis_generated_media (
         entity_kind,
         entity_id,
         media_kind,
         style_tag,
         provider,
         model_version,
         status,
         prompt_used,
         source_agent_message_ts,
         source_agent_message_hash,
         visual_schema_version,
         visual_payload,
         source_context,
         provider_job_id,
         provider_status,
         provider_payload,
         cost_usd, owner_email
       ) VALUES (
         $1, $2, 'video', $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15::jsonb, $16, $17
       )
       RETURNING id::text`,
    [
      input.entityKind ?? null,
      input.entityId ?? null,
      styleTag,
      HIGGSFIELD_VIDEO_PROVIDER,
      HIGGSFIELD_SEEDANCE_MODEL,
      // Never insert 'ready' — blob_url is still NULL at this point, and a
      // 'ready'-but-blobless row is unreachable by every repair path
      // (refresh early-returns on ready; the poll route only refreshes pending).
      // finalizeVideoJob is the sole writer of 'ready'.
      job.status === 'failed' ? 'failed' : 'pending',
      prompt,
      resolveMessageTimestamp(input.messageTimestamp),
      messageHash,
      VIDEO_SCHEMA_VERSION,
      JSON.stringify({ schemaVersion: VIDEO_SCHEMA_VERSION, ...params }),
      JSON.stringify(input.sourceContext ?? null),
      job.jobId,
      job.rawStatus,
      JSON.stringify(job.raw),
      estimateVideoCostUsd(params.durationSeconds, params.mode, params.resolution),
      input.actorEmail ?? null,
    ],
  );

  const insertedRow = insertResult.rows[0];
  if (!insertedRow) {
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      error: 'db_insert_failed',
    };
  }

  // Moderation can reject synchronously at create time (we have real 'nsfw'
  // rows). Reporting that as "generation has started" told the operator — and
  // Max — that work was in flight which had already been refused.
  if (job.status === 'failed') {
    const message = providerFailureMessage(job);
    await query(`UPDATE aegis_generated_media SET error_message = $2 WHERE id = $1`, [
      insertedRow.id,
      message,
    ]);
    void auditVideoFailure(input.actorEmail, insertedRow.id, job.rawStatus, message);
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      generatedMediaId: insertedRow.id,
      status: 'failed',
      error: 'provider_rejected',
      detail: message,
      instruction: message,
    };
  }

  if (job.status === 'ready' && job.resultUrl) {
    void finalizeVideoJob(insertedRow.id, job.resultUrl, job.status, job.raw).catch(
      (err: unknown) => console.error('[generate-video] immediate finalize failed:', err),
    );
  }

  return {
    ok: true,
    __generated_media: true,
    mediaKind: 'video',
    generatedMediaId: insertedRow.id,
    status: 'pending',
    pollUrl: `/api/outbound/generated-media/${insertedRow.id}`,
    styleTag,
    providerJobId: job.jobId,
    providerStatus: job.rawStatus,
    instruction:
      'Seedance video generation has started. Tell the user the clip is rendering in the media card below and will switch to playable video automatically when ready. Do not say the capability is missing or hedge about backend initialization.',
  };
}

export async function refreshGeneratedVideoIfNeeded(generatedMediaId: string): Promise<void> {
  const result = await query<RefreshVideoRow>(
    `SELECT id::text, status, blob_url, provider, provider_job_id, provider_status, style_tag
       FROM aegis_generated_media
       WHERE id = $1 AND media_kind = 'video'
       LIMIT 1`,
    [generatedMediaId],
  );
  const row = result.rows[0];
  if (!row || row.provider !== HIGGSFIELD_VIDEO_PROVIDER) return;
  if (row.status === 'ready' || row.status === 'published' || row.status === 'failed') return;
  if (!row.provider_job_id) return;

  let job: HiggsfieldJobState;
  try {
    const provider = getVideoProvider();
    job = await provider.getJob(row.provider_job_id);
  } catch (err) {
    // A transport fault proves we could not ASK about the render — not that the
    // render died. Marking 'failed' here is terminal (line ~323 early-returns on
    // it), so a fly deploy, a cold start past the abort, or one 502 used to kill
    // a job that was still rendering fine and still burning credits.
    // Transients stay pending; the reaper fails them on attempts/age.
    const transient = !(err instanceof HiggsfieldCliError) || isTransientHiggsfieldError(err.code);
    const message = err instanceof HiggsfieldCliError ? err.remediation : String(err);
    if (transient) {
      await recordPollFailure(generatedMediaId, message);
      return;
    }
    await query(
      `UPDATE aegis_generated_media
          SET status = 'failed',
              provider_status = $2,
              error_message = $3
        WHERE id = $1`,
      [generatedMediaId, 'failed', message],
    );
    return;
  }

  const nextStatus = mediaStatusFromProvider(job.status);
  if (nextStatus === 'ready' && job.resultUrl) {
    // Download/upload can fail (expired result URL, Blob token). Previously this
    // threw out of refresh → HTTP 500 → both client pollers `continue`, so the
    // card span forever with no error recorded anywhere.
    try {
      await finalizeVideoJob(generatedMediaId, job.resultUrl, job.status, job.raw);
    } catch (err) {
      await recordPollFailure(
        generatedMediaId,
        `Downloading the finished video failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // 'ready' with no result URL must NOT be written as ready. Only finalizeVideoJob
  // may set that status, because 'ready' + blob_url NULL is unrecoverable: refresh
  // early-returns on ready, the reaper only scans pending, and the poll route only
  // refreshes pending — so the row is done forever with nothing to play, while the
  // dedup branch cheerfully tells Max the video is attached. Keep it pending and
  // let the reaper's TTL be the arbiter. Reachable if the provider reports done
  // before publishing the URL, or if a CLI upgrade renames the field.
  const persistStatus = nextStatus === 'ready' ? 'pending' : nextStatus;
  if (nextStatus === 'ready') {
    await recordPollFailure(
      generatedMediaId,
      'Higgsfield reported the render complete but returned no video URL yet.',
    );
  }

  await query(
    `UPDATE aegis_generated_media
        SET status = $2,
            provider_status = $3,
            provider_payload = $4::jsonb,
            error_message = CASE WHEN $2 = 'failed' THEN $5 ELSE error_message END
      WHERE id = $1`,
    [
      generatedMediaId,
      persistStatus,
      job.rawStatus,
      JSON.stringify(job.raw),
      providerFailureMessage(job),
    ],
  );
}

async function finalizeVideoJob(
  generatedMediaId: string,
  resultUrl: string,
  providerStatus = 'ready',
  providerPayload: unknown = null,
): Promise<void> {
  // Claim the row before doing expensive work. Two pollers can observe the same
  // finished job simultaneously; without this both download and upload it.
  //
  // The claim MUST expire. A bare `provider_status <> 'finalizing'` guard would
  // be permanent: if the process dies mid-download (serverless timeout, deploy,
  // crash) nothing releases it, so every later attempt — including the reaper's
  // — short-circuits here and the row is stranded pending forever with a
  // perfectly good MP4 sitting on Higgsfield. Stamping the claim time makes it
  // self-healing.
  const claim = await query<{ id: string }>(
    `UPDATE aegis_generated_media
        SET provider_status = 'finalizing',
            provider_payload = jsonb_set(
              ${PAYLOAD_OBJECT},
              '{__finalizingAt}',
              to_jsonb(EXTRACT(EPOCH FROM now()))
            )
      WHERE id = $1
        AND blob_url IS NULL
        AND (
          provider_status IS DISTINCT FROM 'finalizing'
          OR COALESCE((provider_payload->>'__finalizingAt')::float, 0)
             < EXTRACT(EPOCH FROM now()) - $2
        )
      RETURNING id::text`,
    [generatedMediaId, String(FINALIZE_CLAIM_TTL_SECONDS)],
  );
  if (!claim.rows[0]) return;

  let upload: Awaited<ReturnType<typeof uploadVisualBlob>>;
  let contentType = '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIDEO_DOWNLOAD_TIMEOUT_MS);
    let res: Response;
    try {
      res = await safeFetch(resultUrl, { signal: controller.signal }, 64 * 1024 * 1024);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`video download failed with HTTP ${res.status}`);
    }
    contentType = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
    // Reject rather than coerce: forcing 'video/mp4' onto an HTML error page or
    // a thumbnail would publish a corrupt asset labelled ready.
    if (
      contentType &&
      !contentType.startsWith('video/') &&
      contentType !== 'application/octet-stream'
    ) {
      throw new Error(`expected a video, got content-type ${contentType}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1024) {
      throw new Error('video provider returned an unexpectedly small video buffer');
    }

    upload = await uploadVisualBlob(`outbound-videos/seedance/${generatedMediaId}.mp4`, buffer, {
      contentType: contentType.startsWith('video/') ? contentType : 'video/mp4',
    });
  } catch (err) {
    // Release the claim, or the retry guard above locks the row out of every
    // future finalize attempt — trading one stuck state for another.
    await query(
      `UPDATE aegis_generated_media SET provider_status = $2 WHERE id = $1 AND provider_status = 'finalizing'`,
      [generatedMediaId, providerStatus],
    ).catch(() => undefined);
    throw err;
  }

  await query(
    `UPDATE aegis_generated_media
        SET status = 'ready',
            blob_url = $2,
            blob_size_bytes = $3,
            generation_duration_ms = COALESCE(generation_duration_ms, 0),
            provider_status = $4,
            provider_payload = $5::jsonb
      WHERE id = $1`,
    [
      generatedMediaId,
      upload.url,
      upload.size,
      providerStatus,
      JSON.stringify(providerPayload ?? { resultUrl }),
    ],
  );
}

/**
 * Track consecutive poll failures inside provider_payload rather than adding a
 * column. The reaper uses this (plus row age) to decide when a render that we
 * keep failing to reach should finally be declared dead.
 */
async function recordPollFailure(generatedMediaId: string, message: string): Promise<void> {
  await query(
    `UPDATE aegis_generated_media
        SET error_message = $2,
            provider_payload = jsonb_set(
              ${PAYLOAD_OBJECT},
              '{__pollFailures}',
              to_jsonb(COALESCE(NULLIF(provider_payload->>'__pollFailures', '')::int, 0) + 1)
            )
      WHERE id = $1 AND status = 'pending'`,
    [generatedMediaId, message],
  );
}

async function auditVideoFailure(
  actorEmail: string | null | undefined,
  generatedMediaId: string | null,
  code: string,
  message: string,
): Promise<void> {
  // Auditing must never be the reason a failure path itself fails.
  try {
    await recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_VISUAL_FAILED,
      outcome: 'failure',
      actorId: actorEmail ?? 'agent:tool:generate_video',
      targetKind: 'generated_media',
      ...(generatedMediaId ? { targetId: generatedMediaId } : {}),
      errorMessage: message,
      details: { mediaKind: 'video', code },
    });
  } catch (err) {
    console.error('[generate-video] audit VISUAL_FAILED failed:', err);
  }
}

/** Persist a start-time failure so it is queryable, auditable and renderable
 *  instead of living only in a popover that closes. */
async function recordStartFailure(
  input: StartVideoGenerationInput,
  styleTag: string,
  prompt: string,
  messageHash: string,
  params: NormalizedVideoParams,
  err: unknown,
): Promise<void> {
  const code = err instanceof HiggsfieldCliError ? err.code : 'generate_video_failed';
  const message = err instanceof HiggsfieldCliError ? err.remediation : String(err);
  const detail = err instanceof HiggsfieldCliError ? (err.detail ?? '') : '';
  console.error(`[generate-video] start failed (${code}):`, detail || message);

  let insertedId: string | null = null;
  try {
    const inserted = await query<InsertedVideoRow>(
      `INSERT INTO aegis_generated_media (
           entity_kind, entity_id, media_kind, style_tag, provider, model_version,
           status, prompt_used, source_agent_message_ts, source_agent_message_hash,
           visual_schema_version, visual_payload, source_context, provider_status,
           error_message, cost_usd
         ) VALUES ($1,$2,'video',$3,$4,$5,'failed',$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,0)
         RETURNING id::text`,
      [
        input.entityKind ?? null,
        input.entityId ?? null,
        styleTag,
        HIGGSFIELD_VIDEO_PROVIDER,
        HIGGSFIELD_SEEDANCE_MODEL,
        prompt,
        resolveMessageTimestamp(input.messageTimestamp),
        messageHash,
        VIDEO_SCHEMA_VERSION,
        JSON.stringify({ schemaVersion: VIDEO_SCHEMA_VERSION, ...params }),
        JSON.stringify(input.sourceContext ?? null),
        code,
        message,
      ],
    );
    insertedId = inserted.rows[0]?.id ?? null;
  } catch (dbErr) {
    console.error('[generate-video] could not record start failure:', dbErr);
  }

  await auditVideoFailure(input.actorEmail, insertedId, code, message);
}

/**
 * Backstop for renders nobody is polling.
 *
 * Intentionally UNBOUNDED in age: `status='pending'` is already highly selective
 * (and covered by idx_gm_status). An age floor here would create a permanent
 * orphan bucket — anything that outlived the window during a cron outage, or
 * predates this code, would never be reaped at all. `refreshGeneratedVideoIfNeeded` only
 * runs on a client request, so closing the tab mid-render left the MP4 stranded
 * on Higgsfield with the credits already spent. Called by /api/cron/media-reaper.
 */
export async function reapStalledVideoRenders(): Promise<{ advanced: number; failed: number }> {
  const stalled = await query<{ id: string; age_minutes: number; poll_failures: number }>(
    `SELECT id::text,
            EXTRACT(EPOCH FROM (now() - created_at)) / 60 AS age_minutes,
            COALESCE((provider_payload->>'__pollFailures')::int, 0) AS poll_failures
       FROM aegis_generated_media
      WHERE media_kind = 'video'
        AND status = 'pending'
      ORDER BY id ASC
      LIMIT 50`,
  );

  let advanced = 0;
  let failed = 0;
  for (const row of stalled.rows) {
    if (row.age_minutes > RENDER_TTL_MINUTES || row.poll_failures >= MAX_POLL_FAILURES) {
      await query(
        `UPDATE aegis_generated_media
            SET status = 'failed',
                provider_status = 'abandoned',
                error_message = COALESCE(
                  error_message,
                  'Render never completed and has been abandoned after ' || $2 || ' minutes.'
                )
          WHERE id = $1 AND status = 'pending'`,
        [row.id, String(RENDER_TTL_MINUTES)],
      );
      failed += 1;
      continue;
    }
    try {
      await refreshGeneratedVideoIfNeeded(row.id);
      advanced += 1;
    } catch (err) {
      console.error(`[media-reaper] refresh failed for ${row.id}:`, err);
    }
  }

  return { advanced, failed };
}

function higgfieldErrorMarker(err: unknown): GeneratedMediaMarker {
  if (err instanceof HiggsfieldCliError) {
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'video',
      error: err.code,
      // Transport-aware remediation, not the raw message — this string is shown
      // verbatim in the popover AND relayed by Max.
      detail: err.remediation,
      instruction: err.remediation,
    };
  }
  return {
    ok: false,
    __generated_media: true,
    mediaKind: 'video',
    error: 'generate_video_failed',
    detail: err instanceof Error ? err.message : String(err),
  };
}
