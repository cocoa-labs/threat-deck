/**
 * Phase 13 Tier 5.1 — Agent-tool handlers for outbound side-effects.
 *
 * Kept distinct from aegis-tool-handlers.ts because outbound has different
 * concerns from data retrieval: side-effects, recipient resolution, audit
 * fan-out, per-recipient outbound_log dedup. AEGIS handlers are pure
 * data-retrieval; mixing them would muddle the boundary.
 *
 * Current tool inventory:
 *   - email_conversation — composes + ships email to operator/custom/team recipients
 */

import { fetchRepliesForConversation } from '@/lib/data/collectors/twitter';
import { query } from '@/lib/db/client';
import { getRecentSentEmails, touchEmailChecked } from '@/lib/db/queries/email-threads';
import { getRecentXPosts, touchXPostChecked } from '@/lib/db/queries/x-posts';
import type { MediaAttachmentItem } from '@/lib/email/attachments';
import { isSandboxSender, senderAddress } from '@/lib/email/resend';
import { fetchRepliesForThread } from '@/lib/email/transports/gmail-read';
import {
  buildXThreadDirective,
  composeThread,
  type EmailDraft,
  GENERAL_POST_SYSTEM,
  stageDraft,
  type ThreadDraft,
  type XPostShape,
} from '@/lib/twitter/content';
import { buildTweetUrl } from '@/lib/twitter/permalink';
import {
  type GeneratedMediaMarker,
  startImageGeneration,
} from '@/lib/visual/image-generation-service';
import {
  refreshGeneratedVideoIfNeeded,
  startVideoGeneration,
} from '@/lib/visual/video-generation-service';
import { normalizeVideoParams } from '@/lib/visual/video-params';

/** Cap content sent to email to keep render + Resend payload bounded. */
const MAX_CONTENT_BYTES = 50_000;

/** Allowed `kind` values. Extends ResolveRecipientsInput's input vocabulary. */

export type ResolveRecipientsInput = {
  /** "To" entries the agent passed — email addresses or 'team:X' aliases. */
  to: string[];
  /** "Cc" entries the agent passed. */
  cc: string[];
  /** "Bcc" entries the agent passed. */
  bcc: string[];
  /** Operator's session email — the default "To" target and always self-allowed. */
  operatorEmail: string | null;
};

export type ResolveRecipientsResult =
  | { ok: true; to: string[]; cc: string[]; bcc: string[] }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_PREFIX = 'team:';

/**
 * Public email providers whose *whole* domain must not be auto-trusted just
 * because the operator happens to use one — otherwise an operator on gmail.com
 * could email any @gmail.com address. For these, only the operator's exact
 * address is self-allowed; org domains must be named in EMAIL_DOMAIN_ALLOWLIST.
 */
const PUBLIC_EMAIL_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'zoho.com',
]);

function domainOf(addr: string): string {
  return addr.slice(addr.lastIndexOf('@') + 1).toLowerCase();
}

/** Parse EMAIL_DOMAIN_ALLOWLIST into a lowercased domain set (strips a leading '@'). */
function parseDomainAllowlist(): Set<string> {
  return new Set(
    (process.env.EMAIL_DOMAIN_ALLOWLIST ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  );
}

/** All valid EMAIL_ME_RECIPIENT entries (the operator's configured inboxes). */
function envMeRecipients(): string[] {
  const out: string[] = [];
  for (const m of (process.env.EMAIL_ME_RECIPIENT ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (EMAIL_RE.test(m) && !out.includes(m)) out.push(m);
  }
  return out;
}

/**
 * Expand one recipient list (to/cc/bcc) into concrete addresses. Each entry is
 * a plain address or a 'team:X' alias resolved via EMAIL_TEAM_X. Returns an
 * error string on any invalid entry/alias (surfaced to the agent verbatim).
 */
function expandRecipientList(
  entries: string[],
): { ok: true; addresses: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (entry.length === 0) continue;
    if (entry.toLowerCase().startsWith(TEAM_PREFIX)) {
      const alias = entry.slice(TEAM_PREFIX.length).toLowerCase();
      const envKey = `EMAIL_TEAM_${alias.toUpperCase()}`;
      const envVal = process.env[envKey];
      if (!envVal || envVal.trim().length === 0) {
        return {
          ok: false,
          error: `unknown team alias '${entry}' — set ${envKey}=... in env to enable`,
        };
      }
      for (const member of envVal
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!EMAIL_RE.test(member)) {
          return { ok: false, error: `team '${alias}' contains invalid address: ${member}` };
        }
        if (!out.includes(member)) out.push(member);
      }
    } else {
      if (!EMAIL_RE.test(entry)) {
        return { ok: false, error: `invalid email address: ${entry}` };
      }
      if (!out.includes(entry)) out.push(entry);
    }
  }
  return { ok: true, addresses: out };
}

