import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('@/lib/security/budget');

import { db } from '@/lib/db/client';
import { reserveBudget } from './budget';

beforeEach(async () => {
  vi.stubEnv('ENABLE_AI', 'true');
  vi.stubEnv('ANTHROPIC_DAILY_CAP_USD', '5');
  await db.query('DELETE FROM security_budget_reservations');
});
afterAll(async () => {
  await db.query('DELETE FROM security_budget_reservations');
});
describe('atomic provider admission', () => {
  it('cannot overspend under concurrent calls', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => reserveBudget('ai', 2)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const result of results) if (result.status === 'fulfilled') await result.value();
    const totals = await db.query(
      'SELECT SUM(reserved_usd)::float AS total FROM security_budget_reservations',
    );
    expect(totals.rows[0].total).toBe(4);
    await expect(reserveBudget('ai', 2)).rejects.toThrow('budget_exceeded');
  });
  it('caps concurrent admitted calls independently of spend', async () => {
    vi.stubEnv('ANTHROPIC_DAILY_CAP_USD', '100');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveBudget('ai', 1)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    for (const result of results) if (result.status === 'fulfilled') await result.value();
  });
});
