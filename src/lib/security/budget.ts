import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db/client';
import { requireCapability } from './capabilities';

type Provider = 'ai' | 'media';

export function configuredBudget(provider: Provider): number {
  const value = Number(
    provider === 'ai'
      ? (process.env.ANTHROPIC_DAILY_CAP_USD ?? 50)
      : (process.env.OUTBOUND_VISUAL_DAILY_SPEND_USD_HARD ?? 30),
  );
  if (!Number.isFinite(value) || value <= 0) throw new Error('budget_not_configured');
  return value;
}

/** Serialize reservation + admission across all workers and deployments. */
export async function reserveBudget(provider: Provider, usd: number): Promise<() => Promise<void>> {
  requireCapability(provider);
  const cap = configuredBudget(provider);
  if (!Number.isFinite(usd) || usd <= 0 || usd > cap) throw new Error('budget_exceeded');
  const client = await db.connect();
  const id = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [provider === 'ai' ? 749101 : 749102]);
    const result = await client.query<{ spent: string; active: string }>(
      `SELECT COALESCE(SUM(reserved_usd), 0)::text AS spent,
         COUNT(*) FILTER (WHERE released_at IS NULL AND expires_at > now())::text AS active
       FROM security_budget_reservations
       WHERE provider = $1 AND created_at > now() - interval '24 hours'`,
      [provider],
    );
    const row = result.rows[0];
    if (!row || !Number.isFinite(Number(row.spent)) || Number(row.spent) + usd > cap)
      throw new Error('budget_exceeded');
    if (Number(row.active) >= 4) throw new Error('provider_concurrency_exceeded');
    await client.query(
      `INSERT INTO security_budget_reservations (id, provider, reserved_usd, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 minutes')`,
      [id, provider, usd],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return async () => {
    await db.query('UPDATE security_budget_reservations SET released_at = now() WHERE id = $1', [
      id,
    ]);
  };
}

/** Conservative reservation per provider attempt, including SDK retries. */
export const budgetedAIFetch: typeof fetch = async (input, init) => {
  requireCapability('ai');
  if (typeof init?.body !== 'string') throw new Error('unsupported_provider_body');
  const bytes = Buffer.byteLength(init.body);
  if (bytes > 8 * 1024 * 1024) throw new Error('provider_request_too_large');
  const body = JSON.parse(init.body) as { max_tokens?: number };
  const output = Number(body.max_tokens);
  if (!Number.isSafeInteger(output) || output <= 0 || output > 32_768)
    throw new Error('invalid_output_budget');
  // UTF-8 bytes upper-bound ordinary text token count. Rates deliberately exceed
  // supported model prices; image/document requests reserve additional headroom.
  const reserved = Math.max(0.01, ((bytes + 20_000) * 30 + output * 150) / 1_000_000);
  const release = await reserveBudget('ai', reserved);
  const signal = AbortSignal.any([
    AbortSignal.timeout(120_000),
    ...(init.signal ? [init.signal] : []),
  ]);
  try {
    const response = await fetch(input, { ...init, signal });
    if (!response.body) {
      await release();
      return response;
    }
    const reader = response.body.getReader();
    let received = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            await release();
            controller.close();
            return;
          }
          received += value.byteLength;
          if (received > 16 * 1024 * 1024) throw new Error('provider_response_too_large');
          controller.enqueue(value);
        } catch (error) {
          await reader.cancel().catch(() => {});
          await release().catch(() => {});
          controller.error(error);
        }
      },
      async cancel() {
        await reader.cancel();
        await release();
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
};
