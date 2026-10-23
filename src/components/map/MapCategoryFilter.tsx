'use client';

import { useCallback, useRef, useState } from 'react';
import { useMapStore } from '@/lib/store/map-store';
import type { IntelligenceCategory } from '@/lib/types';
import { categoryToHex } from '@/lib/utils/geo';

const CATEGORIES: { key: IntelligenceCategory; label: string }[] = [
  { key: 'conflict', label: 'CONFLICT' },
  { key: 'economic', label: 'ECON' },
  { key: 'technology', label: 'TECH' },
  { key: 'policy', label: 'POLICY' },
  { key: 'proliferation', label: 'PROLIF' },
  { key: 'instability', label: 'INSTAB' },
  { key: 'strategic', label: 'STRAT' },
  { key: 'market', label: 'MARKET' },
];

export function MapCategoryFilter() {
  const setCategoryFilter = useMapStore((s) => s.setCategoryFilter);
  const activeRef = useRef<Set<IntelligenceCategory>>(new Set());
  const [active, setActive] = useState<Set<IntelligenceCategory>>(new Set());

  const toggle = useCallback(
    (cat: IntelligenceCategory) => {
      const next = new Set(activeRef.current);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      activeRef.current = next;
      setActive(next);
      setCategoryFilter(next.size > 0 ? next : null);
    },
    [setCategoryFilter],
  );

  return (
    <div
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
      style={{
        backdropFilter: 'blur(12px)',
        background: 'rgba(10, 10, 10, 0.7)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {CATEGORIES.map(({ key, label }) => {
        const isActive = active.has(key);
        const color = categoryToHex(key);

        return (
          <button
            type="button"
            key={key}
            onClick={() => toggle(key)}
            className="px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider transition-all"
            style={{
              color: isActive ? color : 'rgba(232, 232, 232, 0.4)',
              background: isActive ? `${color}18` : 'transparent',
              border: `1px solid ${isActive ? `${color}44` : 'rgba(255, 255, 255, 0.06)'}`,
              boxShadow: isActive ? `0 0 8px ${color}33` : 'none',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
