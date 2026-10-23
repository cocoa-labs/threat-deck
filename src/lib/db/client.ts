import { Pool } from 'pg';

const globalForDb = globalThis as typeof globalThis & {
  _pgPool?: Pool;
};

function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export const db = globalForDb._pgPool ?? createPool();

globalForDb._pgPool = db;

export type QueryResult<T> = {
  rows: T[];
  rowCount: number | null;
};

export async function query<T>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  const result = await db.query(text, params);
  return {
    rows: result.rows as T[],
    rowCount: result.rowCount,
  };
}

export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}
