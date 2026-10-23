import { emitSeverityEvent } from '@/lib/aegis/severity-history-emitter';
import { deriveSourceUrl } from '@/lib/aegis/source-url';
import { insertPipelineAlert, updatePipelineAlert } from '@/lib/db/queries/pipeline-alerts';
import type { AgentContext } from '@/lib/types';
import { broadcast } from '@/lib/ws/server';
import type { ActivationTrigger, AgentResult } from './types';

/**
 * Event-driven activation engine.
 * Evaluates incoming events against threshold rules to determine
 * if the agent should be triggered.
 */

/** Cooldown tracking to prevent trigger spam */
const triggerCooldowns = new Map<string, number>();
const TRIGGER_COOLDOWN_MS = 60_000; // 1 minute between same-source triggers

// ─── Event Trigger Evaluators ───

export const EVENT_TRIGGERS: Record<
  string,
  (data: Record<string, unknown>) => ActivationTrigger | null
> = {
  // Breaking news detection (AI + cyber) — fired by the news watcher in
  // use-activation-events when a high-relevance cyber/AI story lands.
  'news.breaking': (data) => ({
    type: 'event',
    source: 'news',
    severity: (data.severity as 'low' | 'medium' | 'high' | 'critical') ?? 'medium',
    data,
  }),

  // Custom monitor keyword match
  'monitor.keyword_match': (data) => ({
    type: 'event',
    source: 'monitor',
    severity: (data.monitor_severity as 'low' | 'medium' | 'high' | 'critical') ?? 'low',
    data,
  }),

  // ─── Cyber triggers (Phase 6.6) ───

  // CISA KEV addition — always critical, federal deadline implies operational urgency
  'cve.kev_added': (data) => ({
    type: 'event',
    source: 'cve_kev',
    severity: 'critical',
    data,
  }),

  // Breach disclosure (HIBP / 8-K / news-correlated incident)
  'breach.disclosed': (data) => {
    const records = data.records_compromised as number;
    // Auto-critical for 10M+ records, high for 1M+, medium otherwise
    const severity: 'low' | 'medium' | 'high' | 'critical' =
      records > 10_000_000 ? 'critical' : records > 1_000_000 ? 'high' : 'medium';
    return { type: 'event', source: 'breach', severity, data };
  },

  // VENDOR patch release for a critical-rated advisory.
  //
  // The severity downgrade is deliberate: a shipped patch is good news, and
  // "Microsoft published a fix" should never be as loud as "this is being
  // exploited". Note this is why no `patch.released` alert can ever reach the
  // hero banner's default `critical` threshold — by design.
  'patch.released': (data) => {
    const severity = (data.severity as string)?.toLowerCase() ?? 'medium';
    if (severity === 'critical' || severity === 'high') {
      return {
        type: 'event',
        source: 'patch',
        severity: severity === 'critical' ? 'high' : 'medium',
        data,
      };
    }
    return null;
  },

  // CERT / national-body advisory (CISA, NCSC-UK, JPCERT, …).
  //
  // Split out from `patch.released`, which used to swallow these. A CERT
  // advisory is not a patch: the task template rendered
  // "PATCH RELEASED: ncsc_uk unknown security update is out" and the agent
  // spent its whole answer correcting the premise. Unlike a patch, this keeps
  // the issuer's own severity — a genuine CERT critical SHOULD be able to
  // reach the breaking banner.
  'advisory.published': (data) => {
    const severity = (data.severity as string)?.toLowerCase() ?? 'medium';
    if (severity === 'critical' || severity === 'high') {
      return {
        type: 'event',
        source: 'advisory',
        severity: severity === 'critical' ? 'critical' : 'high',
        data,
      };
    }
    return null;
  },

  // Scheduled triggers (routed through processEvent)
  'schedule.morning_brief': (data) => ({
    type: 'schedule' as const,
    source: 'schedule',
    severity: 'medium' as const,
    data,
  }),
  'schedule.midday_scan': (data) => ({
    type: 'schedule' as const,
    source: 'schedule',
    severity: 'low' as const,
    data,
  }),
  'schedule.close_summary': (data) => ({
    type: 'schedule' as const,
    source: 'schedule',
    severity: 'medium' as const,
    data,
  }),
  'schedule.overnight_scan': (data) => ({
    type: 'schedule' as const,
    source: 'schedule',
    severity: 'low' as const,
    data,
  }),
};