/**
 * Resolve the agent's to/cc/bcc tool params into concrete, policy-checked
 * recipient lists for a single CC'd email.
 *
 * Rules:
 *   - "To" defaults to the operator's inbox (EMAIL_ME_RECIPIENT, else the
 *     session email) when the agent names none — INDEPENDENTLY of cc/bcc, so
 *     "email me and CC Mike" keeps both. Naming a To overrides the default.
 *   - 'team:X' aliases resolve via EMAIL_TEAM_X (uppercased, comma-separated).
 *   - Org-domain allowlist: every resolved address must be one of the
 *     operator's own addresses OR on an allowed domain. Allowed domains =
 *     EMAIL_DOMAIN_ALLOWLIST plus the operator's own (non-public-provider)
 *     domain. Anything else is rejected with an actionable error.
 *   - Cross-list dedup with precedence To > Cc > Bcc.
 */
export function resolveRecipients(input: ResolveRecipientsInput): ResolveRecipientsResult {
  const sessionEmail =
    input.operatorEmail && EMAIL_RE.test(input.operatorEmail) ? input.operatorEmail : null;

  // Self addresses are always allowed regardless of domain policy.
  const selfSet = new Set(
    [...envMeRecipients(), ...(sessionEmail ? [sessionEmail] : [])].map((a) => a.toLowerCase()),
  );

  // Allowed domains: explicit env allowlist + operator's own org domain
  // (skipped for public providers so we never trust all of gmail.com).
  const allowedDomains = parseDomainAllowlist();
  const domainSeed = sessionEmail ?? envMeRecipients()[0] ?? null;
  if (domainSeed) {
    const seedDomain = domainOf(domainSeed);
    if (!PUBLIC_EMAIL_PROVIDERS.has(seedDomain)) allowedDomains.add(seedDomain);
  }

  const isAllowed = (addr: string): boolean =>
    selfSet.has(addr.toLowerCase()) || allowedDomains.has(domainOf(addr));

  const toExp = expandRecipientList(input.to);
  if (!toExp.ok) return { ok: false, error: toExp.error };
  const ccExp = expandRecipientList(input.cc);
  if (!ccExp.ok) return { ok: false, error: ccExp.error };
  const bccExp = expandRecipientList(input.bcc);
  if (!bccExp.ok) return { ok: false, error: bccExp.error };

  // Default "To" to the operator inbox when none named (independent of cc/bcc).
  let to = toExp.addresses;
  if (to.length === 0) {
    const envMe = envMeRecipients();
    if (envMe.length > 0) to = envMe;
    else if (sessionEmail) to = [sessionEmail];
    else {
      return {
        ok: false,
        error:
          'no "To" recipient — sign in, set EMAIL_ME_RECIPIENT, or name a To address in the request',
      };
    }
  }

  // Cross-list dedup, precedence To > Cc > Bcc.
  const seen = new Set<string>();
  const dedup = (addrs: string[]): string[] => {
    const out: string[] = [];
    for (const a of addrs) {
      const key = a.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a);
    }
    return out;
  };
  to = dedup(to);
  const cc = dedup(ccExp.addresses);
  const bcc = dedup(bccExp.addresses);

  // Org-domain allowlist enforcement across the final union.
  for (const addr of [...to, ...cc, ...bcc]) {
    if (!isAllowed(addr)) {
      return {
        ok: false,
        error: `recipient ${addr} blocked — domain '${domainOf(addr)}' is not on the org allowlist. Add it to EMAIL_DOMAIN_ALLOWLIST to permit it.`,
      };
    }
  }

  return { ok: true, to, cc, bcc };
}

export type EmailRecipientStatus = {
  address: string;
  role: 'to' | 'cc' | 'bcc';
  status: 'sent' | 'alreadySent' | 'failed' | 'queued';
  error?: string;
};

