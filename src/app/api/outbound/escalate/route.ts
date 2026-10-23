import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST / GET /api/outbound/escalate
 *
 * Vercel cron entry every 30 minutes. Sweeps `aegis_outbound_drafts` for
 * pending CRITICAL drafts older than 2 hours and pings
 * `ALERT_EMAIL_RECIPIENTS` with an EscalationAlert email per draft.
 *
 * Dedup: the existing `aegis_outbound_log` UNIQUE constraint on
 * `(channel, entity_kind, entity_id, recipient)` is the at-most-once
 * guarantee. Keyed `(channel='email', entity_kind='draft_escalation',
 * entity_id=<draftId>, recipient)`. A second cron tick re-runs the same
 * INSERT and the conflict is the no-op signal that this draft has
 * already been escalated to this recipient.
 *
 * Auth: same `CRON_SECRET` pattern as the other crons.
 */

import { NextResponse } from 'next/server';
import { AUDIT_ACTIONS, auditDenied, auditSuccess } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { logOutbound } from '@/lib/email/outbound-log';
import { sendEmail } from '@/lib/email/resend';
import {
  EscalationAlert,
  type EscalationAlertProps,
  subject as escalationSubject,
} from '@/lib/email/templates/EscalationAlert';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import { checkCronSecret } from '../../twitter/_cron-secret';

export const dynamic = 'force-dynamic';

/** Drafts age past this threshold (in minutes) trigger escalation. */
const STALENESS_THRESHOLD_MINUTES = 120;

function parseRecipients(): string[] {
  const raw = process.env.ALERT_EMAIL_RECIPIENTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface StaleDraftRow {
  id: number;
  channel: string;
  draft_type: string;
  headline: string;
  preview_text: string | null;
  age_seconds: number | string;
  ai_relevance: string | null;
  source_alert_id: number | null;
}

async function findStaleCriticalDrafts(): Promise<StaleDraftRow[]> {
  // Pull from the v_pending_drafts view (only drafted/edited rows) where
  // severity='critical' and age exceeds threshold.
  const { rows } = await query<StaleDraftRow>(
    `SELECT id, channel, draft_type, headline, preview_text, age_seconds,
            ai_relevance, source_alert_id
       FROM aegis_v_pending_drafts
      WHERE severity = 'critical'
        AND age_seconds >= $1
      ORDER BY age_seconds DESC
      LIMIT 50`,
    [STALENESS_THRESHOLD_MINUTES * 60],
  );
  return rows;
}

interface EscalationOutcome {
  draftId: number;
  recipients: string[];
  sent: string[];
  skippedDedup: string[];
  failed: { recipient: string; error: string }[];
}

async function escalateOne(row: StaleDraftRow, recipients: string[]): Promise<EscalationOutcome> {
  const ageHours = Number(row.age_seconds) / 3600;
  const aiRelevance = row.ai_relevance == null ? null : Number(row.ai_relevance);

  const props: EscalationAlertProps = {
    draftId: row.id,
    channel: row.channel,
    draftType: row.draft_type,
    headline: row.headline,
    previewText: row.preview_text,
    ageHours,
    aiRelevance,
    sourceUrl: null,
  };

  const outcome: EscalationOutcome = {
    draftId: row.id,
    recipients,
    sent: [],
    skippedDedup: [],
    failed: [],
  };

  for (const recipient of recipients) {
    // At-most-once dedup. Pre-insert a queued log row; if the UNIQUE
    // constraint fires we know this draft has already been escalated to
    // this recipient and we skip cleanly.
    const logResult = await logOutbound({
      channel: 'email',
      recipient,
      entityKind: 'draft_escalation',
      entityId: String(row.id),
      payloadSummary: row.headline.slice(0, 200),
    });
    if (!logResult.inserted) {
      outcome.skippedDedup.push(recipient);
      continue;
    }

    const sendResult = await sendEmail({
      to: recipient,
      subject: escalationSubject(props),
      react: EscalationAlert(props),
      track: { source: 'escalation', entityKind: 'draft_escalation', entityId: String(row.id) },
    });
    if (sendResult.ok) {
      outcome.sent.push(recipient);
    } else {
      outcome.failed.push({
        recipient,
        error: sendResult.error ?? 'unknown',
      });
    }
  }

  return outcome;
}

async function handle(request: Request): Promise<Response> {
  const actorIp = getClientIp(request);
  const actorUa = request.headers.get('user-agent');

  const auth = checkCronSecret(request);
  if (!auth.ok) {
    void auditDenied(AUDIT_ACTIONS.OUTBOUND_DRAFT_STALE_ESCALATED, auth.reason ?? 'unauthorized', {
      actorId: 'cron:escalate',
      actorIp,
      actorUa,
      targetKind: 'outbound_draft',
    });
    return NextResponse.json({ ok: false, error: auth.reason ?? 'unauthorized' }, { status: 401 });
  }

  const recipients = parseRecipients();
  if (recipients.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'ALERT_EMAIL_RECIPIENTS is empty',
      escalated: 0,
    });
  }

  const stale = await findStaleCriticalDrafts();
  if (stale.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, escalated: 0, outcomes: [] });
  }

  const outcomes: EscalationOutcome[] = [];
  for (const row of stale) {
    outcomes.push(await escalateOne(row, recipients));
  }

  const totalSent = outcomes.reduce((sum, o) => sum + o.sent.length, 0);

  // One rollup audit per cron tick. Per-draft + per-recipient detail
  // already lives in `aegis_outbound_log` for traceability.
  void auditSuccess(AUDIT_ACTIONS.OUTBOUND_DRAFT_STALE_ESCALATED, {
    actorId: 'cron:escalate',
    actorIp,
    actorUa,
    targetKind: 'outbound_draft',
    details: {
      scanned: stale.length,
      escalated: outcomes.filter((o) => o.sent.length > 0).length,
      sent: totalSent,
      skippedDedup: outcomes.reduce((sum, o) => sum + o.skippedDedup.length, 0),
      failed: outcomes.reduce((sum, o) => sum + o.failed.length, 0),
    },
  });

  return NextResponse.json({
    ok: true,
    scanned: stale.length,
    escalated: outcomes.filter((o) => o.sent.length > 0).length,
    sent: totalSent,
    outcomes,
  });
}

const limitedHandle = withRateLimit(handle, {
  key: 'outbound-escalate:global',
  limit: 4,
  windowMs: 60 * 60_000, // Cron fires 2/hr; allow some headroom for manual reruns
});

async function routePOSTImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

async function routeGETImplementation(request: Request): Promise<Response> {
  return limitedHandle(request);
}

export const POST = withRoutePolicy('/api/outbound/escalate', routePOSTImplementation);
export const GET = withRoutePolicy('/api/outbound/escalate', routeGETImplementation);