// ─── Scheduled Triggers ───
//
// `cron` here is the INTENT, expressed in America/New_York — it documents when
// each brief is meant to run and is what a human should read. The actual firing
// is done by Vercel Cron against `/api/cron/scheduled-brief?name=<name>`, whose
// schedules live in vercel.json and are UTC (so they carry a fixed EST offset;
// briefs land an hour later in local terms over DST).

export const SCHEDULE_TRIGGERS = [
  {
    cron: '0 6 * * 1-5',
    name: 'morning_brief',
    task: 'Generate a morning cybersecurity + AI intelligence brief covering overnight developments: new CVEs and CISA KEV additions, active exploitation, breach disclosures, vendor patches, and notable AI-security research.',
  },
  {
    cron: '0 12 * * 1-5',
    name: 'midday_scan',
    task: 'Scan for cyber + AI developments since the morning brief. Focus on newly exploited vulnerabilities, breaking breach disclosures, fresh vendor patches, and emerging threats that may require attention.',
  },
  {
    cron: '30 16 * * 1-5',
    name: 'close_summary',
    task: "Generate an end-of-day cybersecurity + AI summary. Include the day's most significant CVEs, KEV additions, breaches, and patches, key AI-risk stories, and overnight watch items.",
  },
  {
    cron: '0 23 * * 0-4',
    name: 'overnight_scan',
    task: 'Scan international cyber + AI developments for overnight risk. Focus on active exploitation campaigns, nation-state threat activity, and any breaking security or AI-safety developments.',
  },
] as const;

/**
 * Evaluate an event against all registered triggers.
 */
export function evaluateEvent(
  eventType: string,
  data: Record<string, unknown>,
): ActivationTrigger | null {
  if (!Object.hasOwn(EVENT_TRIGGERS, eventType)) return null;
  const evaluator = EVENT_TRIGGERS[eventType];
  if (!evaluator) return null;
  return evaluator(data);
}

/**
 * Build the agent task string from a trigger.
 */