export type EmailConversationResult = {
  ok: boolean;
  /** True only when Resend accepted a real send during THIS call. */
  delivered: boolean;
  /** True when the sender is Resend's sandbox (delivery limited to the account owner). */
  sandbox: boolean;
  /** Resolved sender address. */
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  recipients: EmailRecipientStatus[];
  entityId: string;
  kind: string;
  truncated: boolean;
  resendId?: string;
  /** Accurate one-line outcome the agent should relay verbatim. */
  summary: string;
  error?: string;
  /**
   * Present (with ok:true, delivered:false) when the send was DEFERRED because
   * an attachment is still rendering. The client re-fires the send via
   * /api/outbound/email-me once the awaited media resolves to ready — auto-doing
   * what the manual EMAIL button does. Operator-self sends only.
   */
  __email_when_ready?: {
    awaitedMediaIds: string[];
    content: string;
    severity?: string;
    alertEntityKind?: string;
    alertEntityId?: string;
    messageTimestamp: number;
  };
};

type MediaKind = 'image' | 'video';

interface GeneratedMediaStatusRow {
  id: string;
  media_kind: MediaKind;
  status: 'pending' | 'ready' | 'published' | 'failed';
  blob_url: string | null;
  style_tag: string;
  error_message: string | null;
  provider_job_id: string | null;
  provider_status: string | null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asSeverity(value: unknown): 'critical' | 'high' | 'medium' | 'low' | undefined {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : undefined;
}

function asDataTiles(value: unknown): Array<{ label: string; value: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const tiles = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const label = asString(record.label);
      const tileValue = asString(record.value);
      return label && tileValue ? { label, value: tileValue } : null;
    })
    .filter((item): item is { label: string; value: string } => item != null);
  return tiles.length > 0 ? tiles : undefined;
}

function asSourceContext(
  value: unknown,
): import('@/lib/visual/visual-brief').VisualBriefSourceContext | undefined {
  return value && typeof value === 'object'
    ? (value as import('@/lib/visual/visual-brief').VisualBriefSourceContext)
    : undefined;
}

/**
 * Resolve generatedMediaId(s) to attachable media (shared by email + X tools).
 * Only ready/published rows with a blob_url and a known kind come back; the rest
 * land in `missing` so callers can tell the user what was skipped.
 */
async function resolveMediaItems(
  ids: string[],
): Promise<{ items: MediaAttachmentItem[]; missing: string[] }> {
  const clean = ids.map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
  if (clean.length === 0) return { items: [], missing: ids.filter((s) => s.trim().length > 0) };
  const result = await query<{
    id: string;
    media_kind: string;
    blob_url: string | null;
    status: string;
  }>(
    `SELECT id::text, media_kind, blob_url, status
       FROM aegis_generated_media
       WHERE id = ANY($1::bigint[])`,
    [clean],
  );
  const byId = new Map(result.rows.map((r) => [r.id, r]));
  const items: MediaAttachmentItem[] = [];
  const missing: string[] = [];
  for (const id of clean) {
    const row = byId.get(id);
    if (
      row?.blob_url &&
      (row.status === 'ready' || row.status === 'published') &&
      (row.media_kind === 'image' || row.media_kind === 'video')
    ) {
      items.push({ blobUrl: row.blob_url, kind: row.media_kind });
    } else {
      missing.push(id);
    }
  }
  return { items, missing };
}

/**
 * Of the given generatedMediaIds, return those whose render is still in flight
 * (status 'pending'). Used by email_conversation to decide whether to DEFER the
 * send (still rendering) vs. send now (ready, or failed/absent → honesty note).
 */
export async function generateImage(input: Record<string, unknown>): Promise<GeneratedMediaMarker> {
  const content = asString(input.content) ?? asString(input.messageContent) ?? '';
  return startImageGeneration({
    messageContent: content,
    messageTimestamp: input.messageTimestamp,
    styleTag: asString(input.styleTag) as
      | import('@/lib/visual/style-registry').StyleTag
      | undefined,
    entityKind: asString(input.entityKind),
    entityId: asString(input.entityId),
    bluf: asString(input.bluf),
    severity: asSeverity(input.severity),
    dataTiles: asDataTiles(input.dataTiles),
    sourceContext: asSourceContext(input.sourceContext),
    actorEmail: asString(input.operatorEmail) ?? 'agent:tool:generate_image',
  });
}

