import { query } from '@/lib/db/client';
import { type DigestProse, generateDigestProse } from '@/lib/voice/digest-prose';
import { logOutbound, updateOutboundStatus } from './outbound-log';
import { sendEmail } from './resend';
import {
  DailyDigest,
  type DailyDigestProps,
  type DigestBreachItem,
  type DigestCveItem,
  type DigestKevItem,
  subject as digestSubject,
} from './templates/DailyDigest';

/**
 * Build + send the Cocoa AI Threat Deck daily digest.
 *
 * `buildDailyDigest()` pulls the headline items (top 5 critical CVEs in the
 * last 24h, top 3 newly-added KEV entries, top 3 recent breaches) and shapes
 * them into a `DailyDigestProps` for the template.
 *
 * `sendDailyDigest(recipients)` builds once, then loops per recipient with
 * `aegis_outbound_log` dedup (entity_id = `digest-YYYY-MM-DD`). Idempotent
 * within a 24h window — re-invoking on the same date is a no-op for
 * already-sent recipients.
 *
 * Note: `aegis_cves.published_at` is stored as ISO date TEXT (e.g. '2024-03-29'),
 * so date filtering uses string comparison against a formatted threshold. The
 * `INTERVAL` math happens in Postgres via `TO_CHAR(NOW() - INTERVAL '24 hours', ...)`.
 */

const DATE_FMT_ISO = 'YYYY-MM-DD';

export type DailyDigestData = {
  dateLabel: string;
  isoDate: string;
  cves: DigestCveItem[];
  kevAdds: DigestKevItem[];
  breaches: DigestBreachItem[];
  /** Voiced masthead prose (hero + takeaway), fail-soft to deterministic. */
  prose: DigestProse;
};

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function humanDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function fetchTopCves(): Promise<DigestCveItem[]> {
  const sql = `
    SELECT
      c.cve_id,
      c.summary,
      c.severity,
      c.cvss_v3_score,
      c.is_kev,
      c.exploited_in_wild,
      c.published_at,
      (SELECT vendor FROM aegis_affected_products p WHERE p.cve_id = c.cve_id LIMIT 1) AS vendor,
      (SELECT product FROM aegis_affected_products p WHERE p.cve_id = c.cve_id LIMIT 1) AS product
    FROM aegis_cves c
    WHERE c.severity = 'critical'
      AND c.published_at >= TO_CHAR(NOW() - INTERVAL '24 hours', '${DATE_FMT_ISO}')
    ORDER BY c.cvss_v3_score DESC NULLS LAST, c.published_at DESC
    LIMIT 5
  `;
  try {
    const result = await query<Record<string, unknown>>(sql);
    return result.rows.map((r) => ({
      cveId: String(r.cve_id),
      summary: (r.summary as string | null) ?? null,
      severity: (r.severity as string | null) ?? null,
      cvssV3Score: r.cvss_v3_score == null ? null : Number(r.cvss_v3_score),
      isKev: Boolean(r.is_kev),
      exploitedInWild: Boolean(r.exploited_in_wild),
      vendor: (r.vendor as string | null) ?? null,
      product: (r.product as string | null) ?? null,
      publishedAt: (r.published_at as string | null) ?? null,
    }));
  } catch (err) {
    console.error('[email/digest] CVE query failed:', err);
    return [];
  }
}

async function fetchTopKev(): Promise<DigestKevItem[]> {
  const sql = `
    SELECT
      k.cve_id,
      k.vulnerability_name,
      k.vendor_project,
      k.product,
      k.due_date,
      k.added_to_kev_at
    FROM aegis_kev k
    WHERE k.added_to_kev_at >= TO_CHAR(NOW() - INTERVAL '24 hours', '${DATE_FMT_ISO}')
    ORDER BY k.added_to_kev_at DESC
    LIMIT 3
  `;
  try {
    const result = await query<Record<string, unknown>>(sql);
    return result.rows.map((r) => ({
      cveId: String(r.cve_id),
      vulnerabilityName: (r.vulnerability_name as string | null) ?? null,
      vendorProject: (r.vendor_project as string | null) ?? null,
      product: (r.product as string | null) ?? null,
      dueDate: (r.due_date as string | null) ?? null,
      addedToKevAt: (r.added_to_kev_at as string | null) ?? null,
    }));
  } catch (err) {
    console.error('[email/digest] KEV query failed:', err);
    return [];
  }
}

