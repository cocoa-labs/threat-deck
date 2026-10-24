import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/security/budget');

import { db } from '@/lib/db/client';
import { reserveBudget } from './budget';

beforeEach(async () => {
  vi.stubEnv('ENABLE_AI', 'true');
  vi.stubEnv('ANTHROPIC_DAILY_CAP_USD', '5');
  await db.query('DELETE FROM security_budget_reservations');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await db.query('DELETE FROM security_budget_reservations');
});
describe('atomic provider admission and settlement', () => {
  it('cannot exceed an opted-in cap under concurrent calls', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => reserveBudget('ai', 2)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const result of results) if (result.status === 'fulfilled') await result.value(0.5);
    // Both completed requests cost $1 total, not their $4 admission estimate.
    const next = await Promise.allSettled(Array.from({ length: 12 }, () => reserveBudget('ai', 2)));
    expect(next.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    await expect(reserveBudget('ai', 0.01)).rejects.toThrow('budget_exceeded');
    for (const result of next) if (result.status === 'fulfilled') await result.value(0);
    const totals = await db.query(
      'SELECT SUM(COALESCE(settled_usd, reserved_usd))::float AS total FROM security_budget_reservations',
    );
    expect(totals.rows[0].total).toBe(1);
  });
  it('retains an unknown charge and cannot settle the same request twice', async () => {
    const release = await reserveBudget('ai', 4);
    await release();
    await release(0);
    await expect(reserveBudget('ai', 2)).rejects.toThrow('budget_exceeded');
  });
  it('returns unused allowance after a confirmed rejection', async () => {
    for (let i = 0; i < 8; i++) await (await reserveBudget('ai', 5))(0);
    const next = await reserveBudget('ai', 5);
    await next(2);
    await next(0);
    await expect(reserveBudget('ai', 4)).rejects.toThrow('budget_exceeded');
  });
  it.each([undefined, '', '0'])(
    'does not impose a daily cap when configured as %j',
    async (value) => {
      vi.stubEnv('ANTHROPIC_DAILY_CAP_USD', value);
      for (let i = 0; i < 6; i++) await (await reserveBudget('ai', 1000))(100);
    },
  );
  it('caps simultaneous calls independently of an optional spending cap', async () => {
    vi.stubEnv('ANTHROPIC_DAILY_CAP_USD', '0');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveBudget('ai', 1)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    for (const result of results) if (result.status === 'fulfilled') await result.value(0);
    await (await reserveBudget('ai', 1))(0);
  });
});