export async function generateVideo(input: Record<string, unknown>): Promise<GeneratedMediaMarker> {
  const content = asString(input.content) ?? asString(input.messageContent) ?? '';
  // Same allowlists the HTTP route uses. The model used to be able to pass any
  // string straight into the CLI argv — an invalid enum surfaced as an
  // unexplained failure, and a value starting with `--` became a flag.
  return startVideoGeneration({
    content,
    messageTimestamp: input.messageTimestamp,
    sourceContext: asSourceContext(input.sourceContext),
    entityKind: asString(input.entityKind),
    entityId: asString(input.entityId),
    styleTag: asString(input.styleTag),
    ...normalizeVideoParams(input),
    actorEmail: asString(input.operatorEmail) ?? 'agent:tool:generate_video',
  });
}

export async function getGeneratedMediaStatus(
  input: Record<string, unknown>,
): Promise<GeneratedMediaMarker> {
  const id = asString(input.generatedMediaId) ?? asString(input.id);
  if (!id) {
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'image',
      error: 'generatedMediaId is required',
    };
  }

  const owned = await query(
    'SELECT id FROM aegis_generated_media WHERE id = $1 AND owner_email = $2',
    [id, input.operatorEmail],
  );
  if (!owned.rows.length)
    return { ok: false, __generated_media: true, mediaKind: 'image', error: 'not_found' };
  await refreshGeneratedVideoIfNeeded(id);
  const result = await query<GeneratedMediaStatusRow>(
    `SELECT id::text, media_kind, status, blob_url, style_tag, error_message, provider_job_id, provider_status
       FROM aegis_generated_media
       WHERE id = $1
       LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'image',
      error: 'not_found',
      detail: `No generated media found for id ${id}.`,
    };
  }

  return {
    ok: row.status !== 'failed',
    __generated_media: true,
    mediaKind: row.media_kind,
    generatedMediaId: row.id,
    status: row.status,
    blobUrl: row.blob_url ? `/api/outbound/generated-media/${row.id}/content` : null,
    styleTag: row.style_tag,
    pollUrl: `/api/outbound/generated-media/${row.id}`,
    ...(row.provider_job_id ? { providerJobId: row.provider_job_id } : {}),
    ...(row.provider_status ? { providerStatus: row.provider_status } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.error_message ? { error: row.error_message } : {}),
  };
}

export interface PostToXToolResult {
  ok: boolean;
  posted: boolean;
  tweetIds: string[];
  mediaKind?: 'image' | 'video' | null;
  summary: string;
  error?: string;
}

function pickXMode(value: unknown): 'anchor' | 'analyst' | 'fix_architect' {
  const v = asString(value);
  if (v === 'analyst' || v === 'fix_architect') return v;
  return 'anchor';
}

/**
 * Compose an X post via the shared Cyber Wire thread composer and STAGE it in
 * the approval queue. The handler never posts — staging IS the human gate (the
 * operator reviews/edits/approves the draft in the AgentDrawer queue, which
 * then runs publishTwitter). The infographic, if any, is resolved + uploaded
 * at publish time and rides the FINAL tweet.
 *
 * `post_to_x` therefore sets requiresApproval:false: the tool-level gate is
 * replaced by the (richer, editable) draft-queue gate, so no unapproved
 * content ever reaches the public account.
 */
export async function postToX(input: Record<string, unknown>): Promise<PostToXToolResult> {
  const content = (asString(input.content) ?? asString(input.text) ?? '').trim();
  if (!content) {
    return {
      ok: false,
      posted: false,
      tweetIds: [],
      summary: 'NOT STAGED — post content is required.',
      error: 'empty_content',
    };
  }

  const shape: XPostShape = input.shape === 'single' ? 'single' : 'thread';
  const tweetCount =
    shape === 'thread' && typeof input.tweetCount === 'number' && Number.isFinite(input.tweetCount)
      ? Math.min(7, Math.max(2, Math.trunc(input.tweetCount)))
      : undefined;
  const mode = pickXMode(input.mode);
  const attachMediaId = asString(input.attachMediaId);

  // Compose via the shared spine. The directive carries the (N-1)-prose +
  // final-media/sources-tweet shape; the system prompt carries the voice.
  const composed = await composeThread({
    // Topic-agnostic prompt: posts ANY brief in-voice (cyber-led, but
    // markets/macro/mixed too) and never refuses. `mode` still tags the draft
    // (agentMode below) for the queue badge.
    systemPrompt: GENERAL_POST_SYSTEM,
    contextBlock: `${content}\n\n${buildXThreadDirective(shape, tweetCount)}`,
    shape,
    tweetCount,
    maxTokens: shape === 'single' ? 1000 : 4000,
    draftType: 'agent_post',
  });
  if (!composed.ok) {
    return {
      ok: false,
      posted: false,
      tweetIds: [],
      summary: `NOT STAGED — could not compose the post (${composed.reason}${composed.details ? `: ${composed.details}` : ''}).`,
      error: composed.reason,
    };
  }
  const draft = composed.draft;

  // Optional infographic on the FINAL tweet. Resolve now to confirm readiness
  // + capture the kind; the actual X upload happens at publish time. If it
  // isn't ready, stage the thread without it (with a note) rather than risk a
  // publish-time failure.
  let mediaKind: 'image' | 'video' | null = null;
  let mediaNote = '';
  if (attachMediaId) {
    const { items } = await resolveMediaItems([attachMediaId]);
    const item = items[0];
    if (item) {
      draft.mediaId = attachMediaId;
      draft.mediaKind = item.kind;
      mediaKind = item.kind;
    } else {
      mediaNote = ` (media ${attachMediaId} isn't ready yet — staged without it; re-attach once it's ready).`;
    }
  }

  const tweetTotal = draft.tweets.length;
  const stage = await stageDraft({
    channel: 'twitter',
    draftType: 'agent_post',
    agentMode: mode,
    headline:
      shape === 'single'
        ? `X post — ${(draft.tweets[0]?.text ?? '').slice(0, 80)}`
        : `X thread — ${tweetTotal} tweets`,
    previewText: draft.tweets[0]?.text ?? '',
    draftPayload: draft,
    createdBy: asString(input.operatorEmail) ?? 'agent:tool:post_to_x',
  });
  if (!stage.ok) {
    return {
      ok: false,
      posted: false,
      tweetIds: [],
      mediaKind,
      summary: `NOT STAGED — ${stage.error}`,
      error: stage.reason,
    };
  }

  return {
    ok: true,
    posted: false,
    tweetIds: [],
    mediaKind,
    summary: `Staged a ${shape === 'single' ? 'single X post' : `${tweetTotal}-tweet X thread`} in the approval queue — review, edit if needed, and approve to publish${mediaKind ? ` (with ${mediaKind} on the final tweet)` : ''}.${mediaNote}`,
  };
}

export interface CheckRepliesToolResult {
  ok: boolean;
  summary: string;
  sourceUrl?: string;
  posts: Array<{
    rootTweetId: string;
    tweetUrl: string;
    primaryText: string | null;
    replyCount: number;
    replies: Array<{ id: string; text: string; author: string; url: string }>;
  }>;
  error?: string;
}

/**
 * Read replies to OUR recent posted threads (X detour). FAIL-SOFT: if reads are
 * blocked by the X tier the reply lists come back empty — the tool still succeeds
 * and reports "no replies (or reads unavailable)". The operator then tells Max
 * which to answer; the actual reply is staged via `x_reply_to_tweet`.
 */
export async function checkXReplies(
  input: Record<string, unknown>,
): Promise<CheckRepliesToolResult> {
  const handle = process.env.TWITTER_OAUTH_HANDLE ?? '';
  const limit =
    typeof input.limit === 'number' ? Math.min(10, Math.max(1, Math.trunc(input.limit))) : 5;
  const onlyRoot = asString(input.rootTweetId);

  let registry = await getRecentXPosts(20);
  if (onlyRoot) registry = registry.filter((p) => p.root_tweet_id === onlyRoot);
  registry = registry.slice(0, limit);

  if (registry.length === 0) {
    return {
      ok: true,
      summary: onlyRoot
        ? `No posted thread on record for ${onlyRoot}.`
        : 'No posted threads on record yet — post something first, then check back for replies.',
      posts: [],
    };
  }

  const posts: CheckRepliesToolResult['posts'] = [];
  let totalReplies = 0;
  for (const p of registry) {
    const replies = await fetchRepliesForConversation(p.root_tweet_id, 20);
    totalReplies += replies.length;
    void touchXPostChecked(p.root_tweet_id, replies.length);
    posts.push({
      rootTweetId: p.root_tweet_id,
      tweetUrl: buildTweetUrl(p.root_tweet_id, p.handle ?? handle),
      primaryText: p.primary_text,
      replyCount: replies.length,
      replies: replies.slice(0, 10).map((r) => ({
        id: r.id,
        text: r.text,
        author: `@${r.authorUsername}`,
        url: r.url,
      })),
    });
  }

  return {
    ok: true,
    summary:
      totalReplies > 0
        ? `Found ${totalReplies} repl${totalReplies === 1 ? 'y' : 'ies'} across ${posts.length} recent post${posts.length === 1 ? '' : 's'}. Tell me which to reply to and what to say.`
        : `No new replies across ${posts.length} recent post${posts.length === 1 ? '' : 's'} (or X reads are unavailable on the current API tier).`,
    posts,
    sourceUrl: posts[0]?.tweetUrl,
  };
}

/**
 * Stage an in-thread REPLY to a specific tweet into the approval queue (the queue
 * is the human gate — same model as `post_to_x`). Posts only after the operator
 * approves the drafted reply. The reply rides as a single-tweet draft carrying
 * `replyToTweetId`; `publishTwitter` makes the first tweet reply to that target.
 */
export async function replyToTweet(input: Record<string, unknown>): Promise<PostToXToolResult> {
  const targetTweetId = asString(input.targetTweetId) ?? asString(input.inReplyToTweetId);
  const replyText = (asString(input.replyText) ?? asString(input.text) ?? '').trim();
  if (!targetTweetId) {
    return {
      ok: false,
      posted: false,
      tweetIds: [],
      summary: 'NOT STAGED — targetTweetId is required.',
      error: 'missing_target',
    };
  }
  if (!replyText) {
    return {
      ok: false,
      posted: false,
      tweetIds: [],
      summary: 'NOT STAGED — replyText is required.',
      error: 'empty_reply',
    };
  }

  const draft: ThreadDraft = {
    tweets: [{ text: replyText }],
    canonicalHashtag: '#AICyber',
    replyToTweetId: targetTweetId,
  };

  const stage = await stageDraft({
    channel: 'twitter',
    draftType: 'agent_post',
    agentMode: pickXMode(input.mode),
    headline: `X reply → ${targetTweetId.slice(0, 14)} — ${replyText.slice(0, 60)}`,
    previewText: replyText,
    draftPayload: draft,
    createdBy: asString(input.operatorEmail) ?? 'agent:tool:x_reply_to_tweet',
  });
  if (!stage.ok) {
    return {
      ok: false,
      posted: false,
      tweetIds: [],
      summary: `NOT STAGED — ${stage.error}`,
      error: stage.reason,
    };
  }

  return {
    ok: true,
    posted: false,
    tweetIds: [],
    summary: `Staged a reply to tweet ${targetTweetId} in the approval queue — review/edit and approve to post it in-thread.`,
  };
}

// ─── Email replies (email detour — the email twin of the X reply tools) ───────

export interface CheckEmailRepliesToolResult {
  ok: boolean;
  summary: string;
  posts: Array<{
    messageId: string;
    subject: string | null;
    recipients: string[];
    replyCount: number;
    replies: Array<{
      id: string;
      from: string;
      subject: string;
      snippet: string;
      receivedAt: string | null;
      url?: string;
    }>;
  }>;
  error?: string;
}

/**
 * Read replies to OUR recently sent emails (email detour). FAIL-SOFT: if the
 * Gmail service account hasn't been granted the read scope the reply lists come
 * back empty — the tool still succeeds and reports "no replies (or reads
 * unavailable)". The operator then tells Max which to answer; the actual reply
 * is staged via `reply_to_email`.
 */
export async function checkEmailReplies(
  input: Record<string, unknown>,
): Promise<CheckEmailRepliesToolResult> {
  const limit =
    typeof input.limit === 'number' ? Math.min(10, Math.max(1, Math.trunc(input.limit))) : 5;
  const onlyMessageId = asString(input.messageId);

  let registry = await getRecentSentEmails(20);
  if (onlyMessageId) registry = registry.filter((r) => r.message_id === onlyMessageId);
  registry = registry.slice(0, limit);

  if (registry.length === 0) {
    return {
      ok: true,
      summary: onlyMessageId
        ? `No sent email on record for ${onlyMessageId}.`
        : 'No sent emails on record yet — once a digest/alert/agent email goes out, check back for replies.',
      posts: [],
    };
  }

  const posts: CheckEmailRepliesToolResult['posts'] = [];
  let totalReplies = 0;
  for (const r of registry) {
    const replies = await fetchRepliesForThread(r, 20);
    totalReplies += replies.length;
    void touchEmailChecked(r.message_id, replies.length);
    posts.push({
      messageId: r.message_id,
      subject: r.subject,
      recipients: r.recipients,
      replyCount: replies.length,
      replies: replies.slice(0, 10).map((rep) => ({
        id: rep.id,
        from: rep.from,
        subject: rep.subject,
        snippet: rep.snippet,
        receivedAt: rep.receivedAt,
        ...(rep.url ? { url: rep.url } : {}),
      })),
    });
  }

  return {
    ok: true,
    summary:
      totalReplies > 0
        ? `Found ${totalReplies} repl${totalReplies === 1 ? 'y' : 'ies'} across ${posts.length} recent email${posts.length === 1 ? '' : 's'}. Tell me which to reply to and what to say.`
        : `No replies across ${posts.length} recent email${posts.length === 1 ? '' : 's'} (or inbound reads aren't enabled on the Gmail service account yet).`,
    posts,
  };
}