export function buildTaskFromTrigger(trigger: ActivationTrigger): string {
  const { source, severity, data } = trigger;

  switch (source) {
    case 'news':
      return `BREAKING [${severity.toUpperCase()}]: "${data.title as string}". Assess significance for cybersecurity and AI risk — affected vendors/systems, exploitation or misuse potential, and what the team should watch. Cite the source.`;
    case 'monitor': {
      // The template used to name the monitor and interpolate none of the
      // match, so the agent was asked to "analyze the matched content" without
      // being shown any of it.
      const name = (data.monitor_name as string) ?? 'watchlist';
      const kw = (data.matched_keyword as string) ?? '';
      const title = (data.item_title as string) ?? '';
      const src = (data.source as string) ?? 'feed';
      const url = (data.url as string) ?? '';
      return `WATCHLIST HIT [${severity.toUpperCase()}]: the operator's "${name}" monitor matched${kw ? ` on "${kw}"` : ''} in a ${src} item: "${title}". Say what it is, whether it actually matters to them, and what (if anything) to do. If the match looks incidental — the keyword appearing in passing rather than the subject — say so plainly and briefly.${url ? ` Source: ${url}` : ''}`;
    }
    case 'cve_kev': {
      const cveId = data.cve_id as string;
      const vuln = (data.vulnerability_name as string) ?? cveId;
      const vendor = (data.vendor_project as string) ?? '';
      const dueDate = (data.due_date as string) ?? 'no deadline';
      return `KEV ALERT [CRITICAL]: CISA added ${cveId} (${vuln}${vendor ? `, ${vendor}` : ''}) to KEV. Federal deadline ${dueDate}. Analyze exploitation status, affected products, and surface the patch + compensating mitigations. Use aegis_cve_detail for full package.`;
    }
    case 'breach': {
      const org = data.organization as string;
      const records = data.records_compromised as number;
      const recordsStr =
        records >= 1_000_000_000
          ? `${(records / 1e9).toFixed(1)}B`
          : records >= 1_000_000
            ? `${Math.round(records / 1e6)}M`
            : records >= 1_000
              ? `${Math.round(records / 1e3)}K`
              : String(records);
      return `BREACH DISCLOSED [${severity.toUpperCase()}]: ${org} disclosed a breach affecting ${recordsStr} records. Assess incident type, vector, attribution if available, and surface industry/sector comparables. Use aegis_find_incident_comps for context.`;
    }
    case 'patch': {
      const product = (data.product as string) ?? 'unknown product';
      const vendor = (data.vendor as string) ?? 'unknown vendor';
      const cveIds = (data.cve_ids as string[])?.join(', ') ?? '';
      return `PATCH RELEASED [${severity.toUpperCase()}]: ${vendor} ${product} security update is out${cveIds ? ` covering ${cveIds}` : ''}. Brief the team on what it fixes, deployment recommendations, and any known exploitation pre-patch.`;
    }
    case 'advisory': {
      // Deliberately makes no claim that a patch shipped — that false premise
      // is what CERT items used to inherit from the `patch` template.
      const issuer = ((data.vendor as string) ?? (data.issuer as string) ?? 'A national CERT')
        .toString()
        .toUpperCase();
      const title = (data.title as string) ?? (data.headline as string) ?? 'a new advisory';
      const cveIds = (data.cve_ids as string[])?.join(', ') ?? '';
      return `ADVISORY [${severity.toUpperCase()}]: ${issuer} published "${title}"${cveIds ? ` (referencing ${cveIds})` : ''}. Say what it actually asks defenders to do and who it applies to. If it is guidance or a joint statement rather than an actionable technical advisory, say that plainly and keep it short — do not manufacture remediation steps it does not contain.`;
    }
    case 'schedule':
      return data.task as string;
    default:
      return `Event from ${source} [${severity}]: ${JSON.stringify(data).slice(0, 200)}`;
  }
}

// ─── Alert-spine mapping ───

