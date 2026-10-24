/**
 * Daily spend cap for visual generation (Phase 14 Tier A).
 *
 * Mirrors src/lib/security/anthropic-spend.ts pattern:
 *   - Reads SUM(cost_usd) from aegis_generated_media for last 24h
 *   - Compares to two thresholds: warn + hard-block
 *   - Returns allowed=false only when hard cap exceeded
 *   - Fails closed on DB unavailable; atomic reservation admission is in budget.ts
 */

import { query } from '@/lib/db/client';
import { configuredBudget, parseSpendingLimit } from './budget-config';

export interface VisualSpendCheck {
  allowed: boolean;
  estimatedSpend24hUsd: number;
  warnCapUsd: number;
  hardCapUsd: number;
  warningTriggered: boolean;
  reason?: 'warn_threshold_exceeded' | 'hard_cap_exceeded' | 'db_unavailable_failed_closed';
}

export async function checkOutboundVisualSpend(): Promise<VisualSpendCheck> {
  const warnCapUsd = parseSpendingLimit(process.env.OUTBOUND_VISUAL_DAILY_SPEND_USD);
  const hardCapUsd = configuredBudget('media');

  // Both caps zero = guard disabled
  if (warnCapUsd === 0 && hardCapUsd === 0) {
    return {
      allowed: true,
      estimatedSpend24hUsd: 0,
      warnCapUsd: 0,
      hardCapUsd: 0,
      warningTriggered: false,
    };
  }

  let totalUsd = 0;
  try {
    // 'pending' counts too. Video books its estimate at INSERT precisely so it
    // hits this cap, but a render takes 1-3 minutes — excluding pending meant a
    // burst of starts all read the same pre-burst total and sailed past the cap
    // together. Money committed is money spent.
    const result = await query<{ total_usd: string | number | null }>(`
      SELECT COALESCE(SUM(cost_usd), 0)::text AS total_usd
      FROM aegis_generated_media
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND status IN ('pending', 'ready', 'published', 'failed')
    `);
    const raw = result.rows[0]?.total_usd;
    totalUsd = raw == null ? 0 : Number(raw);
    if (!Number.isFinite(totalUsd)) totalUsd = 0;
  } catch (err) {
    console.warn(
      '[visual-spend] DB unavailable, denying generation:',
      err instanceof Error ? err.message : String(err),
    );
    return {
      allowed: false,
      estimatedSpend24hUsd: 0,
      warnCapUsd,
      hardCapUsd,
      warningTriggered: false,
      reason: 'db_unavailable_failed_closed',
    };
  }

  if (hardCapUsd > 0 && totalUsd >= hardCapUsd) {
    return {
      allowed: false,
      estimatedSpend24hUsd: totalUsd,
      warnCapUsd,
      hardCapUsd,
      warningTriggered: true,
      reason: 'hard_cap_exceeded',
    };
  }

  if (warnCapUsd > 0 && totalUsd >= warnCapUsd) {
    return {
      allowed: true,
      estimatedSpend24hUsd: totalUsd,
      warnCapUsd,
      hardCapUsd,
      warningTriggered: true,
      reason: 'warn_threshold_exceeded',
    };
  }

  return {
    allowed: true,
    estimatedSpend24hUsd: totalUsd,
    warnCapUsd,
    hardCapUsd,
    warningTriggered: false,
  };
}
