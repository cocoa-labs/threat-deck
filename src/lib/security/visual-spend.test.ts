import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  query: vi.fn(),
}));

import { query } from '@/lib/db/client';
import { checkOutboundVisualSpend } from './visual-spend';

describe('checkOutboundVisualSpend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OUTBOUND_VISUAL_DAILY_SPEND_USD = '15';
    process.env.OUTBOUND_VISUAL_DAILY_SPEND_USD_HARD = '25';
  });

  it('allows when spend is below warn threshold', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total_usd: '3.50' }], rowCount: 1 } as never);

    const result = await checkOutboundVisualSpend();
    expect(result.allowed).toBe(true);
    expect(result.estimatedSpend24hUsd).toBeCloseTo(3.5);
    expect(result.warnCapUsd).toBe(15);
    expect(result.hardCapUsd).toBe(25);
    expect(result.warningTriggered).toBe(false);
  });

  it('allows but warns when spend is between warn and hard thresholds', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ total_usd: '17.25' }],
      rowCount: 1,
    } as never);

    const result = await checkOutboundVisualSpend();
    expect(result.allowed).toBe(true);
    expect(result.warningTriggered).toBe(true);
    expect(result.reason).toBe('warn_threshold_exceeded');
  });

  it('blocks when spend exceeds hard cap', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ total_usd: '27.00' }],
      rowCount: 1,
    } as never);

    const result = await checkOutboundVisualSpend();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hard_cap_exceeded');
  });

  it('handles zero spend (no rows in last 24h)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ total_usd: null }], rowCount: 1 } as never);

    const result = await checkOutboundVisualSpend();
    expect(result.allowed).toBe(true);
    expect(result.estimatedSpend24hUsd).toBe(0);
  });

  it('fails closed on DB error', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('postgres unavailable'));

    const result = await checkOutboundVisualSpend();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('db_unavailable_failed_closed');
  });

  it('denies spending when both caps are 0', async () => {
    process.env.OUTBOUND_VISUAL_DAILY_SPEND_USD = '0';
    process.env.OUTBOUND_VISUAL_DAILY_SPEND_USD_HARD = '0';

    const result = await checkOutboundVisualSpend();
    expect(result.allowed).toBe(false);
    expect(result.warnCapUsd).toBe(0);
    expect(result.hardCapUsd).toBe(0);
  });
});
