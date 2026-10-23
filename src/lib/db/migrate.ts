#!/usr/bin/env -S npx tsx
/**
 * migrate.ts — Apply pending SQL migrations from migrations/*.sql.
 *
 * Reads every file matching `migrations/[0-9]+_*.sql`, sorted by filename.
 * For each file:
 *   - Compute SHA-256 checksum.
 *   - If already applied with matching checksum → skip.
 *   - If already applied with different checksum → log a warning and ABORT
 *     (the file was edited after it ran in some environment; write a NEW
 *     migration to make the change instead).
 *   - If unapplied → run inside a transaction, then record in
 *     `schema_migrations`.
 *
 * Exit 0 on success, 1 on any failure. Designed to run via:
 *   npm run db:migrate
 *
 * Reads DATABASE_URL from the environment. Loads `.env.local` and `.env`
 * (in that priority order) if present, to match Next.js's behavior.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { loadEnv } from './migrate-utils';

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const MIGRATIONS_DIR = join(PROJECT_ROOT, 'migrations');

interface DiscoveredMigration {
  /** Bare filename: `001_initial_schema.sql` */
  filename: string;
  /** Migration name without extension: `001_initial_schema` */
  name: string;
  /** Absolute path */
  path: string;
  /** Raw SQL contents */
  sql: string;
  /** SHA-256 hex of the sql contents */
  checksum: string;
}

interface RecordedMigration {
  migration_name: string;
  checksum: string;
}

function discoverMigrations(): DiscoveredMigration[] {
  let entries: string[];
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    throw new Error(`Could not read migrations directory at ${MIGRATIONS_DIR}: ${String(err)}`);
  }

  const files = entries
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith('.down.sql'))
    .sort();

  return files.map((filename) => {
    const path = join(MIGRATIONS_DIR, filename);
    const sql = readFileSync(path, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    return {
      filename,
      name: filename.replace(/\.sql$/, ''),
      path,
      sql,
      checksum,
    };
  });
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum TEXT NOT NULL
    );
  `);
}

async function fetchRecorded(client: Client): Promise<Map<string, RecordedMigration>> {
  const { rows } = await client.query<RecordedMigration>(
    'SELECT migration_name, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.migration_name, r]));
}

async function applyMigration(client: Client, migration: DiscoveredMigration): Promise<void> {
  await client.query('BEGIN');
  try {
    const demo = ['003_initial_seed', '007_mitre_ttps_seed'].includes(migration.name);
    if (demo && process.env.INSTALL_DEMO_DATA === 'true' && process.env.ENABLE_DEMO_DATA !== 'true')
      throw new Error('Demo seed installation also requires ENABLE_DEMO_DATA=true');
    if (!demo || process.env.INSTALL_DEMO_DATA === 'true') await client.query(migration.sql);
    await client.query('INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)', [
      migration.name,
      migration.checksum,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* swallow rollback failures so we surface the original error */
    });
    throw err;
  }
}

async function main(): Promise<void> {
  loadEnv(PROJECT_ROOT);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const migrations = discoverMigrations();
  if (migrations.length === 0) {
    console.log('[migrate] No migrations found in migrations/. Nothing to do.');
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const startedAt = Date.now();
  let appliedCount = 0;
  let skippedCount = 0;

  try {
    await ensureMigrationsTable(client);
    const recorded = await fetchRecorded(client);

    for (const migration of migrations) {
      const existing = recorded.get(migration.name);

      if (existing) {
        if (existing.checksum === migration.checksum) {
          console.log(`[migrate] skip   ${migration.name} (already applied)`);
          skippedCount += 1;
          continue;
        }

        console.error(
          `[migrate] ABORT  ${migration.name} — checksum mismatch.\n` +
            `  recorded:  ${existing.checksum.slice(0, 12)}…\n` +
            `  on disk:   ${migration.checksum.slice(0, 12)}…\n` +
            '  A migration that was already applied has been edited. This is unsafe — \n' +
            '  write a NEW migration that performs your correction instead.',
        );
        process.exit(1);
      }

      process.stdout.write(`[migrate] apply  ${migration.name} ...`);
      try {
        await applyMigration(client, migration);
        process.stdout.write(' OK\n');
        appliedCount += 1;
      } catch (err) {
        process.stdout.write(' FAILED\n');
        console.error(`[migrate] ${migration.name} failed:`, err);
        process.exit(1);
      }
    }
  } finally {
    await client.end();
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[migrate] Applied ${appliedCount} migration${appliedCount === 1 ? '' : 's'}, ` +
      `skipped ${skippedCount}, total time ${elapsedMs}ms.`,
  );
}

main().catch((err) => {
  console.error('[migrate] Unhandled error:', err);
  process.exit(1);
});
