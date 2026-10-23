/**
 * Phase 9.4 — Pure formatting helpers.
 *
 * Zero dependencies, deterministic, side-effect-free. These are the
 * building blocks every generator and route handler reaches for when
 * shaping or validating a `ThreadDraft`.
 */

import { X_LONGFORM_MAX_LENGTH } from '../length';
import type { EmailDraft, ThreadDraft } from './types';

/** Length X collapses any URL to. */
export const TWITTER_URL_BUDGET = 23;

/**
 * Legacy 280-char constant. X now supports long-form posts — this is NO LONGER
 * a composition gate (see `validateThreadDraft`, which uses the long-form
 * ceiling). Retained only for `truncateToTwitter`, a display/legacy helper.
 */
export const TWITTER_MAX_LENGTH = 280;

/** Default canonical hashtag for the AI Cyber Wire brand. */
export const DEFAULT_HASHTAG = '#AICyber';

/**
 * Severity weight for sorting items by `aiRelevance × severityWeight(severity)`.
 * The exact magnitudes don't matter — only the ordering does — but we keep
 * the gap between criticality classes wide enough that a high-relevance
 * `'medium'` item doesn't outrank a borderline-relevance `'critical'` one.
 */
export function severityWeight(s: string | null | undefined): number {
  switch (s) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0.5;
  }
}

/**
 * Truncate `text` to fit Twitter's per-tweet budget. If `opts.room` is
 * provided, reserve that many code units (typically TWITTER_URL_BUDGET when
 * a link will be appended). Adds a `…` ellipsis when truncation occurs.
 *
 * Idempotent: text already within budget passes through unchanged.
 */
export function truncateToTwitter(text: string, opts?: { room?: number }): string {
  const room = opts?.room ?? 0;
  const budget = TWITTER_MAX_LENGTH - room;
  if (text.length <= budget) return text;
  if (budget <= 1) return '…';
  return `${text.slice(0, budget - 1).trimEnd()}…`;
}

/**
 * Append `hashtag` (default `#AICyber`) to `text` if not already present,
 * separated by a single space. Idempotent.
 */
export function appendCanonicalHashtag(text: string, hashtag: string = DEFAULT_HASHTAG): string {
  if (new RegExp(`(?:^|\\s)${escapeRegExp(hashtag)}(?=\\s|$)`).test(text)) {
    return text;
  }
  return `${text} ${hashtag}`;
}

/**
 * Validate a thread draft as a unit. Returns the first violation found, or
 * `null` if the thread is publishable. Callers stage the draft on `null`
 * and fail-soft otherwise.
 *
 * Checks:
 *   - At least one tweet present.
 *   - Each tweet text is non-empty.
 *   - Each tweet's effective length stays under the X long-form ceiling
 *     (25,000). This is a fail-closed sanity guard against a runaway
 *     generation, NOT a per-tweet budget — real prose never approaches it.
 *     Threads split by story/count, not characters.
 *   - Tweet 1 includes the canonical hashtag.
 */
export function validateThreadDraft(draft: ThreadDraft): string | null {
  if (!draft.tweets || draft.tweets.length === 0) {
    return 'thread must contain at least one tweet';
  }
  const hashtag = draft.canonicalHashtag || DEFAULT_HASHTAG;
  for (let i = 0; i < draft.tweets.length; i++) {
    const t = draft.tweets[i];
    if (!t || typeof t.text !== 'string' || t.text.trim().length === 0) {
      return `tweet[${i}] has empty text`;
    }
    const effective = t.text.length + (t.link ? 1 + TWITTER_URL_BUDGET : 0);
    if (effective > X_LONGFORM_MAX_LENGTH) {
      return `tweet[${i}] is ${effective}/${X_LONGFORM_MAX_LENGTH} chars (exceeds X long-form ceiling)`;
    }
  }
  // Tweet 1 must include the hashtag — anchors the brand on every thread ROOT.
  // Replies (replyToTweetId set) are conversational, not roots — exempt them.
  const first = draft.tweets[0]?.text ?? '';
  if (
    !draft.replyToTweetId &&
    !new RegExp(`(?:^|\\s)${escapeRegExp(hashtag)}(?=\\s|$)`).test(first)
  ) {
    return `tweet[0] is missing canonical hashtag ${hashtag}`;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate an `EmailDraft` before staging. Fail-closed on missing essentials so
 * a malformed reply never reaches the approval queue. The email-channel twin of
 * `validateThreadDraft`.
 */
export function validateEmailDraft(draft: EmailDraft): string | null {
  for (const field of [draft.to, draft.cc ?? [], draft.bcc ?? []]) {
    if (
      !Array.isArray(field) ||
      field.length > 20 ||
      field.some((a) => typeof a !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(a))
    )
      return 'invalid_recipients';
  }
  if (
    typeof draft.subject !== 'string' ||
    draft.subject.length > 240 ||
    /[\r\n]/.test(draft.subject)
  )
    return 'invalid_subject';
  if (typeof draft.bodyMarkdown !== 'string' || draft.bodyMarkdown.length > 50_000)
    return 'invalid_body';
  if (
    draft.mediaIds &&
    (!Array.isArray(draft.mediaIds) ||
      draft.mediaIds.length > 4 ||
      draft.mediaIds.some((id) => !/^\d{1,18}$/.test(id)))
  )
    return 'invalid_media';
  if (
    [draft.inReplyToMessageId, draft.references, draft.gmailThreadId].some(
      (v) => v !== undefined && (typeof v !== 'string' || v.length > 2000 || /[\r\n]/.test(v)),
    )
  )
    return 'invalid_thread_headers';
  if (!Array.isArray(draft.to) || draft.to.length === 0) {
    return 'email must have at least one recipient';
  }
  if (draft.to.some((a) => typeof a !== 'string' || !a.includes('@'))) {
    return 'email has an invalid recipient address';
  }
  if (typeof draft.subject !== 'string' || draft.subject.trim().length === 0) {
    return 'email subject is empty';
  }
  if (typeof draft.bodyMarkdown !== 'string' || draft.bodyMarkdown.trim().length === 0) {
    return 'email body is empty';
  }
  return null;
}
