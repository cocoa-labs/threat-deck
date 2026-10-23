import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { logOutbound, updateOutboundStatus } from '@/lib/email/outbound-log';
import { sendEmail } from '@/lib/email/resend';
import {
  BreachAlert,
  type BreachAlertProps,
  subject as breachSubject,
} from '@/lib/email/templates/BreachAlert';
import {
  CVEAlert,
  type CVEAlertProps,
  subject as cveSubject,
} from '@/lib/email/templates/CVEAlert';
import {
  KEVAddedAlert,
  type KEVAddedAlertProps,
  subject as kevSubject,
} from '@/lib/email/templates/KEVAddedAlert';
import { withRoutePolicy } from '@/lib/security/route-policy';
import { pickAlertWireTake } from '@/lib/voice';

/**
 * POST /api/email/alert
 *
 * Sends an immediate per-event alert email. Called by autonomous triggers
 * (see `src/lib/agent/activation.ts`) for high-severity events like
 * `critical AND is_kev` CVEs, KEV additions, or notable breaches.
 *
 * Body: `{ alertType: 'cve' | 'kev' | 'breach', entityId: string, severity?: string }`
 *
 * Auth: same as digest — `Authorization: Bearer <CRON_SECRET>` or
 * `x-cron-secret: <CRON_SECRET>`. The trigger pipeline is server-internal
 * but we still gate on the secret so this can't be abused as an open relay.
 *
 * Dedup: `aegis_outbound_log (channel=email, entity_kind=alertType, entity_id=entityId, recipient)`.
 * Re-firing the same alert is a no-op.
 *
 * Always returns 200 (fail-soft) for the work path; 401 only on bad auth.
 */

export const dynamic = 'force-dynamic';

type AlertType = 'cve' | 'kev' | 'breach';

const VALID_ALERT_TYPES: ReadonlySet<AlertType> = new Set(['cve', 'kev', 'breach']);

function parseRecipients(): string[] {
  const raw = process.env.ALERT_EMAIL_RECIPIENTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function checkCronSecret(request: Request): { ok: boolean; reason?: string } {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.warn('[email/alert] CRON_SECRET not set — accepting request without auth');
    return { ok: true };
  }
  const authHeader = request.headers.get('authorization') ?? '';
  const customHeader = request.headers.get('x-cron-secret') ?? '';
  const bearerMatch = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  if (bearerMatch === expected || customHeader === expected) {
    return { ok: true };
  }
  return { ok: false, reason: 'Invalid or missing cron secret' };
}

async function loadCveAlert(cveId: string): Promise<CVEAlertProps | null> {
  const cveResult = await query<Record<string, unknown>>(
    `SELECT c.cve_id, c.summary, c.severity, c.cvss_v3_score, c.epss_score,
            c.is_kev, c.exploited_in_wild, c.poc_public, c.published_at, c.nvd_source_url,
            k.due_date AS kev_due_date,
            k.required_action AS kev_required_action,
            (SELECT vendor FROM aegis_affected_products p WHERE p.cve_id = c.cve_id LIMIT 1) AS vendor,
            (SELECT product FROM aegis_affected_products p WHERE p.cve_id = c.cve_id LIMIT 1) AS product
       FROM aegis_cves c
       LEFT JOIN aegis_kev k ON k.cve_id = c.cve_id
       WHERE c.cve_id = $1`,
    [cveId],
  );
  if (cveResult.rows.length === 0) return null;
  const r = cveResult.rows[0]!;
  return {
    cveId: String(r.cve_id),
    summary: (r.summary as string | null) ?? null,
    severity: (r.severity as string | null) ?? null,
    cvssV3Score: r.cvss_v3_score == null ? null : Number(r.cvss_v3_score),
    epssScore: r.epss_score == null ? null : Number(r.epss_score),
    isKev: Boolean(r.is_kev),
    exploitedInWild: Boolean(r.exploited_in_wild),
    pocPublic: Boolean(r.poc_public),
    vendor: (r.vendor as string | null) ?? null,
    product: (r.product as string | null) ?? null,
    publishedAt: (r.published_at as string | null) ?? null,
    kevDueDate: (r.kev_due_date as string | null) ?? null,
    kevRequiredAction: (r.kev_required_action as string | null) ?? null,
    nvdSourceUrl: (r.nvd_source_url as string | null) ?? null,
    wireTake: pickAlertWireTake({
      kind: 'cve',
      isKev: Boolean(r.is_kev),
      exploitedInWild: Boolean(r.exploited_in_wild),
    }),
  };
}

