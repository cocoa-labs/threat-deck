/** Legacy usage estimate. Atomic admission uses security/budget.ts; zero caps and unavailable storage deny work. */

import { query } from '@/lib/db/client';

const DEFAULT_CAP_USD = 50;

const MODEL_PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  // Sonnet 4.6 (claude-sonnet-4-6)
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-6-20251022': { input: 3, output: 15 },
  // Haiku 4.5 (claude-haiku-4-5-20251001)
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

const DEFAULT_PRICE = { input: 3, output: 15 }; // assume Sonnet on unknown

export interface SpendCheck {
  /** Whether the call is allowed under the configured daily cap. */
  allowed: boolean;
  /** Rolling-24h estimated spend in USD, rounded to cents. */
  estimatedSpend24hUsd: number;
  /** Configured cap. 0 = disabled. */
  capUsd: number;
  /** Reason string when allowed=false. */
  reason?: 'cap_exceeded' | 'db_unavailable_failed_closed';
}

/**
 * Compute the rolling-24h Anthropic spend estimate from agent_events and
 * compare against the configured cap. Returns allowed=false ONLY when
 * a hard cap is configured AND the estimate exceeds it.
 *
 * Cost: one SELECT against an indexed window. ~1ms locally.
 */
export async function checkAnthropicDailySpend(): Promise<SpendCheck> {
  const capUsd = parseCapEnv();
  if (capUsd === 0) {
    return { allowed: false, estimatedSpend24hUsd: 0, capUsd: 0 };
  }

  let totals: { model: string; tokens_input: number | null; tokens_output: number | null }[];
  try {
    const result = await query<{
      model: string;
      tokens_input: number | null;
      tokens_output: number | null;
    }>(
      `SELECT model, SUM(tokens_input)::int AS tokens_input, SUM(tokens_output)::int AS tokens_output
         FROM agent_events
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND model IS NOT NULL
        GROUP BY model`,
    );
    totals = result.rows;
  } catch (err) {
    // Fail-open. Better to risk a spend overshoot than to take the agent
    // offline on a transient DB blip. Surface the gap via console so
    // operators can investigate.
    console.warn(
      '[anthropic-spend] DB unavailable, denying invocation:',
      err instanceof Error ? err.message : String(err),
    );
    return {
      allowed: false,
      estimatedSpend24hUsd: 0,
      capUsd,
      reason: 'db_unavailable_failed_closed',
    };
  }

  let totalUsd = 0;
  for (const row of totals) {
    const price = MODEL_PRICES_PER_MILLION[row.model] ?? DEFAULT_PRICE;
    const inputUsd = ((row.tokens_input ?? 0) * price.input) / 1_000_000;
    const outputUsd = ((row.tokens_output ?? 0) * price.output) / 1_000_000;
    totalUsd += inputUsd + outputUsd;
  }
  const estimatedSpend24hUsd = Math.round(totalUsd * 100) / 100;

  if (estimatedSpend24hUsd >= capUsd) {
    return {
      allowed: false,
      estimatedSpend24hUsd,
      capUsd,
      reason: 'cap_exceeded',
    };
  }

  return { allowed: true, estimatedSpend24hUsd, capUsd };
}

function parseCapEnv(): number {
  const raw = process.env.ANTHROPIC_DAILY_CAP_USD;
  if (raw === undefined || raw === '') return DEFAULT_CAP_USD;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CAP_USD;
  return parsed;
}
