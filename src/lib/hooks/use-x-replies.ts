'use client';

import { useQuery } from '@tanstack/react-query';

export interface XReplyItem {
  id: string;
  text: string;
  author: string;
  url: string;
}

export interface XReplyPost {
  rootTweetId: string;
  tweetUrl: string;
  primaryText: string | null;
  replyCount: number;
  replies: XReplyItem[];
}

async function fetchXReplies(): Promise<XReplyPost[]> {
  try {
    const res = await fetch('/api/outbound/x/replies');
    if (!res.ok) return [];
    const json = (await res.json()) as { posts?: XReplyPost[] };
    return json.posts ?? [];
  } catch {
    return [];
  }
}

export function useXReplies() {
  return useQuery({
    queryKey: ['x-replies'],
    queryFn: fetchXReplies,
    refetchInterval: 180_000,
    staleTime: 120_000,
  });
}
