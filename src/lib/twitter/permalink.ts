/**
 * Build a public X permalink for one of OUR posted tweets.
 *
 * Prefers the `@handle/status/<id>` form (shows it's our account); falls back to
 * the handle-less `/i/status/<id>` form when the handle is unknown. Shared by the
 * job view, the message badge, the post toast, and the approval queue so the
 * permalink is constructed in exactly one place.
 */
export function buildTweetUrl(tweetId: string, handle?: string | null): string {
  const h = (handle ?? '').replace(/^@/, '').trim();
  return h ? `https://x.com/${h}/status/${tweetId}` : `https://x.com/i/status/${tweetId}`;
}
