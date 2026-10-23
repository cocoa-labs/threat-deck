'use client';
import { useEffect, useState } from 'react';
import { feedFields } from '@/lib/data/panel-feeds';
import { dataProvenance } from '@/lib/data/provenance';
import { useDataStore } from '@/lib/store/data-store';

export function useFeedProvenance(panel: string) {
  const field = feedFields[panel as keyof typeof feedFields];
  const data = useDataStore((state) => (field ? state[field] : undefined));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!field) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [field]);
  return field ? dataProvenance(data, now) : undefined;
}
