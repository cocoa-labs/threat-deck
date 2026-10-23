export type BudgetProvider = 'ai' | 'media';

/** Spending limits belong to the operator. Unset, blank, or zero means no cap. */
export function parseSpendingLimit(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error('budget_not_configured');
  return value;
}

export function configuredBudget(provider: BudgetProvider): number {
  return parseSpendingLimit(
    provider === 'ai'
      ? process.env.ANTHROPIC_DAILY_CAP_USD
      : process.env.OUTBOUND_VISUAL_DAILY_SPEND_USD_HARD,
  );
}
