import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db/client';
import { AI_MAX_OUTPUT_TOKENS, aiPolicyResponse } from './ai-policy';
import { AIUsageObserver, estimateAIReservation } from './ai-usage';
import { configuredBudget, type BudgetProvider as Provider } from './budget-config';
import { requireCapability } from './capabilities';

export { configuredBudget } from './budget-config';

/** Serialize reservation + admission across all workers and deployments. */
export async function reserveBudget(
  provider: Provider,
  usd: number,
): Promise<(settledUsd?: number) => Promise<void>> {
  requireCapability(provider);
  const cap = configuredBudget(provider);
  if (!Number.isFinite(usd) || usd <= 0 || (cap > 0 && usd > cap))
    throw new Error('budget_exceeded');
  const client = await db.connect();
  const id = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [provider === 'ai' ? 749101 : 749102]);
    const result = await client.query<{ spent: string; active: string }>(
      `SELECT COALESCE(SUM(COALESCE(settled_usd, reserved_usd)), 0)::text AS spent,
         COUNT(*) FILTER (WHERE released_at IS NULL AND expires_at > now())::text AS active
       FROM security_budget_reservations
       WHERE provider = $1 AND created_at > now() - interval '24 hours'`,
      [provider],
    );
    const row = result.rows[0];
    if (!row || !Number.isFinite(Number(row.spent)) || (cap > 0 && Number(row.spent) + usd > cap))
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
  return async (settledUsd) => {
    if (settledUsd !== undefined && (!Number.isFinite(settledUsd) || settledUsd < 0))
      throw new Error('invalid_budget_settlement');
    // The first release wins, including when cancellation races stream completion.
    // Unknown usage retains its estimate; confirmed rejection settles at zero.
    await db.query(
      `UPDATE security_budget_reservations SET released_at = now(), settled_usd = $2
       WHERE id = $1 AND released_at IS NULL`,
      [id, settledUsd ?? null],
    );
  };
}

/** Conservative reservation per provider attempt, including SDK retries. */
export const budgetedAIFetch: typeof fetch = async (input, init) => {
  try {
    requireCapability('ai');
  } catch {
    return aiPolicyResponse('capability_disabled:ai');
  }
  if (typeof init?.body !== 'string') return aiPolicyResponse('unsupported_provider_body');
  const bytes = Buffer.byteLength(init.body);
  if (bytes > 8 * 1024 * 1024) return aiPolicyResponse('provider_request_too_large');
  let body: { max_tokens?: number; model?: string; inference_geo?: string; speed?: string };
  try {
    body = JSON.parse(init.body);
    if (!body || typeof body !== 'object') return aiPolicyResponse('unsupported_provider_body');
  } catch {
    return aiPolicyResponse('unsupported_provider_body');
  }
  // Token counting generates no output, but still shares admission/concurrency controls.
  const url = new URL(input instanceof Request ? input.url : String(input));
  const counting = url.pathname === '/v1/messages/count_tokens' && init.method === 'POST';
  const output = counting ? 0 : Number(body.max_tokens);
  if (!counting && (!Number.isSafeInteger(output) || output <= 0 || output > AI_MAX_OUTPUT_TOKENS))
    return aiPolicyResponse('invalid_output_budget');
  const reserved = counting ? 0.000001 : estimateAIReservation(body, bytes, output);
  let release: (settledUsd?: number) => Promise<void>;
  try {
    release = await reserveBudget('ai', reserved);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return aiPolicyResponse(
      ['budget_exceeded', 'budget_not_configured', 'provider_concurrency_exceeded'].includes(code)
        ? code
        : 'budget_unavailable',
    );
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(120_000),
    ...(init.signal ? [init.signal] : []),
  ]);
  try {
    const response = await fetch(input, { ...init, signal });
    const rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
    const usage = new AIUsageObserver(response.headers.get('content-type') ?? '', body);
    const settlement = () => (counting || rejected ? 0 : usage.cost());
    if (!response.body) {
      await release(settlement());
      return response;
    }
    const reader = response.body.getReader();
    let received = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            usage.finish();
            await release(settlement());
            controller.close();
            return;
          }
          received += value.byteLength;
          if (received > 16 * 1024 * 1024) throw new Error('provider_response_too_large');
          if (response.ok && !counting) usage.push(value);
          controller.enqueue(value);
        } catch (error) {
          await reader.cancel().catch(() => {});
          await release(settlement()).catch(() => {});
          controller.error(error);
        }
      },
      async cancel() {
        await reader.cancel();
        await release(settlement());
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
