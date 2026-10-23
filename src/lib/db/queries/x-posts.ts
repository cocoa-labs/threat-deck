import { query } from '../client';

export interface XPostRow {
  id: string;
  root_tweet_id: string;
  tweet_ids: string[];
  handle: string | null;
  source: string;
  message_timestamp: string | null;
  primary_text: string | null;
  posted_at: string;
  last_checked_at: string | null;
  reply_count: number;
}

/**
 * Record one of OUR posted threads in the registry. Never throws — a registry
 * write must not break the actual post (callers `void recordXPost(...)`).
 */
export async function recordXPost(params: {
  rootTweetId: string;
  tweetIds: string[];
  handle?: string | null;
  source: 'job' | 'approval_queue';
  messageTimestamp?: number | null;
  primaryText?: string | null;
}): Promise<void> {
  if (!params.rootTweetId || params.rootTweetId.startsWith('dry-')) return; // skip dry-run ids
  try {
    await query(
      `INSERT INTO aegis_x_posts
         (root_tweet_id, tweet_ids, handle, source, message_timestamp, primary_text)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6)
       ON CONFLICT (root_tweet_id) DO UPDATE SET tweet_ids = EXCLUDED.tweet_ids`,
      [
        params.rootTweetId,
        JSON.stringify(params.tweetIds),
        params.handle ?? null,
        params.source,
        params.messageTimestamp ?? null,
        params.primaryText ?? null,
      ],
    );
  } catch (err) {
    console.warn('[x-posts] recordXPost failed:', err instanceof Error ? err.message : err);
  }
}

export async function getRecentXPosts(limit = 20): Promise<XPostRow[]> {
  const { rows } = await query<XPostRow>(
    'SELECT * FROM aegis_x_posts ORDER BY posted_at DESC LIMIT $1',
    [limit],
  );
  return rows;
}

export async function touchXPostChecked(rootTweetId: string, replyCount: number): Promise<void> {
  try {
    await query(
      'UPDATE aegis_x_posts SET last_checked_at = NOW(), reply_count = $2 WHERE root_tweet_id = $1',
      [rootTweetId, replyCount],
    );
  } catch (err) {
    console.warn('[x-posts] touchXPostChecked failed:', err instanceof Error ? err.message : err);
  }
}
