'use client';

import type { IntelligenceCategory } from '@/lib/types';
import { categoryToHex } from '@/lib/utils/geo';

interface Props {
  pointCount: number;
  categories: Record<string, number>;
}

export function TooltipCluster({ pointCount, categories }: Props) {
  const entries = Object.entries(categories).filter(([, count]) => count > 0);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-[var(--text-primary)]">
        {pointCount} event{pointCount !== 1 ? 's' : ''}
      </p>
      {entries.length > 0 && (
        <div className="space-y-0.5">
          {entries.map(([cat, count]) => (
            <div key={cat} className="flex items-center gap-1.5 text-[10px] font-mono">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: categoryToHex(cat as IntelligenceCategory) }}
              />
              <span className="text-[var(--text-dim)] uppercase">{cat}</span>
              <span className="text-[var(--text-muted)]">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
