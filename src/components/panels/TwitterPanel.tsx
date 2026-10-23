'use client';

import { ExternalLink, Heart, MessageCircle, Quote, Repeat2, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useFreshness } from '@/lib/hooks/use-freshness';
import { useTwitterData } from '@/lib/hooks/use-realtime-data';
import { isAiCyberRelevant, partitionAndSort } from '@/lib/twitter/panel-sort';
import type { Tweet, TweetDomain } from '@/lib/types';
import { handleKeyActivation } from '@/lib/utils/a11y';
import { cn } from '@/lib/utils/cn';
import { resolvePanelFreshness } from '@/lib/utils/freshness';
import { prefillAgent } from '@/lib/utils/panel-actions';

// X feed refetches every 1-2m — live within 2m, stale past 15m.
const FRESHNESS = { liveMs: 2 * 60_000, staleMs: 15 * 60_000 };

/**
 * A tweet is from the hardcoded `DEMO_TWEETS` fallback when its id carries the
 * `demo-` prefix — the same convention `TweetRow` uses to suppress the
 * external-link affordance. The panel is "in demo" only when there is at least
 * one tweet AND *every* tweet is demo; a live result (zero demo ids) must never
 * trip the DEMO telltale, and a partial mix is treated as live.
 */
function isDemoTweet(tweet: Tweet): boolean {
  return tweet.id.startsWith('demo-');
}

function isDemoTweetSet(tweets: Tweet[]): boolean {
  return tweets.length > 0 && tweets.every(isDemoTweet);
}

/* ─── Domain Badge Config ─── */

const DOMAIN_STYLES: Record<TweetDomain, { bg: string; text: string; label: string }> = {
  markets: {
    bg: 'bg-[var(--color-positive)]/15',
    text: 'text-[var(--color-positive)]',
    label: 'MKT',
  },
  osint: {
    bg: 'bg-[var(--color-negative)]/15',
    text: 'text-[var(--color-negative)]',
    label: 'OSINT',
  },
  policy: {
    bg: 'bg-[var(--crt-glow)]/15',
    text: 'text-[var(--crt-glow)]',
    label: 'GOV',
  },
  crypto: {
    bg: 'bg-[var(--color-warning)]/15',
    text: 'text-[var(--color-warning)]',
    label: 'CRYPTO',
  },
  ai: {
    bg: 'bg-purple-500/15',
    text: 'text-purple-400',
    label: 'AI',
  },
  infosec: {
    bg: 'bg-[var(--severity-low)]/15',
    text: 'text-[var(--severity-low)]',
    label: 'CYBER',
  },
};

/* ─── Helpers ─── */

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Highlight $CASHTAGS green and @mentions cyan within tweet text */
function renderTweetText(text: string) {
  // Split on cashtags and mentions, preserving delimiters
  const parts = text.split(/(\$[A-Z]{1,6}|@\w{1,30})/g);
  return parts.map((part, i) => {
    if (part.startsWith('$') && /^\$[A-Z]{1,6}$/.test(part)) {
      return (
        <span key={i} className="text-[var(--color-positive)] font-semibold">
          {part}
        </span>
      );
    }
    if (part.startsWith('@') && /^@\w{1,30}$/.test(part)) {
      return (
        <span key={i} className="text-[var(--crt-glow)]">
          {part}
        </span>
      );
    }
    return part;
  });
}

/* ─── Shimmer ─── */

function ShimmerRow() {
  return (
    <div className="px-2 py-2 space-y-1.5 border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded-full animate-pulse bg-[var(--bg-hover)]" />
        <div className="h-2.5 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-2 w-8 animate-pulse rounded bg-[var(--bg-hover)] ml-auto" />
      </div>
      <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-hover)]" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--bg-hover)]" />
    </div>
  );
}

/* ─── AICyberBadge ─── */
/**
 * Green matrix-glass chip rendered next to the domain badge when the tweet's
 * text scores as AI-cyber relevant via the shared Phase 9.2 keyword scorer.
 * Distinct from the purple `AI` domain badge (which only means "general AI
 * news source"); a tweet can carry both — e.g. an AI source tweeting about
 * a new prompt-injection paper.
 *
 * Chrome matches the AgentDrawer `Post to X` button + the ApprovalQueueRow
 * matrix-green-glass register for visual continuity across the brand.
 */
function AICyberBadge({ tweet }: { tweet: Tweet }) {
  const relevant = useMemo(() => isAiCyberRelevant(tweet), [tweet]);
  if (!relevant) return null;
  return (
    <span
      className="px-1 py-0 text-[6px] font-mono font-bold rounded shrink-0"
      style={{
        background: 'rgba(var(--crt-glow-rgb), 0.08)',
        border: '1px solid rgba(var(--crt-glow-rgb), 0.25)',
        color: 'var(--matrix-green, #00ff41)',
        letterSpacing: '0.08em',
      }}
    >
      AI-CYBER
    </span>
  );
}

/* ─── TweetRow ─── */

