import { privateBlobResponse } from '@/lib/storage/private-files';
/**
 * Twitter v2 chunked video upload: INIT → APPEND(chunks) → FINALIZE → STATUS poll.
 *
 * The simple base64 upload in write-client.ts is image-only (it rejects non-image
 * content and re-encodes via sharp). Video needs the chunked command flow with
 * media_category=tweet_video plus async processing. Auth + the media.write scope
 * are identical to the image path, so we reuse them.
 *
 * Fail-soft: never throws; always returns a normalized result.
 *
 * Note: X requires H.264 video / AAC (or silent) MP4. A codec mismatch surfaces
 * here as a FINALIZE/STATUS `processing_info.state === 'failed'` → 'processing_failed'.
 */

import { Buffer } from 'node:buffer';
import {
  getActiveToken,
  getActiveTokenScopes,
  getMissingTwitterScopes,
  MEDIA_UPLOAD_REQUIRED_SCOPES,
} from '@/lib/twitter/oauth';
import { extractTwitterError, getDefaultDryRun } from '@/lib/twitter/write-client';

const MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload';
const MAX_TWEET_VIDEO_BYTES = 64 * 1024 * 1024; // X allows ~512MB; our Seedance clips are a few MB
const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024; // X APPEND cap is 5MB/chunk; stay under it
const STATUS_MAX_POLLS = 40;
const STATUS_DEFAULT_DELAY_MS = 2_000;

let dryRunCounter = 0;

export interface UploadTweetVideoResult {
  ok: boolean;
  mediaId?: string;
  error?:
    | 'dry_run'
    | 'invalid_url'
    | 'fetch_failed'
    | 'unsupported_media'
    | 'media_too_large'
    | 'missing_scope'
    | 'no_token'
    | 'processing_failed'
    | 'twitter_api_error'
    | 'network_error'
    | 'unknown';
  detail?: string;
  status?: number;
  dryRun?: boolean;
  missingScopes?: string[];
}

interface ProcessingInfo {
  state: string;
  checkAfterSecs?: number;
  errorMessage?: string;
}

type CommandResult =
  | { ok: true; json: Record<string, unknown>; status: number }
  | { ok: false; error: UploadTweetVideoResult };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadTweetVideoFromUrl(blobUrl: string): Promise<UploadTweetVideoResult> {
  const trimmedUrl = typeof blobUrl === 'string' ? blobUrl.trim() : '';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return { ok: false, error: 'invalid_url', detail: 'Video URL is invalid' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      error: 'invalid_url',
      detail: 'Video URL must be HTTPS before upload to X',
    };
  }

  if (getDefaultDryRun()) {
    console.log(`[uploadTweetVideoFromUrl] DRY RUN — would upload ${trimmedUrl}`);
    return { ok: true, mediaId: `dry-video-${Date.now()}-${++dryRunCounter}`, dryRun: true };
  }

  const scopes = await getActiveTokenScopes();
  const missingScopes = scopes ? getMissingTwitterScopes(scopes, MEDIA_UPLOAD_REQUIRED_SCOPES) : [];
  if (missingScopes.length > 0) {
    return {
      ok: false,
      error: 'missing_scope',
      detail: `Reconnect X to grant ${missingScopes.join(', ')} before posting video.`,
      status: 403,
      missingScopes,
    };
  }

  const token = await getActiveToken();
  if (!token) {
    return { ok: false, error: 'no_token', detail: 'No active Twitter token (connect first)' };
  }

  // ─── fetch the MP4 from blob storage ───
  let videoRes: Response;
  try {
    videoRes = await privateBlobResponse(trimmedUrl, 64 * 1024 * 1024);
  } catch (err) {
    return {
      ok: false,
      error: 'fetch_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!videoRes.ok) {
    return {
      ok: false,
      error: 'fetch_failed',
      detail: `Video fetch failed with HTTP ${videoRes.status}`,
      status: videoRes.status,
    };
  }
  const mediaType =
    videoRes.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'video/mp4';
  if (!mediaType.startsWith('video/')) {
    return {
      ok: false,
      error: 'unsupported_media',
      detail: `Expected a video response, got ${mediaType}`,
    };
  }
  const bytes = Buffer.from(await videoRes.arrayBuffer());
  if (bytes.length === 0) {
    return { ok: false, error: 'fetch_failed', detail: 'Video response was empty' };
  }
  if (bytes.length > MAX_TWEET_VIDEO_BYTES) {
    return {
      ok: false,
      error: 'media_too_large',
      detail: `Video is ${bytes.length} bytes; X uploads here are capped at ${MAX_TWEET_VIDEO_BYTES} bytes`,
    };
  }

  // ─── INIT ─── POST /2/media/upload/initialize (application/json)
  const init = await mediaCommand(token, `${MEDIA_UPLOAD_URL}/initialize`, {
    media_category: 'tweet_video',
    media_type: mediaType,
    total_bytes: bytes.length,
  });
  if (!init.ok) return init.error;
  const mediaId = parseMediaId(init.json);
  if (!mediaId) {
    return {
      ok: false,
      error: 'unknown',
      detail: 'X INIT returned no media id',
      status: init.status,
    };
  }
  const mediaPath = `${MEDIA_UPLOAD_URL}/${encodeURIComponent(mediaId)}`;

  // ─── APPEND chunks ─── POST /2/media/upload/{id}/append as multipart/form-data
  // with the RAW binary chunk. Base64-in-JSON inflates the body ~33% (a 4MB chunk
  // → ~5.46MB), which trips X's per-segment size cap → HTTP 413; binary multipart
  // sends the bytes as-is and stays under the 5MB limit.
  let segmentIndex = 0;
  for (let offset = 0; offset < bytes.length; offset += VIDEO_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + VIDEO_CHUNK_BYTES, bytes.length));
    const appendForm = new FormData();
    appendForm.set('segment_index', String(segmentIndex));
    appendForm.set('media', new Blob([chunk], { type: 'application/octet-stream' }));
    // No explicit content-type — fetch derives the multipart boundary from FormData.
    const append = await sendMediaRequest(`${mediaPath}/append`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: appendForm,
    });
    if (!append.ok) return append.error;
    segmentIndex += 1;
  }

  // ─── FINALIZE ─── POST /2/media/upload/{id}/finalize (no body)
  const finalize = await mediaCommand(token, `${mediaPath}/finalize`);
  if (!finalize.ok) return finalize.error;

  // ─── STATUS poll while X transcodes ───
  let processing = parseProcessingInfo(finalize.json);
  let polls = 0;
  while (processing && (processing.state === 'pending' || processing.state === 'in_progress')) {
    if (polls >= STATUS_MAX_POLLS) {
      return { ok: false, error: 'processing_failed', detail: 'Video processing timed out on X' };
    }
    const secs = processing.checkAfterSecs ?? 0;
    await delay(secs > 0 ? secs * 1000 : STATUS_DEFAULT_DELAY_MS);
    polls += 1;
    const status = await statusCommand(token, mediaId);
    if (!status.ok) return status.error;
    processing = parseProcessingInfo(status.json);
  }

  if (processing && processing.state === 'failed') {
    return {
      ok: false,
      error: 'processing_failed',
      detail:
        processing.errorMessage ??
        'X rejected the video during processing (likely codec — X requires H.264/AAC MP4)',
    };
  }

  return { ok: true, mediaId };
}

