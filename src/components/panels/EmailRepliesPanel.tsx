'use client';

import { Mail, Reply } from 'lucide-react';
import { PanelShell } from '@/components/panels/PanelShell';
import {
  type EmailReplyItem,
  type EmailReplyPost,
  useEmailReplies,
} from '@/lib/hooks/use-email-replies';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Reply row ─── */

function ReplyItemRow({
  reply,
  parentMessageId,
  parentSubject,
}: {
  reply: EmailReplyItem;
  parentMessageId: string;
  parentSubject: string | null;
}) {
  return (
    <div className="rounded px-1.5 py-1 transition-colors hover:bg-[var(--bg-hover)]">
      <div className="flex items-center justify-between gap-2">
        {reply.url ? (
          <a
            href={reply.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[10px] font-mono font-semibold text-[var(--color-info)] hover:underline"
          >
            {reply.from}
          </a>
        ) : (
          <span className="truncate text-[10px] font-mono font-semibold text-[var(--color-info)]">
            {reply.from}
          </span>
        )}
        <button
          type="button"
          onClick={() =>
            prefillAgent(
              `Draft a reply to this email from ${reply.from} (in reply to our sent email ${parentMessageId}): "${reply.snippet}". Use reply_to_email to stage it for approval.`,
              {
                sourcePanel: 'emailReplies',
                dataType: 'email_reply',
                trendData: {
                  inReplyToMessageId: parentMessageId,
                  from: reply.from,
                  subject: parentSubject ?? reply.subject,
                  text: reply.snippet,
                  ...(reply.url ? { url: reply.url } : {}),
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
        {reply.snippet}
      </p>
    </div>
  );
}

/* ─── Post block (one of our sent emails + its replies) ─── */

function PostBlock({ post }: { post: EmailReplyPost }) {
  return (
    <div className="space-y-1 border-b border-[var(--border-subtle)] pb-2 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <Mail size={10} className="shrink-0 text-[var(--text-dim)]" />
        <span
          className="min-w-0 flex-1 truncate text-[10px] font-mono text-[var(--text-primary)]"
          title={post.recipients.join(', ')}
        >
          {post.subject ?? post.messageId}
        </span>
        <span className="shrink-0 text-[9px] font-mono tabular-nums text-[var(--text-dim)]">
          {post.replyCount}
        </span>
      </div>
      {post.replies.length > 0 && (
        <div className="space-y-0.5 pl-3">
          {post.replies.map((r) => (
            <ReplyItemRow
              key={r.id}
              reply={r}
              parentMessageId={post.messageId}
              parentSubject={post.subject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── EmailRepliesPanel ─── */

export function EmailRepliesPanel() {
  const { data: posts, isLoading } = useEmailReplies();
  const list = posts ?? [];
  const withReplies = list.filter((p) => p.replyCount > 0);

  return (
    <PanelShell id="emailReplies" title="EMAIL REPLIES" span={1}>
      {isLoading && list.length === 0 ? (
        <div className="flex h-full min-h-[80px] items-center justify-center">
          <span className="text-[10px] font-mono text-[var(--text-muted)]">Checking replies…</span>
        </div>
      ) : withReplies.length === 0 ? (
        <div className="flex h-full min-h-[100px] flex-col items-center justify-center gap-2 text-center">
          <Mail size={16} className="text-[var(--text-muted)]" />
          <p className="max-w-[210px] text-[10px] font-mono leading-relaxed text-[var(--text-muted)]">
            No replies to our recent emails yet — or inbound reads are not enabled on the Gmail
            service account.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {withReplies.map((p) => (
            <PostBlock key={p.messageId} post={p} />
          ))}
        </div>
      )}
    </PanelShell>
  );
}
