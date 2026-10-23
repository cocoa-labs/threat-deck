/**
 * Phase 9.4 — Shared types for Twitter content generators.
 *
 * A generator's job is to produce a `ThreadDraft` and stage it in the
 * Approval Queue. The four generators (anchor.daily-brief, anchor.breaking,
 * analyst.weekly-deepdive, fix-architect.patch-thread) all output this same
 * shape; what differs is the persona, the source data, and the tweet count.
 */

/** A single tweet within a draft thread. */
export interface DraftTweet {
  /**
   * Body text. Long-form: X allows up to 25,000 chars/tweet, so the text is
   * sized to the idea, not a 280-char budget. Threads split by story/count.
   */
  text: string;
  /**
   * Optional article / CVE link. Placed LAST in the tweet at render time so
   * X auto-collapses the embed and keeps the text body the focal point.
   */
  link?: string;
}

/** A multi-tweet draft, the canonical persistence shape for `aegis_outbound_drafts.draft_payload`. */
export interface ThreadDraft {
  tweets: DraftTweet[];
  /** Always `#AICyber` for Phase 9; centralized so future re-branding is one edit. */
  canonicalHashtag: string;
  /**
   * Optional generated-media id (`aegis_generated_media.id`) to upload and
   * attach to the FINAL tweet of the thread at publish time. Thread-level
   * because "the infographic rides the last tweet" is a thread fact, not a
   * per-tweet one. Autonomous generators leave this unset.
   */
  mediaId?: string;
  /** 'image' | 'video' — informs which uploader `publishTwitter` calls. */
  mediaKind?: 'image' | 'video';
  /**
   * When set, this draft is a REPLY: its first tweet replies to this tweet id
   * (in_reply_to_tweet_id) rather than starting a new thread. Replies are exempt
   * from the canonical-hashtag rule (they're conversational, not thread roots).
   */
  replyToTweetId?: string;
}

/**
 * An email draft — the email-channel counterpart of `ThreadDraft`, persisted in
 * `aegis_outbound_drafts.draft_payload` when `channel='email'`. Used for
 * operator-reviewed email replies (the email-reply detour): the body is plain
 * Markdown rendered through the AgentResponseEmail template at publish time, and
 * the threading fields land the reply in the original conversation.
 */
export interface EmailDraft {
  cc?: string[];
  bcc?: string[];
  mediaIds?: string[];
  /** Recipient address(es). */
  to: string[];
  subject: string;
  /** Markdown body — rendered via AgentResponseEmail at publish. */
  bodyMarkdown: string;
  /** RFC 5322 Message-ID of the inbound email being replied to (threads the reply). */
  inReplyToMessageId?: string;
  /** References chain header to set on the reply. */
  references?: string;
  /** Gmail threadId to group the reply under, when known. */
  gmailThreadId?: string;
}

/** Discriminated outcome of any generator invocation. */
export type GeneratorResult =
  | {
      ok: true;
      draftId: number;
      tweetCount: number;
      /** First 120 chars of T1 — used in route response bodies + observability. */
      preview: string;
    }
  | {
      ok: false;
      reason: GeneratorFailReason;
      /** Optional human-readable elaboration (LLM error message, validation
       * detail, etc.). Logged + included in cron route responses; not shown
       * to end users. */
      details?: string;
    };

/** Stable, machine-readable failure codes. UI/monitoring keys on these. */
export type GeneratorFailReason =
  /** Not enough source rows (e.g., <3 stories pass ai_relevance≥0.5 in window). */
  | 'no_qualifying_items'
  /** Anthropic SDK threw, timed out, or returned non-2xx. */
  | 'llm_failed'
  /** LLM returned text that didn't parse as a valid ThreadDraft. */
  | 'llm_invalid_output'
  /** Validation post-parse failed (length overflow, missing hashtag, etc.). */
  | 'thread_validation_failed'
  /** Stage to DB failed; nothing landed in aegis_outbound_drafts. */
  | 'persist_failed';
