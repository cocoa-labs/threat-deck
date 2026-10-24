'use client';

import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { useState } from 'react';
import type { DraftRow } from '@/lib/outbound/drafts';
import { safeLink } from '@/lib/security/safe-link';

/** Fetch the complete payload only when the operator chooses to review it. */
export function DraftReview({
  draft,
  disabled,
  onApprove,
  autoReview = false,
}: {
  draft: DraftRow;
  disabled: boolean;
  onApprove: (reviewedPayload: Record<string, unknown>) => void;
  autoReview?: boolean;
}) {
  const [reviewing, setReviewing] = useState(autoReview);
  const {
    data,
    isFetching: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['publication-preview', draft.id],
    enabled: reviewing,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<Record<string, unknown>> => {
      const response = await fetch(`/api/outbound/drafts/${draft.id}`, { credentials: 'include' });
      const body = await response.json();
      if (!response.ok || !body.draft?.draftPayload)
        throw new Error('Could not load the current draft. Try again before publishing.');
      return body.draft.draftPayload;
    },
  });
  const payload = reviewing && !loading && !error ? data : null;
  function review() {
    if (reviewing) void refetch();
    else setReviewing(true);
  }
  const mediaIds = payload
    ? [payload.mediaId, ...(Array.isArray(payload.mediaIds) ? payload.mediaIds : [])].filter(
        (id): id is string => typeof id === 'string' && /^\d+$/.test(id),
      )
    : [];
  return (
    <div className="text-xs" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
      {!payload && (
        <button
          type="button"
          disabled={disabled || loading}
          onClick={review}
          className="px-2 py-1 text-green-400"
        >
          {loading ? 'Loading draft…' : 'Review publication'}
        </button>
      )}
      {error && <p role="alert">{error.message}</p>}
      {payload && (
        <section aria-label="Publication preview" className="space-y-2 p-2">
          <p>{draft.channel === 'email' ? 'Send email' : 'Publish to the connected X account'}</p>
          {draft.channel === 'email' ? (
            <>
              {(['to', 'cc', 'bcc'] as const).map(
                (field) =>
                  Array.isArray(payload[field]) &&
                  payload[field].length > 0 && (
                    <p key={field}>
                      {field.toUpperCase()}: {(payload[field] as unknown[]).map(String).join(', ')}
                    </p>
                  ),
              )}
              <p>Subject: {String(payload.subject ?? '')}</p>
              <pre className="whitespace-pre-wrap font-inherit">
                {String(payload.bodyMarkdown ?? '')}
              </pre>
              {payload.inReplyToMessageId ? (
                <p>Replying to: {String(payload.inReplyToMessageId)}</p>
              ) : null}
            </>
          ) : (
            <>
              {payload.replyToTweetId ? (
                <p>Reply to X post: {String(payload.replyToTweetId)}</p>
              ) : null}
              {Array.isArray(payload.tweets) &&
                payload.tweets.map((tweet: { text?: unknown; link?: unknown }, index: number) => (
                  <div key={`${index}-${String(tweet.text)}`}>
                    <p>Post {index + 1}</p>
                    <pre className="whitespace-pre-wrap font-inherit">
                      {String(tweet.text ?? '')}
                    </pre>
                    {tweet.link ? (
                      <a href={safeLink(tweet.link)} target="_blank" rel="noopener noreferrer">
                        {String(tweet.link)}
                      </a>
                    ) : null}
                  </div>
                ))}
            </>
          )}
          <p>Attachments: {mediaIds.length === 0 ? 'none' : mediaIds.length}</p>
          {mediaIds.map((id) => (
            <a
              key={id}
              className="block underline"
              href={`/api/outbound/generated-media/${id}/content`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {payload.mediaKind === 'image' && (
                <Image
                  src={`/api/outbound/generated-media/${id}/content`}
                  alt="Image included in this publication"
                  width={640}
                  height={360}
                  unoptimized
                  className="mb-2 max-h-64 w-full object-contain"
                />
              )}
              Preview attachment {id}
            </a>
          ))}
          <p>Approving shares this content outside your installation.</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApprove(payload)}
            className="px-2 py-1 text-green-400"
          >
            Approve and publish
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setReviewing(false)}
            className="px-2 py-1"
          >
            Cancel review
          </button>
        </section>
      )}
    </div>
  );
}
