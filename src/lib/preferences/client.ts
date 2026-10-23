'use client';

import type { UserPreferences, UserPreferencesPatch } from './schema';

export interface PreferencesResponse {
  preferences: UserPreferences;
  focusAreas: string[];
}

export async function fetchPreferences(): Promise<PreferencesResponse | null> {
  try {
    const res = await fetch('/api/preferences');
    if (!res.ok) return null;
    return (await res.json()) as PreferencesResponse;
  } catch {
    return null;
  }
}

/** PATCH a partial set of sections. Returns the merged blob on success, else null. */
export async function savePreferencePatch(
  patch: UserPreferencesPatch,
): Promise<UserPreferences | null> {
  try {
    const res = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { preferences: UserPreferences };
    return json.preferences;
  } catch {
    return null;
  }
}

export async function saveFocusAreas(focusAreas: string[]): Promise<boolean> {
  try {
    const res = await fetch('/api/preferences/focus-areas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focusAreas }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