async function loadKevAlert(cveId: string): Promise<KEVAddedAlertProps | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT k.cve_id, k.vulnerability_name, k.vendor_project, k.product,
            k.added_to_kev_at, k.due_date, k.required_action, k.short_description,
            k.known_ransomware_use
       FROM aegis_kev k
       WHERE k.cve_id = $1`,
    [cveId],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0]!;
  const kevDue = (r.due_date as string | null) ?? null;
  const kevOverdue = kevDue ? new Date(kevDue).getTime() < Date.now() : false;
  const kevRansom = String(r.known_ransomware_use ?? '').toLowerCase() === 'known';
  return {
    cveId: String(r.cve_id),
    vulnerabilityName: (r.vulnerability_name as string | null) ?? null,
    vendorProject: (r.vendor_project as string | null) ?? null,
    product: (r.product as string | null) ?? null,
    addedToKevAt: (r.added_to_kev_at as string | null) ?? null,
    dueDate: kevDue,
    requiredAction: (r.required_action as string | null) ?? null,
    shortDescription: (r.short_description as string | null) ?? null,
    knownRansomwareUse: (r.known_ransomware_use as string | null) ?? null,
    wireTake: pickAlertWireTake({ kind: 'kev', overdue: kevOverdue, knownRansomware: kevRansom }),
  };
}

async function loadBreachAlert(incidentId: string): Promise<BreachAlertProps | null> {
  // Accept either the numeric id or the string incident_id.
  const numericId = Number(incidentId);
  const isNumeric = Number.isFinite(numericId) && /^\d+$/.test(incidentId);
  const result = await query<Record<string, unknown>>(
    `SELECT i.id, i.organization, i.industry, i.country, i.incident_type,
            i.initial_access_vector, i.records_compromised, i.estimated_loss_usd,
            i.summary, i.disclosed_at,
            a.display_name AS actor_name, a.actor_type
       FROM aegis_incidents i
       LEFT JOIN aegis_threat_actors a ON a.actor_id = i.actor_id
       WHERE ${isNumeric ? 'i.id = $1' : 'i.incident_id = $1'}`,
    [isNumeric ? numericId : incidentId],
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0]!;
  const records = r.records_compromised == null ? null : Number(r.records_compromised);
  const breachRansom =
    String(r.incident_type ?? '')
      .toLowerCase()
      .includes('ransom') ||
    String(r.actor_type ?? '')
      .toLowerCase()
      .includes('ransom');
  return {
    incidentId: r.id as number,
    organization: (r.organization as string | null) ?? null,
    industry: (r.industry as string | null) ?? null,
    country: (r.country as string | null) ?? null,
    incidentType: (r.incident_type as string | null) ?? null,
    initialAccessVector: (r.initial_access_vector as string | null) ?? null,
    recordsCompromised: records,
    estimatedLossUsd: r.estimated_loss_usd == null ? null : Number(r.estimated_loss_usd),
    summary: (r.summary as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    actorType: (r.actor_type as string | null) ?? null,
    disclosedAt: (r.disclosed_at as string | null) ?? null,
    wireTake: pickAlertWireTake({
      kind: 'breach',
      recordsCompromised: records,
      knownRansomware: breachRansom,
    }),
  };
}

type AlertSendResult = {
  ok: boolean;
  sent: string[];
  failed: { recipient: string; error: string }[];
  skipped: string[];
};

async function dispatchAlert(
  alertType: AlertType,
  entityId: string,
  recipients: string[],
): Promise<AlertSendResult | { error: string }> {
  let subjectLine = '';
  let reactElement: React.ReactElement;
  let summaryText = '';

  if (alertType === 'cve') {
    const props = await loadCveAlert(entityId);
    if (!props) return { error: `CVE not found: ${entityId}` };
    subjectLine = cveSubject(props);
    reactElement = CVEAlert(props);
    summaryText = `cve=${props.cveId} sev=${props.severity ?? 'unknown'} kev=${props.isKev}`;
  } else if (alertType === 'kev') {
    const props = await loadKevAlert(entityId);
    if (!props) return { error: `KEV entry not found: ${entityId}` };
    subjectLine = kevSubject(props);
    reactElement = KEVAddedAlert(props);
    summaryText = `kev=${props.cveId} due=${props.dueDate ?? 'none'}`;
  } else {
    const props = await loadBreachAlert(entityId);
    if (!props) return { error: `Breach not found: ${entityId}` };
    subjectLine = breachSubject(props);
    reactElement = BreachAlert(props);
    summaryText = `breach=${props.incidentId} org=${props.organization ?? 'unknown'}`;
  }

  const sent: string[] = [];
  const failed: { recipient: string; error: string }[] = [];
  const skipped: string[] = [];

  for (const recipient of recipients) {
    const logResult = await logOutbound({
      channel: 'email',
      entityKind: alertType,
      entityId,
      recipient,
      status: 'queued',
      payloadSummary: summaryText,
    });

    if (!logResult.inserted) {
      skipped.push(recipient);
      continue;
    }

    const sendResult = await sendEmail({
      to: recipient,
      subject: subjectLine,
      react: reactElement,
      idempotencyKey: `${alertType}-${entityId}-${recipient}`,
      track: { source: 'alert', entityKind: alertType, entityId },
    });

    if (sendResult.ok) {
      sent.push(recipient);
      if (logResult.id != null) await updateOutboundStatus(logResult.id, 'sent');
    } else {
      failed.push({ recipient, error: sendResult.error ?? 'unknown error' });
      if (logResult.id != null) {
        await updateOutboundStatus(logResult.id, 'failed', sendResult.error);
      }
    }
  }

  return { ok: failed.length === 0, sent, failed, skipped };
}

async function routePOSTImplementation(request: Request): Promise<Response> {
  const auth = checkCronSecret(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.reason ?? 'unauthorized' }, { status: 401 });
  }

  let body: { alertType?: string; entityId?: string };
  try {
    body = (await request.json()) as { alertType?: string; entityId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' });
  }

  const alertType = body.alertType?.toLowerCase();
  const entityId = body.entityId;

  if (!alertType || !VALID_ALERT_TYPES.has(alertType as AlertType)) {
    return NextResponse.json({
      ok: false,
      error: `alertType must be one of: ${Array.from(VALID_ALERT_TYPES).join(', ')}`,
    });
  }
  if (!entityId || typeof entityId !== 'string' || entityId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'entityId is required' });
  }

  const recipients = parseRecipients();
  if (recipients.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'ALERT_EMAIL_RECIPIENTS is empty',
      sent: [],
      failed: [],
    });
  }

  try {
    const result = await dispatchAlert(alertType as AlertType, entityId, recipients);
    if ('error' in result) {
      return NextResponse.json({ ok: false, error: result.error });
    }
    return NextResponse.json({
      ok: result.ok,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email/alert] Unexpected error:', msg);
    return NextResponse.json({ ok: false, error: msg, sent: [], failed: [] });
  }
}

export const POST = withRoutePolicy('/api/email/alert', routePOSTImplementation);
