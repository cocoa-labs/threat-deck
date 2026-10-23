'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { PanelShell } from '@/components/panels/PanelShell';
import { useFreshness } from '@/lib/hooks/use-freshness';
import { useNewsData } from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type { NewsItem } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { resolvePanelFreshness } from '@/lib/utils/freshness';
import { prefillAgent } from '@/lib/utils/panel-actions';

/* ─── Constants ─── */

// News RSS refetches every 5m — live within 5m, stale past 30m.
const FRESHNESS = { liveMs: 5 * 60_000, staleMs: 30 * 60_000 };

const TABS = ['cyber', 'ai', 'tech', 'defense'] as const;
type TabKey = (typeof TABS)[number];

const TAB_LABELS: Record<TabKey, string> = {
  cyber: 'Cyber',
  ai: 'AI',
  tech: 'Tech',
  defense: 'Defense',
};

const CATEGORY_COLORS: Record<string, string> = {
  cyber: 'bg-[var(--severity-high)]',
  ai: 'bg-[var(--color-info)]',
  tech: 'bg-[var(--color-positive)]',
  defense: 'bg-[var(--severity-medium)]',
};

const MAX_ITEMS = 10;

/* ─── Shimmer ─── */

function ShimmerItem() {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-1 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--bg-hover)]" />
      <div className="flex-1 space-y-1">
        <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-hover)]" />
        <div className="h-2.5 w-24 animate-pulse rounded bg-[var(--bg-hover)]" />
      </div>
    </div>
  );
}

/* ─── News Item Row ─── */

function analyzeNewsItem(item: NewsItem) {
  prefillAgent(`Analyze this: "${item.title}". What are the key implications?`, {
    sourcePanel: 'news',
    dataType: 'news_item',
    trendData: {
      title: item.title,
      source: item.source,
      category: item.category,
      publishedAt: item.publishedAt,
      url: item.url,
    },
  });
}

function NewsRow({ item }: { item: NewsItem }) {
  const dotColor = CATEGORY_COLORS[item.category] ?? 'bg-[var(--text-muted)]';

  return (
    <div className="group flex items-start gap-2 rounded px-1 py-1.5 transition-colors hover:bg-[var(--bg-hover)]">
      <button
        type="button"
        onClick={() => analyzeNewsItem(item)}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left"
      >
        {/* Category dot */}
        <div className={cn('mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full', dotColor)} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[var(--text-xs)] leading-tight text-[var(--text-primary)] transition-colors group-hover:text-[var(--color-info)]">
            {item.title}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="truncate text-[9px] font-mono text-[var(--text-dim)]">
              {item.source}
            </span>
            <span className="text-[9px] text-[var(--text-muted)]">&middot;</span>
            <span className="shrink-0 text-[9px] font-mono text-[var(--text-muted)]">
              {formatRelativeTime(item.publishedAt)}
            </span>
          </div>
        </div>
      </button>

      {/* External link icon */}
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-1 shrink-0">
        <ExternalLink
          size={10}
          className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--color-info)]"
        />
      </a>
    </div>
  );
}

function NewsStatus({
  label,
  detail,
  actionLabel,
  onAction,
}: {
  label: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[88px] flex-col items-center justify-center gap-2 text-center">
      <span className="text-[10px] font-mono text-[var(--text-muted)]">{label}</span>
      {detail && (
        <span className="max-w-[220px] text-[9px] font-mono uppercase tracking-wide text-[var(--text-dim)]">
          {detail}
        </span>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rounded border border-[var(--border-subtle)] px-2 py-1 text-[9px] font-mono uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:border-[var(--color-info)] hover:text-[var(--color-info)]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/* ─── Inner Content ─── */

function NewsPanelContent({ activeTab }: { activeTab: TabKey }) {
  const { data, isError, isFetching, isLoading, refetch } = useNewsData(activeTab);
  const newsMap = useDataStore((s) => s.news);
  const items = newsMap[activeTab] ?? [];
  const visibleItems = items.slice(0, MAX_ITEMS);

  if (isLoading && visibleItems.length === 0) {
    return (
      <div className="space-y-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <ShimmerItem key={i} />
        ))}
      </div>
    );
  }

  if (isError && visibleItems.length === 0) {
    return (
      <NewsStatus
        label={`${TAB_LABELS[activeTab]} feed error`}
        detail="Unable to refresh headlines"
        actionLabel="Retry"
        onAction={() => void refetch()}
      />
    );
  }

  if (data?.degradedReason && visibleItems.length === 0) {
    const detail =
      data.degradedReason === 'rate_limited'
        ? 'Cold-start rate guard engaged'
        : 'Upstream feeds returned no items';
    return (
      <NewsStatus
        label={`${TAB_LABELS[activeTab]} feed temporarily unavailable`}
        detail={detail}
        actionLabel="Retry"
        onAction={() => void refetch()}
      />
    );
  }

  if (visibleItems.length === 0) {
    return (
      <NewsStatus
        label={
          isFetching
            ? `Refreshing ${TAB_LABELS[activeTab].toLowerCase()} feed`
            : `No ${TAB_LABELS[activeTab].toLowerCase()} news`
        }
      />
    );
  }

  return (
    <div className="space-y-0">
      {visibleItems.map((item) => (
        <NewsRow key={item.id} item={item} />
      ))}
    </div>
  );
}

/* ─── NewsPanel ─── */

export function NewsPanel() {
  const [activeTab, setActiveTab] = useState<TabKey>('cyber');

  // Read the active tab's query result for the freshness telltale. Shares the
  // same React Query cache entry (key ['news', <tab>]) as the content below, so
  // this does not trigger an extra fetch.
  const { data, dataUpdatedAt } = useNewsData(activeTab);

  // `useFreshness` re-evaluates on a 5s tick so the time-based class stays
  // honest between refetches; we read its tick to recompute `ageMs` below.
  useFreshness(dataUpdatedAt, FRESHNESS);

  // Honest degradation: when the API reports a `degradedReason` (rate-limited
  // cold-start guard or empty upstream fetch) the shown items are cached /
  // overdue — force STALE regardless of how recent the fetch timestamp is.
  // Precedence lives in the tested `resolvePanelFreshness`.
  const freshness = resolvePanelFreshness({
    degraded: !!data?.degradedReason,
    ageMs: dataUpdatedAt > 0 ? Date.now() - dataUpdatedAt : null,
    ...FRESHNESS,
  });

  return (
    <PanelShell
      id="news"
      title="NEWS"
      span={1}
      lastUpdated={dataUpdatedAt > 0 ? dataUpdatedAt : null}
      freshness={freshness}
    >
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 mb-2 -mt-1 border-b border-[var(--border-subtle)]">
        {TABS.map((tab) => (
          <button
            type="button"
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-2 py-1.5 text-[9px] font-mono font-semibold uppercase tracking-wider transition-colors border-b-2',
              activeTab === tab
                ? 'text-[var(--text-primary)] border-[var(--color-info)]'
                : 'text-[var(--text-dim)] border-transparent hover:text-[var(--text-secondary)]',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Content */}
      <NewsPanelContent activeTab={activeTab} />
    </PanelShell>
  );
}
