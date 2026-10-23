import { requireCapability } from '@/lib/security/capabilities';
import { privateBlobResponse } from '@/lib/storage/private-files';
/**
 * Twitter v2 write client (posting only).
 *
 * Pulls the active access token via getActiveToken() and POSTs to
 * POST https://api.x.com/2/tweets.
 *
 * Reference: https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
 *
 * Fail-soft contract: never throws. All errors are normalised into a
 * `{ ok: false, error }` payload so route handlers can return clean JSON
 * to the UI without try/catch noise.
 */

import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { X_LONGFORM_MAX_LENGTH } from '@/lib/twitter/length';
import {
  getActiveToken,
  getActiveTokenScopes,
  getMissingTwitterScopes,
  MEDIA_UPLOAD_REQUIRED_SCOPES,
} from '@/lib/twitter/oauth';

export { effectiveTweetLength } from '@/lib/twitter/length';

const POST_TWEET_URL = 'https://api.x.com/2/tweets';
const MEDIA_UPLOAD_URL = 'https://api.x.com/2/media/upload';
const MAX_TWEET_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TWEET_IMAGE_WIDTH = 1280;
const MAX_TWEET_IMAGE_HEIGHT = 1080;

export interface PostTweetInput {
  text: string;
  replyToTweetId?: string;
  mediaIds?: string[];
  /**
   * When true, short-circuit before hitting the X API: logs the intended
   * tweet and returns a synthetic `dry-<timestamp>` tweetId. Default is
   * computed from the environment:
   *   - production                                       → false (live)
   *   - non-prod without TWITTER_DEV_HANDLE_OVERRIDE     → true  (safe)
   *   - non-prod with TWITTER_DEV_HANDLE_OVERRIDE=1      → false (live to dev handle)
   *
   * This makes Phase 9.4 generators safe by default during dev/test —
   * the Phase 9.1 Approval Queue can exercise the publish path without
   * actually posting tweets. Set the override env var to test against a
   * provisioned `the configured X account` dev handle.
   */
  dryRun?: boolean;
}

export interface PostTweetResult {
  ok: boolean;
  tweetId?: string;
  /** Stable machine-readable error code. UI keys on these. */
  error?:
    | 'no_token'
    | 'empty_text'
    | 'text_too_long'
    | 'twitter_api_error'
    | 'network_error'
    | 'unknown';
  /** Human-readable detail for debugging / display. */
  detail?: string;
  /** Raw HTTP status from Twitter, if applicable. */
  status?: number;
  /** True when the result was synthesized via dryRun rather than a live post. */
  dryRun?: boolean;
}

export interface UploadTweetImageResult {
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
    | 'twitter_api_error'
    | 'network_error'
    | 'unknown';
  detail?: string;
  status?: number;
  dryRun?: boolean;
  missingScopes?: string[];
}

/** Monotonically-increasing counter for synthetic dry-run tweetIds. Without
 *  this, multiple postTweet calls in the same millisecond return identical
 *  `dry-<Date.now()>` IDs — production has API latency so this only affects
 *  dev output, but distinct IDs make the replyToTweetId threading visible
 *  in dry-run logs (T2→T1, T3→T2, T4→T3, ...). */
let dryRunCounter = 0;

/**
 * Resolve the effective dryRun flag from an explicit input + env.
 *
 *   - input.dryRun specified  → honor it (caller knows best)
 *   - production              → false
 *   - non-prod default        → true
 *   - non-prod + TWITTER_DEV_HANDLE_OVERRIDE=1 → false (live to dev handle)
 */
export function getDefaultDryRun(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.TWITTER_DEV_HANDLE_OVERRIDE !== '1';
}

