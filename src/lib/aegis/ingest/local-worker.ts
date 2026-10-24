import { db } from '@/lib/db/client';
import { runAegisIngest } from './index';

/** A session lock prevents overlapping collectors across local server processes. */
export async function runCollectionPass(): Promise<void> {
  const client = await db.connect();
  let locked = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(749103) AS acquired',
    );
    locked = result.rows[0]?.acquired === true;
    if (!locked) return;
    const summary = await runAegisIngest();
    console.log('[AEGIS collection]', JSON.stringify(summary));
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(749103)');
    } finally {
      client.release();
    }
  }
}

/** Read public feeds only; never enables autonomous AI, email, or publishing. */
export function startAegisCollection(): () => void {
  if (process.env.ENABLE_AEGIS_INGEST !== 'true' || process.env.ENABLE_DEMO_DATA === 'true')
    return () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      await runCollectionPass();
    } catch {
      console.warn(
        '[AEGIS collection] Refresh failed; existing data retained. Retrying in one hour.',
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), 3600_000);
        timer.unref();
      }
    }
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
