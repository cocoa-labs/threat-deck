'use client';

import { useEffect } from 'react';
import { fetchPreferences } from '@/lib/preferences/client';
import { usePrefsStore } from '@/lib/store/prefs-store';

/**
 * Hydrates the prefs-store from the DB (`users.preferences`) once on mount.
 * Fail-soft: if unauthenticated or the fetch errors, the store keeps its
 * DEFAULT_PREFERENCES and the UI still renders. DB is the source of truth — this
 * is the client mirror the Settings command center reads/writes.
 */
export function PreferencesBridge(): null {
  const setAll = usePrefsStore((s) => s.setAll);

  useEffect(() => {
    let cancelled = false;
    void fetchPreferences().then((res) => {
      if (!cancelled && res) setAll(res.preferences, res.focusAreas);
    });
    return () => {
      cancelled = true;
    };
  }, [setAll]);

  return null;
}
