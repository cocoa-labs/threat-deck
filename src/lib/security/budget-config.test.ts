import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkAnthropicDailySpend } from './anthropic-spend';
import { configuredBudget, parseSpendingLimit } from './budget-config';

const query = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/client', () => ({ query }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('operator-selected spending caps', () => {
  it.each([undefined, '', '  ', '0'])('allows no cap with %j', (value) => {
    expect(parseSpendingLimit(value)).toBe(0);
  });
  it.each(['NaN', '-1', 'Infinity', '50 dollars'])(
    'rejects malformed explicit caps: %s',
    (value) => {
      expect(() => parseSpendingLimit(value)).toThrow('budget_not_configured');
    },
  );
  it('has no hidden default for AI or media', async () => {
    vi.stubEnv('ANTHROPIC_DAILY_CAP_USD', undefined);
    vi.stubEnv('OUTBOUND_VISUAL_DAILY_SPEND_USD_HARD', undefined);
    expect(configuredBudget('ai')).toBe(0);
    expect(configuredBudget('media')).toBe(0);
    expect((await checkAnthropicDailySpend()).allowed).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