/** Shared fetch + retry + error-normalization for every chunked-upload request. */
async function sendMediaRequest(url: string, init: RequestInit): Promise<CommandResult> {
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(url, init);
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await delay(attempt * 500);
    }
  }
  if (!res) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'network_error',
        detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
      },
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'twitter_api_error',
        detail: extractTwitterError(json) ?? `HTTP ${res.status}`,
        status: res.status,
      },
    };
  }
  return { ok: true, json, status: res.status };
}

/**
 * JSON command for the sub-path endpoints that carry no binary payload — INIT
 * (/initialize) and FINALIZE (/{id}/finalize). X validates these as
 * application/json (the legacy multipart `command=INIT` form on the base
 * /2/media/upload endpoint is rejected as "parameters invalid" — that base
 * endpoint is simple-upload-only now, the same JSON contract the working image
 * upload in write-client.ts uses). APPEND is multipart binary instead (see below).
 */
function mediaCommand(
  token: string,
  url: string,
  payload: Record<string, unknown> = {},
): Promise<CommandResult> {
  return sendMediaRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
}

async function statusCommand(token: string, mediaId: string): Promise<CommandResult> {
  let res: Response;
  try {
    res = await fetch(
      `${MEDIA_UPLOAD_URL}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      },
    );
  } catch (err) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'network_error',
        detail: err instanceof Error ? err.message : String(err),
      },
    };
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'twitter_api_error',
        detail: extractTwitterError(json) ?? `HTTP ${res.status}`,
        status: res.status,
      },
    };
  }
  return { ok: true, json, status: res.status };
}

function parseMediaId(json: Record<string, unknown>): string | null {
  const data = json.data as Record<string, unknown> | undefined;
  if (data && typeof data.id === 'string' && data.id.trim()) return data.id;
  if (data && typeof data.media_id_string === 'string' && data.media_id_string.trim()) {
    return data.media_id_string;
  }
  if (typeof json.media_id_string === 'string' && json.media_id_string.trim()) {
    return json.media_id_string;
  }
  return null;
}

function parseProcessingInfo(json: Record<string, unknown>): ProcessingInfo | null {
  const data = json.data as Record<string, unknown> | undefined;
  const pi = (data?.processing_info ?? json.processing_info) as Record<string, unknown> | undefined;
  if (!pi || typeof pi.state !== 'string') return null;
  const errObj = pi.error as Record<string, unknown> | undefined;
  return {
    state: pi.state,
    checkAfterSecs: typeof pi.check_after_secs === 'number' ? pi.check_after_secs : undefined,
    errorMessage: errObj && typeof errObj.message === 'string' ? errObj.message : undefined,
  };
}