export interface ReplyToEmailToolResult {
  ok: boolean;
  staged: boolean;
  summary: string;
  error?: string;
}

/**
 * Stage an in-thread email REPLY into the approval queue (the queue is the human
 * gate — same model as `reply_to_tweet`). Sends only after the operator approves
 * the drafted reply. Thread context (gmail thread id, subject, recipients) is
 * recovered from the sent-email registry by the message id we're replying to.
 */
export async function replyToEmail(
  input: Record<string, unknown>,
): Promise<ReplyToEmailToolResult> {
  const replyText = (
    asString(input.replyText) ??
    asString(input.body) ??
    asString(input.text) ??
    ''
  ).trim();
  const inReplyToMessageId =
    asString(input.inReplyToMessageId) ?? asString(input.messageId) ?? null;

  // Recipient resolution: explicit `to` (string per the tool schema, or an
  // array), else the replier address from `from`, else recovered from registry.
  let to: string[] = Array.isArray(input.to)
    ? input.to.filter((v): v is string => typeof v === 'string' && v.includes('@'))
    : asString(input.to)
      ? [asString(input.to) as string]
      : [];
  const replier = asString(input.replyToAddress) ?? asString(input.from);
  if (to.length === 0 && replier) {
    const m = replier.match(/<([^>]+)>/);
    to = [(m ? m[1]! : replier).trim()];
  }
  let subject = asString(input.subject) ?? null;
  let gmailThreadId: string | undefined;
  let references: string | undefined;

  // Recover thread context from the registry (gmail thread id / subject / to).
  if (inReplyToMessageId) {
    const recent = await getRecentSentEmails(50);
    const row = recent.find((r) => r.message_id === inReplyToMessageId);
    if (row) {
      if (row.gmail_thread_id) gmailThreadId = row.gmail_thread_id;
      if (!subject && row.subject) subject = row.subject;
      if (to.length === 0 && row.recipients.length > 0) to = row.recipients;
      references = inReplyToMessageId;
    }
  }

  if (!replyText) {
    return {
      ok: false,
      staged: false,
      summary: 'NOT STAGED — replyText is required.',
      error: 'empty_reply',
    };
  }
  if (to.length === 0) {
    return {
      ok: false,
      staged: false,
      summary:
        'NOT STAGED — no recipient. Provide `to`, `from`, or an `inReplyToMessageId` we have on record.',
      error: 'no_recipient',
    };
  }

  const finalSubject = subject
    ? /^re:/i.test(subject.trim())
      ? subject.trim()
      : `Re: ${subject.trim()}`
    : 'Re: your message';

  const draft: EmailDraft = {
    to,
    subject: finalSubject,
    bodyMarkdown: replyText,
    ...(inReplyToMessageId ? { inReplyToMessageId } : {}),
    ...(references ? { references } : {}),
    ...(gmailThreadId ? { gmailThreadId } : {}),
  };

  const stage = await stageDraft({
    channel: 'email',
    draftType: 'agent_post',
    agentMode: pickXMode(input.mode),
    headline: `Email reply → ${to[0]} — ${replyText.slice(0, 50)}`,
    previewText: replyText,
    draftPayload: draft,
    createdBy: asString(input.operatorEmail) ?? 'agent:tool:reply_to_email',
  });
  if (!stage.ok) {
    return {
      ok: false,
      staged: false,
      summary: `NOT STAGED — ${stage.error}`,
      error: stage.reason,
    };
  }

  return {
    ok: true,
    staged: true,
    summary: `Staged an email reply to ${to.join(', ')} in the approval queue — review/edit and approve to send it in-thread.`,
  };
}

