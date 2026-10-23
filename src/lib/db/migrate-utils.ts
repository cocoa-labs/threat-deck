/**
 * migrate-utils.ts — Shared helpers for migrate.ts / migrate-status.ts /
 * migrate-make.ts. Intentionally dependency-free (no `dotenv` package) — the
 * migration scripts run as standalone tsx processes and shouldn't pull in
 * extra deps just for a 30-line .env parser.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load environment variables from .env.local then .env (in that order — first
 * file wins per key), mirroring Next.js's load order. Does not overwrite vars
 * that are already set in the process environment.
 */
export function loadEnv(projectRoot: string): void {
  if (process.env.TEST_INTEGRATION === 'true') return;
  const candidates = ['.env.local', '.env'];
  for (const filename of candidates) {
    const path = join(projectRoot, filename);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes if present
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export interface DiscoveredMigrationMeta {
  filename: string;
  name: string;
  path: string;
  /** Numeric prefix as parsed from the filename, e.g. 1, 2, 5. */
  number: number;
}

/**
 * Lightweight directory scan for filename + numeric prefix only. Used by
 * migrate-status and migrate-make. The full SQL contents are not read here
 * — migrate.ts has its own loader that includes checksum computation.
 */
export function listMigrationFiles(migrationsDir: string): DiscoveredMigrationMeta[] {
  let entries: string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort()
    .map((filename) => {
      const match = filename.match(/^(\d+)_/);
      const number = match?.[1] ? Number.parseInt(match[1], 10) : 0;
      return {
        filename,
        name: filename.replace(/\.sql$/, ''),
        path: join(migrationsDir, filename),
        number,
      };
    });
}
