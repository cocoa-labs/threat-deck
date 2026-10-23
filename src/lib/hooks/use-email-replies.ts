'use client';

import { useQuery } from '@tanstack/react-query';

export interface EmailReplyItem {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string | null;
  url?: string;
}

export interface EmailReplyPost {
  messageId: string;
  subject: string | null;
  recipients: string[];
  replyCount: number;
  replies: EmailReplyItem[];
}

async function fetchEmailReplies(): Promise<EmailReplyPost[]> {
  try {
    const res = await fetch('/api/outbound/email/replies');
    if (!res.ok) return [];
    const json = (await res.json()) as { posts?: EmailReplyPost[] };
    return json.posts ?? [];
  } catch {
    return [];
  }
}

export function useEmailReplies() {
  return useQuery({
    queryKey: ['email-replies'],
    queryFn: fetchEmailReplies,
    refetchInterval: 180_000,
    staleTime: 120_000,
  });
}
