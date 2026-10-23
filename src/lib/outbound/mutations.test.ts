/**
 * Integration tests for the draft state-machine.
 *
 * Idempotency is the core invariant: two concurrent APPROVEs on the same
 * draft must resolve deterministically — first writer wins, second gets
 * `not_pending`. These tests assert that property end-to-end against the
 * real DB.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { markApproved, markPublished, markRejected, updateDraftPayload } from './mutations';

const TEST_MARKER = 'test:mutations-9.1';

async function cleanup(): Promise<void> {
  await query(`DELETE FROM aegis_outbound_drafts WHERE created_by = $1`, [TEST_MARKER]);
}

async function seedDrafted(): Promise<number> {
  const { rows } = await query<{ id: number }>(
    `INSERT INTO aegis_outbound_drafts
       (channel, draft_type, agent_mode, headline, draft_payload, status, created_by)
     VALUES ('twitter', 'breaking', 'anchor', 'test', '{"tweets":[{"text":"t"}]}'::jsonb, 'drafted', $1)
     RETURNING id`,
    [TEST_MARKER],
  );
  return Number(rows[0]!.id);
}

async function seedApproved(): Promise<number> {
  const id = await seedDrafted();
  await query(`UPDATE aegis_outbound_drafts SET status = 'approved' WHERE id = $1`, [id]);
  return id;
}

beforeEach(cleanup);
afterEach(cleanup);

describe('markApproved', () => {
  it('transitions drafted → approved + records decided_by', async () => {
    const id = await seedDrafted();
    const r = await markApproved(id, 'alice@example.org', { tweets: [{ text: 't' }] });
    expect(r).toEqual({ ok: true, status: 'approved' });

    const { rows } = await query<{ status: string; decided_by: string }>(
      `SELECT status, decided_by FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('approved');
    expect(rows[0]!.decided_by).toBe('alice@example.org');
  });

  it('second concurrent call returns not_pending (idempotent)', async () => {
    const id = await seedDrafted();
    const [first, second] = await Promise.all([
      markApproved(id, 'alice@example.org', { tweets: [{ text: 't' }] }),
      markApproved(id, 'bob@example.org', { tweets: [{ text: 't' }] }),
    ]);
    // Exactly one ok=true; the other is not_pending
    const oks = [first, second].filter((r) => r.ok);
    const fails = [first, second].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({ ok: false, reason: 'not_pending' });
  });

  it('returns not_found for nonexistent id', async () => {
    const r = await markApproved(999_999_999, 'alice@example.org', { tweets: [{ text: 't' }] });
    expect(r).toMatchObject({ ok: false, reason: 'not_found' });
  });
});

it('cannot approve a payload edited after review', async () => {
  const id = await seedDrafted();
  await updateDraftPayload(id, { tweets: [{ text: 'changed' }] }, 'bob@example.org');
  const result = await markApproved(id, 'alice@example.org', { tweets: [{ text: 't' }] });
  expect(result.ok).toBe(false);
  const state = await query<{ status: string }>(
    'SELECT status FROM aegis_outbound_drafts WHERE id=$1',
    [id],
  );
  expect(state.rows[0]?.status).toBe('edited');
});

describe('markRejected', () => {
  it('transitions drafted → rejected + persists reason', async () => {
    const id = await seedDrafted();
    const r = await markRejected(id, 'alice@example.org', 'off-voice, too promotional');
    expect(r).toEqual({ ok: true, status: 'rejected' });

    const { rows } = await query<{ rejection_reason: string }>(
      `SELECT rejection_reason FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.rejection_reason).toBe('off-voice, too promotional');
  });

  it('rejects empty reason at the helper boundary (defense in depth)', async () => {
    const id = await seedDrafted();
    const r = await markRejected(id, 'alice@example.org', '   ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/reason/);
  });

  it('returns not_pending if the draft is already terminal', async () => {
    const id = await seedApproved();
    const r = await markRejected(id, 'alice@example.org', 'too late');
    expect(r).toMatchObject({ ok: false, reason: 'not_pending' });
  });
});

describe('markPublished', () => {
  it('transitions approved → published with a real outbound_log_id (twitter path)', async () => {
    // Seed a real aegis_outbound_log row so the FK constraint is satisfied.
    const { rows: logRows } = await query<{ id: number }>(
      `INSERT INTO aegis_outbound_log
         (channel, recipient, entity_kind, entity_id, payload_summary, status)
       VALUES ('twitter', '@TestSink', 'draft', 'test-mut9.1-log', 'mutations test', 'sent')
       RETURNING id`,
    );
    const outboundLogId = logRows[0]!.id;

    try {
      const id = await seedApproved();
      const r = await markPublished(id, outboundLogId);
      expect(r).toEqual({ ok: true, status: 'published' });

      const { rows } = await query<{ status: string; outbound_log_id: number | null }>(
        `SELECT status, outbound_log_id FROM aegis_outbound_drafts WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.status).toBe('published');
      expect(rows[0]!.outbound_log_id).toBe(outboundLogId);
    } finally {
      await query(`DELETE FROM aegis_outbound_log WHERE id = $1`, [outboundLogId]);
    }
  });

  it('transitions approved → published with null outbound_log_id (rss no-op path)', async () => {
    const id = await seedApproved();
    const r = await markPublished(id, null);
    expect(r).toEqual({ ok: true, status: 'published' });
    const { rows } = await query<{ outbound_log_id: number | null }>(
      `SELECT outbound_log_id FROM aegis_outbound_drafts WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.outbound_log_id).toBeNull();
  });

  it('rejects publish from a non-approved status', async () => {
    const id = await seedDrafted();
    const r = await markPublished(id, null);
    expect(r).toMatchObject({ ok: false, reason: 'not_pending' });
  });
});

describe('updateDraftPayload', () => {
  const edited = {
    tweets: [{ text: 'Edited masthead #AICyber' }, { text: 'Edited closing 🧵 2/2' }],
    canonicalHashtag: '#AICyber',
  };

  it('replaces the payload, refreshes preview_text, and flips to edited', async () => {
    const id = await seedDrafted();
    const r = await updateDraftPayload(id, edited, 'alice@example.org');
    expect(r).toEqual({ ok: true, status: 'edited' });

    const { rows } = await query<{
      status: string;
      preview_text: string;
      draft_payload: { tweets: { text: string }[] };
    }>(`SELECT status, preview_text, draft_payload FROM aegis_outbound_drafts WHERE id = $1`, [id]);
    expect(rows[0]!.status).toBe('edited');
    expect(rows[0]!.preview_text).toBe('Edited masthead #AICyber');
    expect(rows[0]!.draft_payload.tweets).toHaveLength(2);
  });

  it('can edit an already-edited draft again (still pending)', async () => {
    const id = await seedDrafted();
    await updateDraftPayload(id, edited, 'alice@example.org');
    const r = await updateDraftPayload(id, edited, 'bob@example.org');
    expect(r).toEqual({ ok: true, status: 'edited' });
  });

  it('refuses to edit a terminal (approved) draft', async () => {
    const id = await seedApproved();
    const r = await updateDraftPayload(id, edited, 'alice@example.org');
    expect(r).toMatchObject({ ok: false, reason: 'not_pending' });
  });

  it('returns not_found for a nonexistent id', async () => {
    const r = await updateDraftPayload(999_999_999, edited, 'alice@example.org');
    expect(r).toMatchObject({ ok: false, reason: 'not_found' });
  });
});
