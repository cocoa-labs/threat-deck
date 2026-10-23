'use client';

import { relativeTime } from '@/lib/utils/geo';

interface Props {
  newsSource: string;
  publishedAt?: string;
}

export function TooltipNews({ newsSource, publishedAt }: Props) {
  return (
    <div className="mt-1.5 space-y-0.5 text-[10px] font-mono text-[var(--text-dim)]">
      <p>
        <span className="text-[var(--text-muted)]">Source:</span> {newsSource}
      </p>
      {publishedAt && (
        <p>
          <span className="text-[var(--text-muted)]">Published:</span> {relativeTime(publishedAt)}
        </p>
      )}
    </div>
  );
}