export async function postTweet({
  text,
  replyToTweetId,
  mediaIds,
  dryRun,
}: PostTweetInput): Promise<PostTweetResult> {
  requireCapability('x');
  // ─── input validation ───
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    return { ok: false, error: 'empty_text', detail: 'Tweet text is empty' };
  }
  if (trimmed.length > X_LONGFORM_MAX_LENGTH) {
    return {
      ok: false,
      error: 'text_too_long',
      detail: `Post is ${trimmed.length}/${X_LONGFORM_MAX_LENGTH} characters`,
    };
  }

  // ─── dry-run short-circuit ───
  const effectiveDryRun = dryRun ?? getDefaultDryRun();
  if (effectiveDryRun) {
    const previewText = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
    console.log(
      `[postTweet] DRY RUN — would post${replyToTweetId ? ` (reply to ${replyToTweetId})` : ''}${mediaIds?.length ? ` with ${mediaIds.length} media` : ''}: ${previewText}`,
    );
    return { ok: true, tweetId: `dry-${Date.now()}-${++dryRunCounter}`, dryRun: true };
  }

  // ─── token ───
  let token = await getActiveToken();
  if (!token) {
    return { ok: false, error: 'no_token', detail: 'No active Twitter token (connect first)' };
  }

  // ─── request body ───
  const body: Record<string, unknown> = { text: trimmed };
  if (replyToTweetId) {
    body.reply = { in_reply_to_tweet_id: replyToTweetId };
  }
  const cleanMediaIds = (mediaIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (cleanMediaIds.length > 0) {
    body.media = { media_ids: cleanMediaIds };
  }

  const sendTweet = (bearer: string): Promise<Response> =>
    fetch(POST_TWEET_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
    });

  // ─── fire ───
  let res: Response;
  try {
    res = await sendTweet(token);
  } catch (err) {
    return {
      ok: false,
      error: 'network_error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  let json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  // ─── reactive 401 recovery ───
  // X can reject a token our DB still believes is valid (mid-life invalidation,
  // or a rotation that never persisted). Force a fresh token and retry exactly
  // once. If the refresh chain is dead, fall through to the 401 below — the job
  // worker maps a surviving 401 to "Reconnect X".
  if (res.status === 401) {
    console.error(
      '[twitter/write] 401 from /2/tweets — forcing token refresh + retrying once',
      json,
    );
    const fresh = await getActiveToken({ forceRefresh: true });
    if (fresh && fresh !== token) {
      token = fresh;
      try {
        res = await sendTweet(token);
      } catch (err) {
        return {
          ok: false,
          error: 'network_error',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    }
  }

  if (!res.ok) {
    console.error('[twitter/write] X API error', res.status, json);
    const detail = normalizePostErrorDetail(
      extractTwitterError(json) ?? `HTTP ${res.status}`,
      trimmed.length,
      res.status,
    );
    return { ok: false, error: 'twitter_api_error', detail, status: res.status };
  }

  // Twitter v2 success shape: { data: { id, text, edit_history_tweet_ids } }
  const data = json.data as Record<string, unknown> | undefined;
  const tweetId = data && typeof data.id === 'string' ? data.id : undefined;
  if (!tweetId) {
    return {
      ok: false,
      error: 'unknown',
      detail: 'Twitter returned 2xx but no tweet id',
      status: res.status,
    };
  }

  return { ok: true, tweetId };
}

function normalizePostErrorDetail(detail: string, charLength: number, status: number): string {
  if (charLength <= 280 || (status !== 400 && status !== 403)) return detail;
  return `X account/API did not accept long-form post; shorten or check Premium/API eligibility. ${detail}`;
}

export async function uploadTweetImageFromUrl(blobUrl: string): Promise<UploadTweetImageResult> {
  const trimmedUrl = typeof blobUrl === 'string' ? blobUrl.trim() : '';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return { ok: false, error: 'invalid_url', detail: 'Image URL is invalid' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      error: 'invalid_url',
      detail: 'Image URL must be HTTPS before it can be uploaded to X',
    };
  }

  if (getDefaultDryRun()) {
    console.log(`[uploadTweetImageFromUrl] DRY RUN — would upload ${trimmedUrl}`);
    return { ok: true, mediaId: `dry-media-${Date.now()}-${++dryRunCounter}`, dryRun: true };
  }

  const scopes = await getActiveTokenScopes();
  const missingScopes = scopes ? getMissingTwitterScopes(scopes, MEDIA_UPLOAD_REQUIRED_SCOPES) : [];
  if (missingScopes.length > 0) {
    return {
      ok: false,
      error: 'missing_scope',
      detail: `Reconnect X to grant ${missingScopes.join(', ')} before posting image replies.`,
      status: 403,
      missingScopes,
    };
  }

  const token = await getActiveToken();
  if (!token) {
    return { ok: false, error: 'no_token', detail: 'No active Twitter token (connect first)' };
  }

  let imageRes: Response;
  try {
    imageRes = await privateBlobResponse(trimmedUrl, 25 * 1024 * 1024);
  } catch (err) {
    return {
      ok: false,
      error: 'fetch_failed',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!imageRes.ok) {
    return {
      ok: false,
      error: 'fetch_failed',
      detail: `Image fetch failed with HTTP ${imageRes.status}`,
      status: imageRes.status,
    };
  }

  const mediaType = imageRes.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!mediaType?.startsWith('image/')) {
    return {
      ok: false,
      error: 'unsupported_media',
      detail: `Expected an image response, got ${mediaType ?? 'unknown content-type'}`,
    };
  }

  const sourceBytes = Buffer.from(await imageRes.arrayBuffer());
  const preparedImage = await prepareTweetImageForUpload(sourceBytes, mediaType);
  if (preparedImage.bytes.length > MAX_TWEET_IMAGE_BYTES) {
    return {
      ok: false,
      error: 'media_too_large',
      detail: `Image is ${preparedImage.bytes.length} bytes; X image uploads are capped at ${MAX_TWEET_IMAGE_BYTES} bytes`,
    };
  }

  const uploadBody = JSON.stringify({
    media: preparedImage.bytes.toString('base64'),
    media_category: 'tweet_image',
    media_type: preparedImage.mediaType,
  });

  // Retry transient network failures (DNS blip, connection reset, timeout) —
  // a single `fetch failed` was 502'ing whole posts. HTTP error *responses*
  // are not retried here; they're handled after the loop.
  let uploadRes: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      uploadRes = await fetch(MEDIA_UPLOAD_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: uploadBody,
      });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  if (!uploadRes) {
    return {
      ok: false,
      error: 'network_error',
      detail: lastErr instanceof Error ? lastErr.message : String(lastErr),
    };
  }

  const json = (await uploadRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!uploadRes.ok) {
    const detail = extractTwitterError(json) ?? `HTTP ${uploadRes.status}`;
    return {
      ok: false,
      error: 'twitter_api_error',
      detail,
      status: uploadRes.status,
    };
  }

  const data = json.data as Record<string, unknown> | undefined;
  const mediaId = data && typeof data.id === 'string' ? data.id : undefined;
  if (!mediaId) {
    return {
      ok: false,
      error: 'unknown',
      detail: 'Twitter media upload returned 2xx but no media id',
      status: uploadRes.status,
    };
  }

  return { ok: true, mediaId };
}

async function prepareTweetImageForUpload(
  bytes: Buffer,
  mediaType: string,
): Promise<{ bytes: Buffer; mediaType: string }> {
  let metadata: import('sharp').Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return { bytes, mediaType };
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const fitsDimensions =
    width > 0 && height > 0 && width <= MAX_TWEET_IMAGE_WIDTH && height <= MAX_TWEET_IMAGE_HEIGHT;

  if (fitsDimensions && bytes.length <= MAX_TWEET_IMAGE_BYTES) {
    return { bytes, mediaType };
  }

  const resized = await sharp(bytes)
    .rotate()
    .resize({
      width: MAX_TWEET_IMAGE_WIDTH,
      height: MAX_TWEET_IMAGE_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { bytes: resized, mediaType: 'image/png' };
}

/** Best-effort extraction of an error message from the Twitter v2 envelope. */
export function extractTwitterError(json: Record<string, unknown>): string | null {
  if (typeof json.detail === 'string') return json.detail;
  if (typeof json.title === 'string') return json.title;
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const first = json.errors[0] as Record<string, unknown>;
    if (typeof first?.message === 'string') return first.message;
  }
  return null;
}