/**
 * Compose + ship a single email (with optional Cc/Bcc) from the agent based on
 * conversation context.
 *
 * Tool input contract (matches the schema in src/lib/agent/tools.ts):
 *   - content        (string, required) — Markdown body the agent composed
 *   - recipients     (string[], optional) — "To" entries: 'email@x' or 'team:X'
 *   - cc             (string[], optional) — "Cc" entries (same vocabulary)
 *   - bcc            (string[], optional) — "Bcc" entries (same vocabulary)
 *   - subject        (string, optional) — overrides the kind-derived default
 *   - kind           ('summary'|'transcript'|'report'|'other', default 'summary')
 *   - primaryEntity  ({ kind, id }, optional) — for subject + back-link
 *   - severity       (string, optional) — extracted from content if absent
 *   - forceResend    (boolean, default false) — bypass dedup
 *   - operatorEmail  (string, optional) — the operator's session email, injected
 *                    by the agent runtime via ToolRegistry.execute context
 *                    (see client.ts). Used as the default "To" target and is
 *                    always self-allowed by the recipient resolver.
 *   - messageTimestamp (number, optional) — ms epoch; defaults to Date.now()
 *
 * Recipients are merged into ONE email — To + Cc + Bcc on a single thread (true
 * CC). The org-domain allowlist and Resend sandbox state are enforced/surfaced
 * so the result NEVER reports an undelivered message as sent.
 */