function TweetRow({ tweet }: { tweet: Tweet }) {
  const initial = tweet.authorUsername[0]?.toUpperCase() ?? 'X';
  const domainStyle = tweet.domain ? DOMAIN_STYLES[tweet.domain] : undefined;

  return (
    // biome-ignore lint/a11y/useSemanticElements: click-to-agent interactive element using div for layout flexibility
    <div
      role="button"
      tabIndex={0}
      onClick={() =>
        prefillAgent(
          `Analyze this tweet from @${tweet.authorUsername}: "${tweet.text}" — What's the AI/cyber significance?`,
          {
            sourcePanel: 'twitter',
            dataType: 'tweet',
            trendData: {
              authorUsername: tweet.authorUsername,
              authorName: tweet.authorName,
              text: tweet.text,
              likeCount: tweet.likeCount,
              retweetCount: tweet.retweetCount,
              domain: tweet.domain,
              createdAt: tweet.createdAt,
              sourceUrl: tweet.url,
            },
          },
        )
      }
      onKeyDown={handleKeyActivation(() =>
        prefillAgent(
          `Analyze this tweet from @${tweet.authorUsername}: "${tweet.text}" — What's the AI/cyber significance?`,
          {
            sourcePanel: 'twitter',
            dataType: 'tweet',
            trendData: {
              authorUsername: tweet.authorUsername,
              authorName: tweet.authorName,
              text: tweet.text,
              likeCount: tweet.likeCount,
              retweetCount: tweet.retweetCount,
              domain: tweet.domain,
              createdAt: tweet.createdAt,
              sourceUrl: tweet.url,
            },
          },
        ),
      )}
      className={cn(
        'px-2 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)] border-b border-[var(--border-subtle)] group',
        tweet.relevant === false && 'opacity-80',
      )}
    >
      {/* Author line */}
      <div className="flex items-center gap-1.5 mb-0.5">
        {/* Monogram avatar */}
        <div className="h-5 w-5 rounded-full bg-[var(--crt-glow)]/15 flex items-center justify-center shrink-0">
          <span className="text-[8px] font-mono font-bold text-[var(--crt-glow)]">{initial}</span>
        </div>
        <span className="text-[9px] font-mono font-semibold text-[var(--text-primary)] truncate">
          {tweet.authorName}
        </span>
        <span className="text-[8px] font-mono text-[var(--text-muted)] truncate">
          @{tweet.authorUsername}
        </span>
        {tweet.relevant && (
          <span
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ background: 'var(--crt-glow)', boxShadow: '0 0 4px var(--crt-glow)' }}
          />
        )}
        {domainStyle && (
          <span
            className={cn(
              'px-1 py-0 text-[6px] font-mono font-bold rounded shrink-0',
              domainStyle.bg,
              domainStyle.text,
            )}
          >
            {domainStyle.label}
          </span>
        )}
        <AICyberBadge tweet={tweet} />
        <span className="text-[7px] font-mono text-[var(--text-muted)] ml-auto shrink-0">
          {relativeTime(tweet.createdAt)}
        </span>
        {/* External link (hover-reveal) — only for real tweets with /status/ URLs */}
        {tweet.url?.includes('/status/') && !isDemoTweet(tweet) && (
          <a
            href={tweet.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="text-[var(--text-muted)] hover:text-[var(--color-info)] opacity-0 group-hover:opacity-100 shrink-0"
          >
            <ExternalLink size={9} />
          </a>
        )}
      </div>

      {/* Tweet text */}
      <p className="text-[9px] font-mono text-[var(--text-secondary)] leading-[1.4] line-clamp-3 mb-1">
        {renderTweetText(tweet.text)}
      </p>

      {/* Engagement metrics */}
      <div
        className={cn(
          'flex items-center gap-3 text-[7px] font-mono',
          tweet.relevant ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]',
        )}
      >
        <span className="flex items-center gap-0.5">
          <MessageCircle size={8} />
          {compactNumber(tweet.replyCount)}
        </span>
        <span className="flex items-center gap-0.5">
          <Repeat2 size={8} />
          {compactNumber(tweet.retweetCount)}
        </span>
        <span className="flex items-center gap-0.5">
          <Heart size={8} />
          {compactNumber(tweet.likeCount)}
        </span>
        {tweet.quoteCount > 0 && (
          <span className="flex items-center gap-0.5">
            <Quote size={8} />
            {compactNumber(tweet.quoteCount)}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── AccountsContent ─── */

function AccountsContent() {
  const { data, isLoading } = useTwitterData('accounts');
  // Memo'd so the fallback `[]` is a stable reference between renders, which
  // in turn lets the `curated` memo below short-circuit when nothing changed.
  const tweets = useMemo(() => (data?.data ?? []) as Tweet[], [data?.data]);

  // Phase 9.7 — editorial priority-band sort. Replaces the naive
  // `.slice(0, 20)` so infosec + AI-cyber-relevant tweets get top
  // billing regardless of source-account post frequency.
  const curated = useMemo(() => partitionAndSort(tweets), [tweets]);

  if (isLoading && tweets.length === 0) {
    return (
      <div className="overflow-y-auto">
        {Array.from({ length: 5 }).map((_, i) => (
          <ShimmerRow key={i} />
        ))}
      </div>
    );
  }

  if (tweets.length === 0) {
    return (
      <div className="flex h-full min-h-[80px] items-center justify-center">
        <span className="text-[10px] font-mono text-[var(--text-muted)]">No tweets available</span>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {curated.map((tweet) => (
        <TweetRow key={tweet.id} tweet={tweet} />
      ))}
    </div>
  );
}

/* ─── Search Filter Type ─── */

type SearchFilter = 'ai' | 'infosec';

/* ─── SearchContent ─── */

function SearchContent() {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter | undefined>();
  const { data, isLoading } = useTwitterData('search', activeQuery || undefined, filter);
  const tweets = (data?.data ?? []) as Tweet[];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) setActiveQuery(query.trim());
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <form onSubmit={handleSubmit} className="flex gap-1 mb-1.5">
        <div className="relative flex-1">
          <Search
            size={10}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tweets..."
            className={cn(
              'w-full pl-5 pr-2 py-1 text-[9px] font-mono',
              'bg-[var(--bg-base)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)]',
              'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:border-[var(--crt-glow)]/50',
            )}
          />
        </div>
      </form>

      {/* Filter chips */}
      <div className="flex gap-1 mb-1.5 flex-wrap">
        {(['all', 'infosec', 'ai'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f === 'all' ? undefined : f)}
            className={cn(
              'px-1.5 py-0.5 text-[7px] font-mono font-semibold uppercase tracking-[0.1em]',
              'rounded-[var(--radius-sm)] border border-[var(--border-subtle)]',
              (f === 'all' && !filter) || filter === f
                ? 'bg-[var(--crt-glow)]/15 text-[var(--crt-glow)] border-[var(--crt-glow)]/30'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="overflow-y-auto flex-1">
        {isLoading && activeQuery ? (
          Array.from({ length: 5 }).map((_, i) => <ShimmerRow key={i} />)
        ) : !activeQuery ? (
          <div className="flex h-full min-h-[80px] items-center justify-center">
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              Enter a query to search X
            </span>
          </div>
        ) : tweets.length === 0 ? (
          <div className="flex h-full min-h-[80px] items-center justify-center">
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              No results for &quot;{activeQuery}&quot;
            </span>
          </div>
        ) : (
          tweets.slice(0, 15).map((tweet) => <TweetRow key={tweet.id} tweet={tweet} />)
        )}
      </div>
    </div>
  );
}

/* ─── TwitterPanel ─── */

export function TwitterPanel() {
  const [activeTab, setActiveTab] = useState<'accounts' | 'search'>('accounts');

  // Freshness reflects the curated "accounts" timeline (the panel's headline
  // feed). Shares the ['twitter','accounts',…] cache entry with AccountsContent
  // — no extra fetch when that tab is active.
  const { data, dataUpdatedAt } = useTwitterData('accounts');

  // `useFreshness` re-evaluates on a 5s tick so the time-based class stays
  // honest between refetches; we read its tick to recompute `ageMs` below.
  useFreshness(dataUpdatedAt, FRESHNESS);

  // Honest degradation: when the rendered timeline is the hardcoded demo set
  // (X token missing / 429 / empty upstream), the telltale must say DEMO even
  // though the fetch timestamp is recent. Precedence lives in the tested
  // `resolvePanelFreshness`; demo wins over the time-based class.
  const accountTweets = (data?.data ?? []) as Tweet[];
  const freshness = resolvePanelFreshness({
    demo: isDemoTweetSet(accountTweets),
    ageMs: dataUpdatedAt > 0 ? Date.now() - dataUpdatedAt : null,
    ...FRESHNESS,
  });

  return (
    <PanelShell
      id="twitter"
      title="X FEED"
      lastUpdated={dataUpdatedAt > 0 ? dataUpdatedAt : null}
      freshness={freshness}
    >
      {/* Tab toggle */}
      <div className="flex gap-0 mb-2 border border-[var(--border-subtle)] rounded-[var(--radius-sm)] w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('accounts')}
          className={cn(
            'px-2 py-0.5 text-[8px] font-mono font-semibold uppercase tracking-[0.1em]',
            'rounded-l-[var(--radius-sm)]',
            activeTab === 'accounts'
              ? 'bg-[var(--crt-glow)]/15 text-[var(--crt-glow)] border-r border-[var(--border-subtle)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-r border-[var(--border-subtle)]',
          )}
        >
          Accounts
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('search')}
          className={cn(
            'px-2 py-0.5 text-[8px] font-mono font-semibold uppercase tracking-[0.1em]',
            'rounded-r-[var(--radius-sm)]',
            activeTab === 'search'
              ? 'bg-[var(--crt-glow)]/15 text-[var(--crt-glow)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          )}
        >
          Search
        </button>
      </div>

      {activeTab === 'accounts' ? <AccountsContent /> : <SearchContent />}
    </PanelShell>
  );
}
