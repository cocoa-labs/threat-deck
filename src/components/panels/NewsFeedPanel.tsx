'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useFreshness } from '@/lib/hooks/use-freshness';
import { geotagNewsItem } from '@/lib/mapbox/geotag';
import { useMapStore } from '@/lib/store/map-store';
import type { NewsItem } from '@/lib/types';
import { cn } from '@/lib/utils/cn';
import { formatRelativeTime } from '@/lib/utils/format';
import { prefillAgent } from '@/lib/utils/panel-actions';
import { PanelShell } from './PanelShell';

// OSINT RSS refetches every 60s — live within 5m, stale past 30m.
const FRESHNESS = { liveMs: 5 * 60_000, staleMs: 30 * 60_000 };

const CATEGORY_DOT: Record<string, string> = {
  think_tank: 'bg-zinc-400',
  defense: 'bg-orange-400',
  cybersecurity: 'bg-blue-400',
  nuclear: 'bg-red-400',
  intelligence: 'bg-purple-400',
};

export function NewsFeedPanel() {
  const viewMode = useMapStore((s) => s.viewMode);

  const { data: newsItems, dataUpdatedAt } = useQuery<NewsItem[]>({
    queryKey: ['osintFeed'],
    queryFn: async () => {
      const res = await fetch('/api/data/osint');
      if (!res.ok) return [];
      const data = await res.json();
      const feeds = (data.feeds ?? []) as { category: string; items: NewsItem[] }[];
      const seen = new Set<string>();
      const allItems = feeds
        .flatMap((f) => f.items)
        .filter((item) => !Number.isNaN(new Date(item.publishedAt).getTime()))
        .filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      allItems.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
      return allItems.slice(0, 20);
    },
    refetchInterval: 60_000,
  });

  // Pre-compute geo for each item
  const geoItems = useMemo(
    () => (newsItems ?? []).map((item) => ({ item, geo: geotagNewsItem(item) })),
    [newsItems],
  );

  const freshness = useFreshness(dataUpdatedAt, FRESHNESS);

  return (
    <PanelShell
      id="newsFeed"
      title="OSINT FEED"
      span={1}
      lastUpdated={dataUpdatedAt > 0 ? dataUpdatedAt : null}
      freshness={freshness}
    >
      <div className="flex flex-col gap-0.5">
        {geoItems.length === 0 && (
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            Loading OSINT feed...
          </span>
        )}

        {geoItems.map(({ item, geo }) => (
          <button
            type="button"
            key={item.id}
            onClick={() => {
              if ((viewMode === 'map' || viewMode === 'command') && geo) {
                useMapStore.getState().flyTo(geo.lat, geo.lon, 6);
              }
              prefillAgent(
                `Analyze this OSINT intelligence: "${item.title}". What are the geopolitical or security implications?`,
                {
                  sourcePanel: 'newsFeed',
                  dataType: 'osint_item',
                  trendData: {
                    title: item.title,
                    source: item.source,
                    category: item.category,
                    publishedAt: item.publishedAt,
                    url: item.url,
                    ...(geo ? { lat: geo.lat, lon: geo.lon } : {}),
                  },
                },
              );
            }}
            className={cn(
              'group flex items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)] cursor-pointer w-full',
            )}
          >
            {/* Severity dot */}
            <span
              className={cn(
                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                CATEGORY_DOT[item.category] ?? 'bg-zinc-500',
              )}
            />

            <div className="min-w-0 flex-1">
              {/* Headline */}
              <p className="text-[11px] font-medium text-[var(--text-primary)] leading-snug line-clamp-2">
                {item.title}
              </p>

              {/* Meta */}
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase">
                  {item.source}
                </span>
                <span className="text-[9px] text-[var(--text-muted)]">
                  {formatRelativeTime(item.publishedAt)}
                </span>
                {geo && <MapPin size={10} className="text-[var(--text-muted)] opacity-60" />}
              </div>
            </div>

            {/* External link */}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="mt-1 shrink-0"
              >
                <ExternalLink
                  size={10}
                  className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--color-info)]"
                />
              </a>
            )}
          </button>
        ))}
      </div>
    </PanelShell>
  );
}