/** How a fired trigger is persisted as an `aegis_pipeline_alerts` row. */
export interface AlertDescriptor {
  alertType: string;
  entityKind: string;
  entityId: string;
  headline: string;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Map a fired trigger onto the polymorphic `aegis_pipeline_alerts` shape.
 * `entity_kind` is untyped TEXT in the schema, so `news`/`monitor` need no
 * migration. Returns null when the event carries no usable entity id — an alert
 * with nothing to point at would be an uncitable row (rule #21).
 *
 * Exported for `activation.test.ts`.
 */
export function alertDescriptorFor(
  eventType: string,
  data: Record<string, unknown>,
): AlertDescriptor | null {
  const fallbackHeadline = str(data.headline) ?? str(data.title);

  switch (eventType) {
    case 'cve.kev_added': {
      const cveId = str(data.cve_id);
      if (!cveId) return null;
      const vuln = str(data.vulnerability_name) ?? cveId;
      const vendor = str(data.vendor_project);
      return {
        alertType: 'new_kev',
        entityKind: 'cve',
        entityId: cveId,
        headline: `KEV: ${vuln}${vendor ? ` (${vendor})` : ''}`,
      };
    }
    case 'breach.disclosed': {
      // Prefer the compromised-org id — that's what the AEGIS viewer resolves.
      // Fall back to the disclosure's own source URL so the alert stays citable.
      const orgId = str(data.org_id);
      const sourceUrl = str(data.source_url);
      const entityKind = orgId ? 'breach' : 'advisory';
      const entityId = orgId ?? sourceUrl ?? str(data.breach_id);
      if (!entityId) return null;
      const records = Number(data.records_compromised);
      const recordsStr = Number.isFinite(records)
        ? records >= 1_000_000
          ? `${Math.round(records / 1e6)}M records`
          : `${records.toLocaleString()} records`
        : 'undisclosed volume';
      return {
        alertType: 'new_breach',
        entityKind,
        entityId,
        headline: fallbackHeadline ?? `Breach disclosed: ${recordsStr}`,
      };
    }
    case 'patch.released': {
      // Advisories have no viewer route — the vendor's own advisory URL is the
      // better citation when we have it.
      const entityId = str(data.advisory_url) ?? str(data.advisory_id);
      if (!entityId) return null;
      const vendor = str(data.vendor) ?? 'Vendor';
      return {
        alertType: 'new_patch',
        entityKind: 'advisory',
        entityId,
        headline: fallbackHeadline ?? `${vendor.toUpperCase()} security update`,
      };
    }
    case 'advisory.published': {
      const entityId = str(data.advisory_url) ?? str(data.advisory_id);
      if (!entityId) return null;
      const issuer = str(data.vendor) ?? str(data.issuer) ?? 'CERT';
      return {
        alertType: 'advisory',
        entityKind: 'advisory',
        entityId,
        headline: fallbackHeadline ?? `${issuer.toUpperCase()} advisory`,
      };
    }
    case 'news.breaking': {
      // The article URL doubles as the entity id so the alert links to the story.
      const entityId = str(data.url) ?? str(data.id);
      if (!entityId) return null;
      return {
        alertType: 'advisory',
        entityKind: 'news',
        entityId,
        headline: fallbackHeadline ?? 'Breaking story',
      };
    }
    case 'monitor.keyword_match': {
      // Key on the matched ITEM, not the monitor. Keying on monitor_id would
      // collapse every hit a watchlist ever gets into one row per day under the
      // 24h dedup guard, and would render a dead `/?focus=<uuid>` citation.
      // The item URL passes through deriveSourceUrl verbatim.
      const entityId = str(data.url) ?? str(data.item_id) ?? str(data.monitor_id);
      if (!entityId) return null;
      const monitorName = str(data.monitor_name) ?? 'watchlist';
      return {
        alertType: 'monitor_match',
        entityKind: str(data.source) ?? 'monitor',
        entityId,
        headline: fallbackHeadline ?? `${monitorName} match`,
      };
    }
    default:
      // schedule.* triggers are recurring briefs, not discrete signals — they
      // produce a brief, not an alert row.
      return null;
  }
}

/**
 * Pull the BLUF line out of an agent response, falling back to the first
 * substantive line. Shared by the alert-row enrichment here and the headline
 * the activate route hands back to the toast, so the two can't disagree about
 * what the same run said.
 */
export function extractBluf(text: string, maxLength = 180): string | null {
  const blufMatch = text.match(/\*?\*?BLUF:?\*?\*?\s*(.+)/i);
  const bluf = blufMatch?.[1]?.replace(/\*\*/g, '').trim();
  if (bluf) return bluf.slice(0, maxLength);

  const firstLine = text
    .split('\n')
    .find((l) => l.trim().length > 10)
    ?.trim();
  return firstLine ? firstLine.slice(0, maxLength) : null;
}

/**
 * Push the alert to any connected dashboard over the `alerts` WS channel. This
 * is the first producer the `('alerts','new')` consumer in `ws/client.ts` has
 * ever had — before this the client alerts-store was permanently empty.
 *
 * Fail-soft: `broadcast` is a no-op when no WS server is attached (Vercel),
 * where the polling read path in `useAlertsData` covers the same ground.
 */
function broadcastAlert(
  alertId: number,
  trigger: ActivationTrigger,
  descriptor: AlertDescriptor,
  headline: string,
  summary: string | null,
): void {
  try {
    broadcast('alerts', 'new', {
      id: String(alertId),
      severity: trigger.severity,
      title: headline,
      summary: summary ?? undefined,
      triggerData: null,
      acknowledged: false,
      createdAt: new Date().toISOString(),
      alertType: descriptor.alertType,
      entityKind: descriptor.entityKind,
      entityId: descriptor.entityId,
      sourceUrl: deriveSourceUrl(descriptor.entityKind, descriptor.entityId, { relative: true }),
      status: 'new',
      location: null,
    });
  } catch {
    // Broadcast is best-effort — never break the activation flow.
  }
}

/**
 * Cooldown key. Keyed on the ENTITY, not just the source, so two distinct
 * breaking stories inside the 60s window no longer collapse into one (the old
 * `${source}:${eventType}` key silently dropped the second).
 */
function cooldownKeyFor(eventType: string, trigger: ActivationTrigger, entityId?: string): string {
  return entityId ? `${eventType}:${entityId}` : `${trigger.source}:${eventType}`;
}

/**
 * Process an incoming event through the activation engine.
 * If the event crosses a trigger threshold and isn't in cooldown,
 * invoke the agent autonomously and return the result.
 */
export async function processEvent(
  eventType: string,
  data: Record<string, unknown>,
): Promise<{ trigger: ActivationTrigger; result: AgentResult } | null> {
  const trigger = evaluateEvent(eventType, data);
  if (!trigger) return null;

  const descriptor = alertDescriptorFor(eventType, data);

  // Cooldown check — prevent trigger spam from the same entity
  const cooldownKey = cooldownKeyFor(eventType, trigger, descriptor?.entityId);
  const lastFired = triggerCooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - lastFired < TRIGGER_COOLDOWN_MS) {
    return null;
  }
  triggerCooldowns.set(cooldownKey, Date.now());

  // ─── Alert spine ───
  // Persist the alert BEFORE invoking the agent. Two reasons: the operator sees
  // it on the ALERTS board the moment it fires rather than ~10s later when the
  // agent finishes, and `fireBreakingTweet` below needs a real `alert_id` — that
  // gate was unreachable while nothing ever wrote this table.
  //
  // Deduped on the entity inside a 24h window: the client watchers re-diff their
  // feed every poll, so the same CERT advisory can look "new" again minutes
  // later. Only a genuinely new row is broadcast — a reused row is already on
  // the operator's board and re-pushing it would flash it a second time.
  let alertId: number | null = null;
  if (descriptor) {
    const aiRelevance = Number(data.ai_relevance);
    const inserted = await insertPipelineAlert({
      alertType: descriptor.alertType,
      entityKind: descriptor.entityKind,
      entityId: descriptor.entityId,
      severity: trigger.severity,
      headline: descriptor.headline,
      aiRelevance: Number.isFinite(aiRelevance) ? aiRelevance : null,
    });
    if (inserted) {
      alertId = inserted.id;
      data.alert_id = alertId;
      if (inserted.created) {
        broadcastAlert(alertId, trigger, descriptor, descriptor.headline, null);
      }
    }
  }

  let task = buildTaskFromTrigger(trigger);
  console.log(
    `[Activation] Trigger fired: ${eventType} [${trigger.severity}] — ${task.slice(0, 80)}`,
  );

  // Gather cross-panel correlation data for richer context
  try {
    const { gatherCorrelation } = await import('./correlation');
    const correlationContext = await gatherCorrelation(eventType, data);
    if (correlationContext) {
      task += correlationContext;
    }
  } catch {
    // Correlation is best-effort
  }

  try {
    const { invokeAgent } = await import('./client');
    const { registerAllTools } = await import('./tools');
    registerAllTools();

    const context: AgentContext = {
      marketStatus: 'unknown',
      activeAlerts: [],
      pendingApprovals: [],
      recentBriefs: [],
      user: {
        id: 'system',
        focusAreas: [],
        preferences: {},
      },
    };

    const result = await invokeAgent({
      trigger: 'event',
      context,
      task,
      userId: 'system',
      responseMode: 'concise',
    });

    // Enrich the alert row with the agent's own read of the signal. The row was
    // written pre-invocation with a mechanical headline; the BLUF is what the
    // Cyber Wire, the RSS feed, and the ALERTS board should actually show.
    if (alertId != null && descriptor) {
      const bluf = extractBluf(result.text);
      if (bluf) {
        void updatePipelineAlert(alertId, { summary: bluf });
      }
    }

    // Phase 9.5 — stage a breaking-tweet draft when a KEV addition lands on
    // an AI-cyber-relevant CVE. Fail-soft and out-of-band: any error here
    // never disrupts the agent invocation flow above. Server-to-server call
    // uses the x-cron-secret header so the route stays gated.
    if (eventType === 'cve.kev_added') {
      const aiRelevance = Number(data.ai_relevance);
      const sourceAlertId =
        typeof data.alert_id === 'number'
          ? data.alert_id
          : Number.parseInt(String(data.alert_id ?? ''), 10);
      const twitterAutodraftEnabled =
        process.env.TWITTER_AUTODRAFT_ENABLED === '1' ||
        process.env.TWITTER_AUTODRAFT_ENABLED === 'true';
      if (
        twitterAutodraftEnabled &&
        Number.isFinite(aiRelevance) &&
        aiRelevance > 0.6 &&
        Number.isFinite(sourceAlertId) &&
        sourceAlertId > 0
      ) {
        void fireBreakingTweet(sourceAlertId);
      }

      // Phase 11.A.3 — emit a severity-history row for the HMM observation
      // stream. The KEV-added trigger is the ground-truth signal that a CVE
      // crossed into Mass_Exploitation; without this emission the HMM has no
      // way to learn the transition probabilities from real data.
      //
      // Fail-soft: emitSeverityEvent never throws. If the CVE isn't in our
      // aegis_cves table yet (e.g., the KEV event arrived before the NVD
      // ingestion), the insert silently fails on FK and we move on — the
      // next time this CVE crosses through any lifecycle event we'll
      // re-emit. No retry loop needed.
      const cveId = typeof data.cve_id === 'string' ? data.cve_id : null;
      if (cveId) {
        const cvssScore = typeof data.cvss_score === 'number' ? data.cvss_score : undefined;
        void emitSeverityEvent({
          cveId,
          eventType: 'kev_added',
          observedAt: typeof data.kev_added_at === 'string' ? data.kev_added_at : undefined,
          cvssScore,
          source: 'activation.kev_added',
        });
      }
    }

    return { trigger, result };
  } catch (err) {
    console.error(`[Activation] Agent invocation failed for ${eventType}:`, err);
    return null;
  }
}

/**
 * Fire-and-forget server-to-server call to the breaking-tweet generator
 * route. Uses x-cron-secret for auth so the route stays gated like the
 * scheduled crons. Swallows all errors — autonomous tweet drafting must
 * never disrupt the upstream agent pipeline.
 */
async function fireBreakingTweet(sourceAlertId: number): Promise<void> {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3002';
  const secret = process.env.CRON_SECRET ?? '';
  try {
    await fetch(`${base}/api/twitter/breaking`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': secret,
      },
      body: JSON.stringify({ sourceAlertId }),
    });
  } catch (err) {
    console.warn(
      '[Activation] breaking-tweet stage failed',
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ─── Scheduled Triggers ───
//
// The four scheduled briefs above are fired by Vercel Cron via
// `/api/cron/scheduled-brief?name=<trigger>` (see vercel.json). The in-process
// `setInterval` runner that used to live here was never started by anything —
// and couldn't have worked on Vercel regardless, since a serverless function
// holds no long-lived timer. The cron route is the single scheduler.