export async function emailConversation(
  input: Record<string, unknown>,
): Promise<EmailConversationResult> {
  const operatorEmail = asString(input.operatorEmail) ?? null;
  const content = asString(input.content) ?? '';
  const kind = asString(input.kind) ?? 'summary';
  const from = senderAddress();
  const base = {
    delivered: false,
    sandbox: isSandboxSender(from),
    from,
    to: [] as string[],
    cc: [] as string[],
    bcc: [] as string[],
    recipients: [],
    entityId: '',
    kind,
    truncated: false,
  };
  if (!operatorEmail || !content)
    return { ...base, ok: false, error: 'missing_operator_or_content', summary: 'Nothing staged.' };
  const resolved = resolveRecipients({
    to: asStringArray(input.recipients),
    cc: asStringArray(input.cc),
    bcc: asStringArray(input.bcc),
    operatorEmail,
  });
  if (!resolved.ok)
    return { ...base, ok: false, error: resolved.error, summary: 'Nothing staged.' };
  const body = content.slice(0, MAX_CONTENT_BYTES);
  const draft: EmailDraft = {
    to: resolved.to,
    cc: resolved.cc,
    bcc: resolved.bcc,
    subject: asString(input.subject) || 'Cocoa AI threat briefing',
    bodyMarkdown: body,
    mediaIds: asStringArray(input.attachMediaIds),
  };
  const staged = await stageDraft({
    channel: 'email',
    draftType: 'agent_post',
    agentMode: 'anchor',
    headline: draft.subject,
    previewText: body,
    draftPayload: draft,
    createdBy: operatorEmail,
  });
  if (!staged.ok) return { ...base, ok: false, error: 'draft_failed', summary: 'Nothing staged.' };
  return {
    ...base,
    ...resolved,
    ok: true,
    entityId: String(staged.draftId),
    truncated: body.length < content.length,
    summary: `Email draft #${staged.draftId} is ready for review in the approval queue. Nothing has been sent.`,
  };
}
