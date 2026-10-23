#!/usr/bin/env -S npx tsx
/**
 * migrate-status.ts — Print a table showing which migrations are applied,
 * which are pending, and which have a checksum mismatch (CHANGED).
 *
 * Reads DATABASE_URL from the environment (via .env.local / .env loader).
 * Does NOT modify the database — read-only inspection.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { listMigrationFiles, loadEnv } from './migrate-utils';

const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), '../../../..');
const MIGRATIONS_DIR = resolve(PROJECT_ROOT, 'migrations');

interface RecordedRow {
  migration_name: string;
  applied_at: Date | string;
  checksum: string;
}

type Status = 'APPLIED' | 'PENDING' | 'CHANGED';

interface Row {
  name: string;
  status: Status;
  appliedAt: string;
  checksum: string;
}

function formatTimestamp(ts: Date | string | null): string {
  if (!ts) return '—';
  const date = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  // YYYY-MM-DD HH:MM:SS in UTC for stable, easily-greppable output
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function padCell(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

function printTable(rows: Row[]): void {
  const header = {
    name: 'Migration',
    status: 'Status',
    appliedAt: 'Applied At',
    checksum: 'Checksum',
  };

  const widths = {
    name: Math.max(header.name.length, ...rows.map((r) => r.name.length)),
    status: Math.max(header.status.length, ...rows.map((r) => r.status.length)),
    appliedAt: Math.max(header.appliedAt.length, ...rows.map((r) => r.appliedAt.length)),
    checksum: Math.max(header.checksum.length, ...rows.map((r) => r.checksum.length)),
  };

  const formatLine = (r: { name: string; status: string; appliedAt: string; checksum: string }) =>
    [
      padCell(r.name, widths.name),
      padCell(r.status, widths.status),
      padCell(r.appliedAt, widths.appliedAt),
      padCell(r.checksum, widths.checksum),
    ].join('  ');

  console.log(formatLine(header));
  console.log(
    [widths.name, widths.status, widths.appliedAt, widths.checksum]
      .map((w) => '-'.repeat(w))
      .join('  '),
  );
  for (const r of rows) {
    console.log(formatLine(r));
  }
}

async function main(): Promise<void> {
  loadEnv(PROJECT_ROOT);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[migrate:status] DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const files = listMigrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    console.log('[migrate:status] No migrations found in migrations/.');
    return;
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let recorded: Map<string, RecordedRow>;
  try {
    // Don't auto-create the table — if it doesn't exist, treat every
    // migration as PENDING. The runner is responsible for creation.
    const tableExists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'schema_migrations'
       ) AS exists`,
    );

    if (tableExists.rows[0]?.exists) {
      const { rows } = await client.query<RecordedRow>(
        'SELECT migration_name, applied_at, checksum FROM schema_migrations',
      );
      recorded = new Map(rows.map((r) => [r.migration_name, r]));
    } else {
      recorded = new Map();
    }
  } finally {
    await client.end();
  }

  const tableRows: Row[] = files.map((file) => {
    const sql = readFileSync(file.path, 'utf8');
    const onDiskChecksum = createHash('sha256').update(sql).digest('hex');
    const existing = recorded.get(file.name);

    if (!existing) {
      return {
        name: file.name,
        status: 'PENDING',
        appliedAt: '—',
        checksum: `${onDiskChecksum.slice(0, 8)} (new)`,
      };
    }

    if (existing.checksum !== onDiskChecksum) {
      return {
        name: file.name,
        status: 'CHANGED',
        appliedAt: formatTimestamp(existing.applied_at),
        checksum: `${existing.checksum.slice(0, 8)} → ${onDiskChecksum.slice(0, 8)}`,
      };
    }

    return {
      name: file.name,
      status: 'APPLIED',
      appliedAt: formatTimestamp(existing.applied_at),
      checksum: existing.checksum.slice(0, 8),
    };
  });

  printTable(tableRows);

  const pending = tableRows.filter((r) => r.status === 'PENDING').length;
  const changed = tableRows.filter((r) => r.status === 'CHANGED').length;
  console.log('');
  console.log(`Total: ${tableRows.length}  |  Pending: ${pending}  |  Changed: ${changed}`);

  if (changed > 0) {
    console.log('');
    console.log(
      'WARNING: One or more migrations were edited after being applied. The runner will refuse to ' +
        're-apply them. Write a NEW migration that performs your correction instead.',
    );
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[migrate:status] Unhandled error:', err);
  process.exit(1);
});
