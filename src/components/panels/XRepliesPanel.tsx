'use client';

import { ExternalLink, MessageCircle, Reply } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useXReplies, type XReplyItem, type XReplyPost } from '@/lib/hooks/use-x-replies';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Reply row ─── */

function ReplyItemRow({ reply }: { reply: XReplyItem }) {
  return (
    <div className="rounded px-1.5 py-1 transition-colors hover:bg-[var(--bg-hover)]">
      <div className="flex items-center justify-between gap-2">
        <a
          href={reply.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-[10px] font-mono font-semibold text-[var(--color-info)] hover:underline"
        >
          {reply.author}
        </a>
        <button
          type="button"
          onClick={() =>
            prefillAgent(
              `Draft a reply to this X reply from ${reply.author} (tweet id ${reply.id}): "${reply.text}". Use x_reply_to_tweet to stage it for approval.`,
              {
                sourcePanel: 'xReplies',
                dataType: 'x_reply',
                trendData: {
                  tweetId: reply.id,
                  author: reply.author,
                  text: reply.text,
                  url: reply.url,
                },
              },
            )
          }
          className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-mono uppercase tracking-wide text-[var(--text-dim)] transition-colors hover:text-[var(--color-info)]"
          title="Draft a reply — Max stages it in the approval queue"
        >
          <Reply size={9} />
          Draft reply
        </button>
      </div>
      <p className="mt-0.5 line-clamp-3 text-[10px] leading-snug text-[var(--text-secondary)]">
        {reply.text}
      </p>
    </div>
  );
}

/* ─── Post block (one of our threads + its replies) ─── */

function PostBlock({ post }: { post: XReplyPost }) {
  return (
    <div className="space-y-1 border-b border-[var(--border-subtle)] pb-2 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <MessageCircle size={10} className="shrink-0 text-[var(--text-dim)]" />
        <a
          href={post.tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="min-w-0 flex-1 truncate text-[10px] font-mono text-[var(--text-primary)] transition-colors hover:text-[var(--color-info)]"
          title="Open our thread on X"
        >
          {post.primaryText ?? post.rootTweetId}
        </a>
        <ExternalLink size={9} className="shrink-0 text-[var(--text-muted)]" />
        <span className="shrink-0 text-[9px] font-mono tabular-nums text-[var(--text-dim)]">
          {post.replyCount}
        </span>
      </div>
      {post.replies.length > 0 && (
        <div className="space-y-0.5 pl-3">
          {post.replies.map((r) => (
            <ReplyItemRow key={r.id} reply={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── XRepliesPanel ─── */

export function XRepliesPanel() {
  const { data: posts, isLoading } = useXReplies();
  const list = posts ?? [];
  const withReplies = list.filter((p) => p.replyCount > 0);

  return (
    <PanelShell id="xReplies" title="X REPLIES" span={1}>
      {isLoading && list.length === 0 ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">Checking replies…</span>
        </div>
      ) : withReplies.length === 0 ? (
        <div className="flex h-full min-h-[100px] flex-col items-center justify-center gap-2 text-center">
          <MessageCircle size={16} className="text-[var(--text-muted)]" />
          <p className="max-w-[200px] text-[10px] font-mono leading-relaxed text-[var(--text-muted)]">
            No replies to our recent posts yet — or X reads are unavailable on the current API tier.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {withReplies.map((p) => (
            <PostBlock key={p.rootTweetId} post={p} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
