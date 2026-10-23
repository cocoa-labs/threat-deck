/**
 * localStorage rename helper — runs once at module load time, before any Zustand
 * persist middleware hydrates, to copy the old key's value to the new key.
 *
 * Background: when we renamed the persist keys from `klammer-*` → `threatdeck-*`
 * in Phase 5 / 7.2, any returning user's persisted state was orphaned because
 * Zustand's `persist` middleware doesn't know the key changed. This helper
 * silently migrates the data so users don't lose conversation history, panel
 * layouts, etc.
 *
 * Run from the top of any store module that changed its persist key:
 *
 *   import { migrateLocalStorageKey } from '@/lib/utils/storage-migration';
 *   migrateLocalStorageKey('klammer-agent', 'threatdeck-agent');
 *
 * Behavior:
 * - SSR-safe (no-op if window is undefined)
 * - Idempotent (no-op if old key absent or new key already populated)
 * - Logs once to console for observability
 * - Removes the old key after successful copy so the next session doesn't re-migrate
 */
export function migrateLocalStorageKey(oldKey: string, newKey: string): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

  try {
    const oldValue = localStorage.getItem(oldKey);
    if (!oldValue) return;

    const newValue = localStorage.getItem(newKey);
    if (newValue) {
      // New key already populated — likely the user has used the renamed store
      // in this browser since the rename. Drop the orphaned old key.
      localStorage.removeItem(oldKey);
      return;
    }

    localStorage.setItem(newKey, oldValue);
    localStorage.removeItem(oldKey);
    console.info(
      `[storage-migration] Migrated localStorage key "${oldKey}" → "${newKey}" (preserved your session data)`,
    );
  } catch (err) {
    // localStorage can throw QuotaExceededError or be blocked in private modes.
    // Fail silently — the user just keeps their fresh store; old data stays
    // orphaned until they clear it manually.
    console.warn(`[storage-migration] Failed to migrate "${oldKey}" → "${newKey}":`, err);
  }
}