async function fetchTopBreaches(): Promise<DigestBreachItem[]> {
  const sql = `
    SELECT
      i.id,
      i.organization,
      i.industry,
      i.incident_type,
      i.records_compromised,
      i.disclosed_at,
      a.display_name AS actor_name
    FROM aegis_incidents i
    LEFT JOIN aegis_threat_actors a ON a.actor_id = i.actor_id
    WHERE i.disclosed_at >= TO_CHAR(NOW() - INTERVAL '24 hours', '${DATE_FMT_ISO}')
    ORDER BY i.records_compromised DESC NULLS LAST, i.disclosed_at DESC
    LIMIT 3
  `;
  try {
    const result = await query<Record<string, unknown>>(sql);
    return result.rows.map((r) => ({
      incidentId: r.id as number,
      organization: (r.organization as string | null) ?? null,
      industry: (r.industry as string | null) ?? null,
      incidentType: (r.incident_type as string | null) ?? null,
      recordsCompromised: r.records_compromised == null ? null : Number(r.records_compromised),
      actorName: (r.actor_name as string | null) ?? null,
      disclosedAt: (r.disclosed_at as string | null) ?? null,
    }));
  } catch (err) {
    console.error('[email/digest] Breach query failed:', err);
    return [];
  }
}

export async function buildDailyDigest(): Promise<DailyDigestData> {
  const isoDate = todayIsoDate();
  const [cves, kevAdds, breaches] = await Promise.all([
    fetchTopCves(),
    fetchTopKev(),
    fetchTopBreaches(),
  ]);
  const dateLabel = humanDateLabel(isoDate);
  // ONE voiced-prose call per digest (amortized across recipients). Fail-soft:
  // returns an empty hero + deterministic takeaway if the LLM is unavailable.
  const prose = await generateDigestProse({ dateLabel, cves, kevAdds, breaches });
  return {
    dateLabel,
    isoDate,
    cves,
    kevAdds,
    breaches,
    prose,
  };
}

export type SendDigestResult = {
  ok: boolean;
  sent: string[];
  failed: { recipient: string; error: string }[];
  skipped: string[];
  error?: string;
};

export async function sendDailyDigest(recipients: string[]): Promise<SendDigestResult> {
  if (recipients.length === 0) {
    return { ok: false, sent: [], failed: [], skipped: [], error: 'No recipients configured' };
  }

  const digest = await buildDailyDigest();
  const props: DailyDigestProps = {
    dateLabel: digest.dateLabel,
    cves: digest.cves,
    kevAdds: digest.kevAdds,
    breaches: digest.breaches,
    prose: digest.prose,
  };
  const subjectLine = digestSubject(props);
  const summaryText = `cves=${digest.cves.length} kev=${digest.kevAdds.length} breaches=${digest.breaches.length}`;

  const sent: string[] = [];
  const failed: { recipient: string; error: string }[] = [];
  const skipped: string[] = [];

  for (const recipient of recipients) {
    const entityId = `digest-${digest.isoDate}`;
    const logResult = await logOutbound({
      channel: 'email',
      entityKind: 'digest',
      entityId,
      recipient,
      status: 'queued',
      payloadSummary: summaryText,
    });

    if (!logResult.inserted) {
      // Already sent today (unique violation) — skip without contacting Resend.
      skipped.push(recipient);
      continue;
    }

    const sendResult = await sendEmail({
      to: recipient,
      subject: subjectLine,
      react: DailyDigest(props),
      idempotencyKey: `${entityId}-${recipient}`,
      track: { source: 'digest', entityKind: 'digest', entityId },
    });

    if (sendResult.ok) {
      sent.push(recipient);
      if (logResult.id != null) {
        await updateOutboundStatus(logResult.id, 'sent');
      }
    } else {
      failed.push({ recipient, error: sendResult.error ?? 'unknown error' });
      if (logResult.id != null) {
        await updateOutboundStatus(logResult.id, 'failed', sendResult.error);
      }
    }
  }

  return {
    ok: failed.length === 0,
    sent,
    failed,
    skipped,
  };
}
