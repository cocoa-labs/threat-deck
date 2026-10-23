/** Optional preflight estimate. Atomic admission is enforced per attempt in budget.ts. */
import { query } from '@/lib/db/client';
import { configuredBudget } from './budget-config';

export interface SpendCheck {
  allowed: boolean;
  estimatedSpend24hUsd: number;
  /** 0 = no operator-configured cap. */
  capUsd: number;
  reason?: 'cap_exceeded' | 'db_unavailable_failed_closed';
}

export async function checkAnthropicDailySpend(): Promise<SpendCheck> {
  const capUsd = configuredBudget('ai');
  if (capUsd === 0) return { allowed: true, estimatedSpend24hUsd: 0, capUsd };
  try {
    const result = await query<{ total_usd: string }>(
      `SELECT COALESCE(SUM(COALESCE(settled_usd, reserved_usd)), 0)::text AS total_usd
       FROM security_budget_reservations
       WHERE provider = 'ai' AND created_at > now() - interval '24 hours'`,
    );
    const total = Number(result.rows[0]?.total_usd);
    if (!Number.isFinite(total)) throw new Error('invalid_budget_total');
    return {
      allowed: total < capUsd,
      estimatedSpend24hUsd: Math.round(total * 100) / 100,
      capUsd,
      ...(total >= capUsd ? { reason: 'cap_exceeded' as const } : {}),
    };
  } catch {
    return {
      allowed: false,
      estimatedSpend24hUsd: 0,
      capUsd,
      reason: 'db_unavailable_failed_closed',
    };
  }
}
