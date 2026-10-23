'use client';

import { useState } from 'react';
import { useClusterLeaves } from '@/lib/hooks/use-cluster-leaves';
import type { GlobeMarker, IntelligenceCategory } from '@/lib/types';
import { categoryToHex } from '@/lib/utils/geo';
import { MarkerItemRow, SEVERITY_ORDER } from './MarkerItemRow';

interface Props {
  clusterId: number;
  pointCount: number;
  categories: Record<string, number>;
  onZoomIn: () => void;
}

const ITEMS_PER_PAGE = 10;

const CLUSTER_CATEGORY_COLOR: Record<string, string> = {
  cve: '#ff4444',
  breach: '#ff00aa',
  threat_actor: '#aa00ff',
  ai_incident: '#00ffff',
  critical_infra: '#88aaff',
  ioc: '#ff8800',
  ai_safety: '#00ffaa',
};

function clusterCategoryColor(category: string): string {
  return (
    CLUSTER_CATEGORY_COLOR[category] ?? categoryToHex(category as IntelligenceCategory) ?? '#888888'
  );
}

// ─── Shimmer Placeholder ───

function ShimmerRows() {
  return (
    <div className="space-y-1.5 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5 px-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--text-muted)]/20 animate-pulse" />
          <span className="h-2.5 flex-1 rounded bg-[var(--text-muted)]/20 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// ─── Category Summary Header ───

function CategorySummary({ categories }: { categories: Record<string, number> }) {
  const entries = Object.entries(categories).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 py-1.5">
      {entries.map(([cat, count]) => (
        <div key={cat} className="flex items-center gap-1 text-[10px] font-mono">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: clusterCategoryColor(cat) }}
          />
          <span className="text-[var(--text-dim)] uppercase">{cat}</span>
          <span className="text-[var(--text-muted)]">{count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Grouped View ───

function GroupedView({ items }: { items: GlobeMarker[] }) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Group items by category
  const groups = new Map<string, GlobeMarker[]>();
  for (const item of items) {
    const cat = item.category;
    const existing = groups.get(cat);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(cat, [item]);
    }
  }

  // Sort groups by count descending
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="space-y-0.5">
      {sortedGroups.map(([cat, groupItems]) => {
        const isOpen = expandedCategories.has(cat);
        return (
          <div key={cat}>
            <button
              type="button"
              onClick={() => toggleCategory(cat)}
              className="flex w-full items-center gap-1.5 py-1 px-1.5 rounded text-left transition-colors hover:bg-[var(--bg-primary)]/50"
            >
              <span className="text-[10px] text-[var(--text-muted)]">{isOpen ? '▼' : '▶'}</span>
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: categoryToHex(cat as IntelligenceCategory) }}
              />
              <span className="text-[10px] font-mono font-semibold text-[var(--text-dim)] uppercase flex-1">
                {cat}
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {groupItems.length}
              </span>
            </button>
            {isOpen && (
              <div className="ml-3 border-l border-[var(--border-subtle)] pl-1">
                {groupItems.map((marker) => (
                  <MarkerItemRow key={marker.id} marker={marker} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Flat View ───

function FlatView({ items }: { items: GlobeMarker[] }) {
  const [page, setPage] = useState(0);

  // Sort by severity (critical first) then by recency
  const sorted = [...items].sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4);
    if (sevDiff !== 0) return sevDiff;
    const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tB - tA;
  });

  const totalPages = Math.ceil(sorted.length / ITEMS_PER_PAGE);
  const pageItems = sorted.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  return (
    <div>
      <div className="space-y-0.5">
        {pageItems.map((marker) => (
          <MarkerItemRow key={marker.id} marker={marker} />
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-[9px] font-mono text-[var(--color-info)] disabled:text-[var(--text-muted)] disabled:cursor-default"
          >
            Prev
          </button>
          <span className="text-[9px] font-mono text-[var(--text-muted)]">
            {page + 1}/{totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-[9px] font-mono text-[var(--color-info)] disabled:text-[var(--text-muted)] disabled:cursor-default"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main ClusterCard ───

export function ClusterCard({ clusterId, pointCount, categories, onZoomIn }: Props) {
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('grouped');
  const { items, loading, error } = useClusterLeaves(clusterId, pointCount);

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <p className="text-xs font-semibold text-[var(--text-primary)]">
          {pointCount} event{pointCount !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-0.5 rounded border border-[var(--border-subtle)] overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode('grouped')}
            className={`px-1.5 py-0.5 text-[9px] font-mono transition-colors ${
              viewMode === 'grouped'
                ? 'bg-[var(--color-info)]/10 text-[var(--color-info)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
            }`}
          >
            Grouped
          </button>
          <button
            type="button"
            onClick={() => setViewMode('flat')}
            className={`px-1.5 py-0.5 text-[9px] font-mono transition-colors ${
              viewMode === 'flat'
                ? 'bg-[var(--color-info)]/10 text-[var(--color-info)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-dim)]'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* Category summary */}
      <div className="px-3 border-b border-[var(--border-subtle)]">
        <CategorySummary categories={categories} />
      </div>

      {/* Items area */}
      <div className="px-1.5 py-1.5 max-h-[280px] overflow-y-auto">
        {loading && <ShimmerRows />}
        {error && <p className="text-[10px] font-mono text-red-400 px-1.5 py-2">Error: {error}</p>}
        {!loading &&
          !error &&
          items.length > 0 &&
          (viewMode === 'grouped' ? <GroupedView items={items} /> : <FlatView items={items} />)}
        {!loading && !error && items.length === 0 && (
          <p className="text-[10px] font-mono text-[var(--text-muted)] px-1.5 py-2">
            No items loaded
          </p>
        )}
      </div>

      {/* Zoom in hint for large clusters */}
      {pointCount > 100 && (
        <div className="px-3 pb-3 pt-1.5 border-t border-[var(--border-subtle)]">
          <p className="text-[9px] font-mono text-[var(--text-muted)] mb-1.5">
            Zoom in to see all {pointCount} events
          </p>
          <button
            type="button"
            onClick={onZoomIn}
            className="flex w-full items-center justify-center rounded border border-[var(--color-info)]/20 bg-[var(--color-info)]/5 px-2 py-1.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--color-info)] transition-colors hover:bg-[var(--color-info)]/10"
          >
            Zoom In
          </button>
        </div>
      )}
    </div>
  );
}
