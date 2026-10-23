import { query } from '@/lib/db/client';

/**
 * Atomic dedup for outbound channels (email / rss / twitter / toast).
 *
 * Backed by `aegis_outbound_log` (UNIQUE on `(channel, entity_kind, entity_id, recipient)`).
 * The intended flow is: try to INSERT first — if the row goes in, you own the send
 * and should call Resend. If a unique-violation is raised, another worker already
 * sent it and you should bail. This makes dedup atomic without a separate read.
 */

export type OutboundChannel = 'email' | 'rss' | 'twitter' | 'toast';
export type OutboundStatus = 'queued' | 'sent' | 'failed';

export type LogOutboundInput = {
  channel: OutboundChannel;
  /** "cve" / "incident" / "advisory" / "ioc" / "digest" */
  entityKind: string;
  /** The unique id for the entity in its kind — for digests use "digest-YYYY-MM-DD". */
  entityId: string;
  recipient: string;
  status?: OutboundStatus;
  payloadSummary?: string;
};

export type LogOutboundResult = {
  inserted: boolean;
  id?: number;
  error?: string;
};

/**
 * Attempt to insert an outbound log row. Returns `{ inserted: true }` on success,
 * `{ inserted: false }` if the unique constraint blocked it (already sent), or
 * `{ inserted: false, error }` on any other DB failure (caller should treat as
 * non-fatal — never block sends on logging).
 */
export async function logOutbound(input: LogOutboundInput): Promise<LogOutboundResult> {
  const status: OutboundStatus = input.status ?? 'queued';
  try {
    const result = await query<{ id: number }>(
      // Phase 13.011 migrated aegis_outbound_log.sent_at from TEXT to
      // TIMESTAMPTZ. Use NOW() directly (was TO_CHAR(NOW(), 'YYYY-MM-DD HH24:MI:SS'));
      // the pre-migration TEXT cast silently failed the INSERT and returned
      // 0 rows, which callers interpret as "already sent" — broke the
      // /api/email/alert pipeline AND the Phase 13 Tier 5 /api/outbound/email-me
      // route until this was fixed.
      `INSERT INTO aegis_outbound_log
        (channel, entity_kind, entity_id, recipient, payload_summary, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (channel, entity_kind, entity_id, recipient) DO NOTHING
       RETURNING id`,
      [
        input.channel,
        input.entityKind,
        input.entityId,
        input.recipient,
        input.payloadSummary ?? null,
        status,
      ],
    );

    const inserted = result.rows.length > 0;
    if (inserted && result.rows[0]) {
      return { inserted: true, id: result.rows[0].id };
    }
    return { inserted: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email/outbound-log] Insert failed:', msg);
    return { inserted: false, error: msg };
  }
}

export type ClaimOutboundResult =
  | { state: 'claimed'; id: number }
  | { state: 'alreadySent' }
  | { state: 'error'; error: string };

/**
 * Like `logOutbound`, but re-claimable: a prior row only blocks the send when
 * its status is already `'sent'`. Rows left in `'queued'` / `'failed'` (e.g. a
 * previous attempt that errored mid-flight) are re-claimed so the caller can
 * retry. This fixes "dedup poisoning" where a failed send permanently masked a
 * recipient as `alreadySent` even though nothing was ever delivered.
 *
 * Returns `'claimed'` (caller owns the send), `'alreadySent'` (a confirmed
 * prior success exists — do NOT resend), or `'error'` (DB failure — caller
 * should treat as non-fatal and proceed best-effort without an audit row).
 */
export async function claimOutbound(input: LogOutboundInput): Promise<ClaimOutboundResult> {
  try {
    const result = await query<{ id: number }>(
      `INSERT INTO aegis_outbound_log
        (channel, entity_kind, entity_id, recipient, payload_summary, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'queued', NOW())
       ON CONFLICT (channel, entity_kind, entity_id, recipient)
       DO UPDATE SET status = 'queued',
                     payload_summary = EXCLUDED.payload_summary,
                     sent_at = NOW()
         WHERE aegis_outbound_log.status <> 'sent'
       RETURNING id`,
      [
        input.channel,
        input.entityKind,
        input.entityId,
        input.recipient,
        input.payloadSummary ?? null,
      ],
    );
    const row = result.rows[0];
    // No row returned means the ON CONFLICT WHERE excluded an already-'sent'
    // row — a genuine prior success.
    if (row) return { state: 'claimed', id: row.id };
    return { state: 'alreadySent' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email/outbound-log] Claim failed:', msg);
    return { state: 'error', error: msg };
  }
}

/**
 * Check if a row already exists in `aegis_outbound_log` for this combination.
 * Useful for read-only checks where you don't want to claim the slot.
 */
export async function wasAlreadySent(input: {
  channel: OutboundChannel;
  entityKind: string;
  entityId: string;
  recipient: string;
}): Promise<boolean> {
  try {
    const result = await query<{ id: number }>(
      `SELECT id FROM aegis_outbound_log
       WHERE channel = $1 AND entity_kind = $2 AND entity_id = $3 AND recipient = $4
       LIMIT 1`,
      [input.channel, input.entityKind, input.entityId, input.recipient],
    );
    return result.rows.length > 0;
  } catch (err) {
    console.error('[email/outbound-log] Lookup failed:', err);
    return false;
  }
}

/**
 * Update the status of a previously-inserted log row, e.g. after Resend returns
 * a success/failure. Best-effort — failures are logged but never thrown.
 */
export async function updateOutboundStatus(
  id: number,
  status: OutboundStatus,
  errorMessage?: string,
): Promise<void> {
  try {
    await query(
      // Phase 13.011 migration — sent_at is TIMESTAMPTZ. Use NOW() directly.
      `UPDATE aegis_outbound_log
       SET status = $1,
           error_message = $2,
           sent_at = NOW()
       WHERE id = $3`,
      [status, errorMessage ?? null, id],
    );
  } catch (err) {
    console.error('[email/outbound-log] Status update failed:', err);
  }
}
