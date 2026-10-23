/**
 * Integration tests for the read-side draft helpers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { getDraft, lastDecidedAt, listAllDrafts, listPendingDrafts } from './drafts';

const TEST_MARKER = 'test:drafts-9.1';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

interface SeedOpts {
  status: 'drafted' | 'edited' | 'approved' | 'rejected' | 'published';
  headline?: string;
  channel?: 'twitter' | 'email' | 'rss';
  severity?: string;
  aiRelevance?: number;
  decidedAt?: 'now' | 'past' | null;
}

async function seedDraft(opts: SeedOpts): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_outbound_drafts
       (channel, draft_type, agent_mode, headline, draft_payload, status,
        created_by, severity, ai_relevance, decided_at, decided_by)
     VALUES ($1, 'breaking', 'anchor', $2, '{"tweets":[{"text":"t"}]}'::jsonb, $3,
             $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      opts.channel ?? 'twitter',
      opts.headline ?? 'test draft',
      opts.status,
      TEST_MARKER,
      opts.severity ?? null,
      opts.aiRelevance ?? null,
      opts.decidedAt === 'now'
        ? new Date()
        : opts.decidedAt === 'past'
          ? new Date(Date.now() - 7_200_000)
          : null,
      opts.decidedAt ? 'reviewer@example.org' : null,
    ],
  );
  return Number(rows[0]!.id);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('listPendingDrafts', () => {
  it('returns drafted and edited rows only', async () => {
    await seedDraft({ status: 'drafted', headline: 'p1' });
    await seedDraft({ status: 'edited', headline: 'p2' });
    await seedDraft({ status: 'approved', headline: 'p3' });
    await seedDraft({ status: 'rejected', headline: 'p4' });
    await seedDraft({ status: 'published', headline: 'p5' });

    const list = await listPendingDrafts();
    const headlines = list.filter((d) => d.createdBy === TEST_MARKER).map((d) => d.headline);
    expect(headlines).toContain('p1');
    expect(headlines).toContain('p2');
    expect(headlines).not.toContain('p3');
    expect(headlines).not.toContain('p4');
    expect(headlines).not.toContain('p5');
  });

  it('honors the channel filter', async () => {
    await seedDraft({ status: 'drafted', channel: 'twitter', headline: 'tw' });
    await seedDraft({ status: 'drafted', channel: 'email', headline: 'em' });

    const onlyTwitter = await listPendingDrafts({ channel: 'twitter' });
    const headlines = onlyTwitter.filter((d) => d.createdBy === TEST_MARKER).map((d) => d.headline);
    expect(headlines).toContain('tw');
    expect(headlines).not.toContain('em');
  });

  it('caps limit to a sensible range', async () => {
    await seedDraft({ status: 'drafted', headline: 'a' });
    // Pass an absurd limit; helper should clamp internally to ≤100
    const list = await listPendingDrafts({ limit: 99_999 });
    expect(list.length).toBeLessThanOrEqual(100);
  });
});

describe('listAllDrafts', () => {
  it('returns rows of any status', async () => {
    await seedDraft({ status: 'drafted', headline: 'a1' });
    await seedDraft({ status: 'approved', headline: 'a2' });
    await seedDraft({ status: 'rejected', headline: 'a3' });
    const list = await listAllDrafts();
    const headlines = list.filter((d) => d.createdBy === TEST_MARKER).map((d) => d.headline);
    expect(headlines).toContain('a1');
    expect(headlines).toContain('a2');
    expect(headlines).toContain('a3');
  });
});

describe('getDraft', () => {
  it('returns null for nonexistent id', async () => {
    const r = await getDraft(999_999_999);
    expect(r).toBeNull();
  });

  it('returns the full draft including payload + status', async () => {
    const id = await seedDraft({ status: 'drafted', headline: 'detail', aiRelevance: 0.77 });
    const r = await getDraft(id);
    expect(r).toBeTruthy();
    expect(r!.id).toBe(id);
    expect(r!.headline).toBe('detail');
    expect(r!.status).toBe('drafted');
    expect(r!.aiRelevance).toBe(0.77);
    expect(r!.draftPayload).toMatchObject({ tweets: [{ text: 't' }] });
  });
});

describe('lastDecidedAt', () => {
  it('returns the most recent decided_at across the table', async () => {
    await seedDraft({ status: 'rejected', decidedAt: 'past', headline: 'old' });
    await seedDraft({ status: 'approved', decidedAt: 'now', headline: 'new' });
    const ts = await lastDecidedAt();
    expect(ts).toBeTruthy();
    // The 'now' row is < 1s old
    if (ts) {
      const age = Date.now() - new Date(ts).getTime();
      expect(age).toBeLessThan(10_000);
    }
  });
});
