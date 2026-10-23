/**
 * Shared X thread composer — the single spine both the autonomous Cyber Wire
 * generators AND the in-app `post_to_x` agent tool route through.
 *
 * It owns the generate → validate → (count-fix retry) mechanics around the
 * `generateThread` LLM call. The CALLER owns the prompt content: it passes a
 * complete `contextBlock` (the data + any structural directive). For the
 * conversational path, the handler builds that directive with
 * `buildXThreadDirective` so the "N tweets = (N-1) prose + final media/sources
 * tweet" shape lives in one place.
 *
 * No 280-char rescue: X is long-form now, so length overflow can't happen
 * under the modernized `validateThreadDraft`. The only retry here is for an
 * off-by-count thread when an exact `tweetCount` was requested.
 */

import { validateThreadDraft } from './format';
import { generateThread } from './llm';
import type { GeneratorFailReason, ThreadDraft } from './types';

export type XPostShape = 'thread' | 'single';

export interface ComposeThreadInput {
  /** One of ANCHOR_SYSTEM | ANALYST_SYSTEM | FIX_ARCHITECT_SYSTEM. */
  systemPrompt: string;
  /** The full user-prompt body (data + any structural directive). Used verbatim. */
  contextBlock: string;
  shape: XPostShape;
  /**
   * thread only: exact total tweets incl. the final media/sources tweet.
   * Omit to let the model size the thread (autonomous generators do this).
   */
  tweetCount?: number;
  maxTokens: number;
  draftType: string;
}

export type ComposeThreadResult =
  | { ok: true; draft: ThreadDraft }
  | { ok: false; reason: GeneratorFailReason; details?: string };

export async function composeThread(input: ComposeThreadInput): Promise<ComposeThreadResult> {
  let gen = await generateThread({
    systemPrompt: input.systemPrompt,
    userPrompt: input.contextBlock,
    maxTokens: input.maxTokens,
    draftType: input.draftType,
  });

  // No-JSON retry. `llm_invalid_output` means the model returned prose instead
  // of the JSON object — typically a refusal ("this brief has no cyber
  // content") or reasoning preamble. Re-instruct once, forcefully, before
  // giving up. (A hard `llm_failed` is an API/timeout error, not a format one,
  // so it is NOT retried here.)
  if (!gen.ok && gen.reason === 'llm_invalid_output') {
    gen = await generateThread({
      systemPrompt: input.systemPrompt,
      userPrompt: `${input.contextBlock}\n\nIMPORTANT: Output ONLY the JSON object {"tweets":[{"text":"..."}],"canonicalHashtag":"#AICyber"} — no prose, no refusal, no explanation, no code fences. The first character of your response MUST be "{". Compose the post from the brief above regardless of its topic.`,
      maxTokens: input.maxTokens,
      draftType: `${input.draftType}_json_retry`,
    });
  }

  if (!gen.ok) {
    const details =
      gen.reason === 'llm_invalid_output'
        ? "the model wouldn't produce a valid post for this brief — try rephrasing it"
        : gen.details;
    return { ok: false, reason: gen.reason, details };
  }

  let draft = gen.draft;

  // Exact-count enforcement (single ⇒ 1; thread ⇒ tweetCount when given) with
  // a single restating retry. Threads with no explicit count are not enforced.
  const want = input.shape === 'single' ? 1 : input.tweetCount;
  if (want && draft.tweets.length !== want) {
    const retry = await generateThread({
      systemPrompt: input.systemPrompt,
      userPrompt: `${input.contextBlock}\n\nYour previous attempt produced ${draft.tweets.length} tweet(s). Compose EXACTLY ${want} tweet${want === 1 ? '' : 's'} — same voice and facts, re-distributed across that many tweets.`,
      maxTokens: input.maxTokens,
      draftType: `${input.draftType}_count_fix`,
    });
    if (retry.ok) draft = retry.draft;
  }

  if (want && draft.tweets.length !== want) {
    return {
      ok: false,
      reason: 'thread_validation_failed',
      details: `expected ${want} tweet(s), got ${draft.tweets.length}`,
    };
  }

  const violation = validateThreadDraft(draft);
  if (violation) return { ok: false, reason: 'thread_validation_failed', details: violation };

  return { ok: true, draft };
}

/**
 * Build the structural directive the conversational composer appends to its
 * context. Thread = (N-1) prose tweets + a final tweet carrying the source
 * links (an infographic is attached to it separately at publish time). Single
 * = one voiced post (a source reply is added by the publish path).
 */
export function buildXThreadDirective(shape: XPostShape, tweetCount?: number): string {
  if (shape === 'single') {
    return [
      'Compose a SINGLE tweet (one object in the tweets array): a voiced post carrying the observation,',
      'the CVE/vendor, the most-striking metric, and the source link. Include #AICyber.',
      'Output STRICT JSON per the system prompt.',
    ].join(' ');
  }
  if (tweetCount && tweetCount >= 2) {
    return [
      `Compose EXACTLY ${tweetCount} tweets.`,
      `Tweets 1 through ${tweetCount - 1} are prose — one idea per tweet, blending atmospheric / factual / wry per the Voice Register, leading cyber with a brief nod to the broader board (geopolitics / markets / policy) when the day warrants it.`,
      `Tweet ${tweetCount} is the closing tweet: a short coda plus the source links (an infographic is attached to it separately).`,
      `Put #AICyber on tweet 1 only; end tweet ${tweetCount} with "🧵 ${tweetCount}/${tweetCount}".`,
      'Output STRICT JSON per the system prompt.',
    ].join(' ');
  }
  return [
    'Compose a thread of 5-7 tweets sized to the number of distinct stories:',
    'a masthead, one tweet per story, and a closing tweet carrying the source links.',
    'Output STRICT JSON per the system prompt.',
  ].join(' ');
}
