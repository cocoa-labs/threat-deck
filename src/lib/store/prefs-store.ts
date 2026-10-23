'use client';

import { create } from 'zustand';
import { DEFAULT_PREFERENCES, type UserPreferences } from '@/lib/preferences/schema';

/**
 * DB-per-user preferences store (Phase 2). NOT localStorage-persisted — the DB
 * (`users.preferences`) is the source of truth, hydrated on load by
 * PreferencesBridge. Server code reads the blob from the DB directly; this store
 * is the client-side mirror that the Settings command center reads/writes.
 */
interface PrefsState {
  preferences: UserPreferences;
  focusAreas: string[];
  hydrated: boolean;
  setAll: (preferences: UserPreferences, focusAreas: string[]) => void;
  setSection: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  setFocusAreas: (focusAreas: string[]) => void;
}

export const usePrefsStore = create<PrefsState>((set) => ({
  preferences: DEFAULT_PREFERENCES,
  focusAreas: [],
  hydrated: false,
  setAll: (preferences, focusAreas) => set({ preferences, focusAreas, hydrated: true }),
  setSection: (key, value) => set((s) => ({ preferences: { ...s.preferences, [key]: value } })),
  setFocusAreas: (focusAreas) => set({ focusAreas }),
}));
