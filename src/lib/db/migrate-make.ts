#!/usr/bin/env -S npx tsx
/**
 * migrate-make.ts — Scaffold a new migration file.
 *
 * Usage:
 *   npm run db:migrate:make -- add_threat_actor_aliases
 *
 * Creates `migrations/NNN_<description>.sql` where NNN is one higher than
 * the highest existing prefix (zero-padded to three digits). Writes a
 * template that includes idempotency reminders and the up-migration
 * boundary markers.
 *
 * Does not touch the database.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrationFiles } from './migrate-utils';

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const MIGRATIONS_DIR = resolve(PROJECT_ROOT, 'migrations');

function sanitizeDescription(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function buildTemplate(description: string): string {
  return `-- Migration: ${description}
-- Created: ${isoDate()}
--
-- This migration runs once and is recorded in the schema_migrations table.
-- Make it idempotent (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN
-- IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING, etc.) for safety against
-- accidental re-runs.
--
-- For schema changes that need a rollback, also create
-- NNN_${description}.down.sql in this directory. The runner does not auto-
-- apply down migrations; rollback is a manual operation.

-- BEGIN MIGRATION

-- (write your SQL here)

-- END MIGRATION
`;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npm run db:migrate:make -- <description>');
    console.error('Example: npm run db:migrate:make -- add_threat_actor_aliases');
    process.exit(1);
  }

  const description = sanitizeDescription(args.join(' '));
  if (!description) {
    console.error(
      'Description must contain at least one alphanumeric character. ' +
        'Got: ' +
        JSON.stringify(args.join(' ')),
    );
    process.exit(1);
  }

  const existing = listMigrationFiles(MIGRATIONS_DIR);
  const highest = existing.length === 0 ? 0 : Math.max(...existing.map((m) => m.number));
  const nextNumber = String(highest + 1).padStart(3, '0');
  const filename = `${nextNumber}_${description}.sql`;
  const path = join(MIGRATIONS_DIR, filename);

  writeFileSync(path, buildTemplate(description), { flag: 'wx' });

  console.log(`Created ${join('migrations', filename)}`);
  console.log('Next:');
  console.log('  1. Edit the file and add your SQL between the BEGIN/END markers.');
  console.log('  2. Run `npm run db:migrate` to apply it.');
}

try {
  main();
} catch (err) {
  if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
    console.error('A migration with that name already exists. Pick a different description.');
    process.exit(1);
  }
  console.error('[migrate:make] Unhandled error:', err);
  process.exit(1);
}
