/**
 * Watchlist scan engine (Phase 2). For every enabled monitor, match its
 * keywords against fresh feed items and record new hits to monitor_match_log
 * (atomic ON CONFLICT dedup — a given (monitor, source, item) alerts once).
 *
 * Source pools are pulled ONCE and shared across all monitors (the collectors
 * are already cached + rate-limited + fail-soft). The scan never throws; a bad
 * source fails soft and the others still run.
 *
 * SURFACING — this used to be the gap. `monitor_match_log` was write-only:
 * `recentMonitorMatches()` had no callers, no route exposed matches, and the
 * `monitor.keyword_match` activation trigger had three consumers wired and no
 * producer. A watchlist could match and the operator would never know.
 *
 * Now every new match writes an `aegis_pipeline_alerts` row, which carries it to
 * the ALERTS panel, the threat ticker, the session delta, the Cyber Wire, and
 * the agent's `aegis_recent_alerts` tool — all for free, because the alert spine
 * already feeds those. On top of that, matches on monitors that are BOTH
 * `notify_on_match` and high/critical additionally invoke the agent for
 * analysis + a toast, capped per scan so a broad keyword can't start an agent
 * storm.
 */

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { fetchHibpBreaches } from '@/lib/data/collectors/breach-feed';
import { fetchKevCatalog, fetchRecentCves } from '@/lib/data/collectors/cve-feed';
import { fetchRSSFeeds } from '@/lib/data/collectors/rss';
import { fetchTwitterTimeline } from '@/lib/data/collectors/twitter';
import type { MonitorRow } from '@/lib/db/queries/monitors';
import {
  getEnabledMonitors,
  recordMonitorMatch,
  touchMonitorScanned,
} from '@/lib/db/queries/monitors';
import { insertPipelineAlert } from '@/lib/db/queries/pipeline-alerts';

/**
 * How many matches per scan may escalate to a full agent invocation. Every
 * match still lands on the ALERTS board; this only bounds the expensive path.
 * A keyword like "microsoft" can hit dozens of items in one 5-minute tick.
 */
const MAX_AGENT_MATCHES_PER_SCAN = 3;

/** Severities that may escalate to the agent, given notify_on_match is on. */
const ESCALATING_SEVERITIES = new Set(['high', 'critical']);

type SourceKey = 'cve' | 'kev' | 'breach' | 'news' | 'tweet';

interface ScanItem {
  id: string;
  text: string;
  title: string;
  url?: string;
}

function isSourceKey(s: string): s is SourceKey {
  return s === 'cve' || s === 'kev' || s === 'breach' || s === 'news' || s === 'tweet';
}

async function buildPools(needed: Set<SourceKey>): Promise<Record<SourceKey, ScanItem[]>> {
  const pools: Record<SourceKey, ScanItem[]> = {
    cve: [],
    kev: [],
    breach: [],
    news: [],
    tweet: [],
  };
  const tasks: Promise<void>[] = [];

  if (needed.has('cve')) {
    tasks.push(
      (async () => {
        const cves = await fetchRecentCves(100);
        pools.cve = cves.map((c) => ({
          id: c.cveId,
          text: `${c.cveId} ${c.summary ?? ''}`,
          title: c.cveId,
          url: c.nvdSourceUrl ?? `/api/aegis/cves/view?id=${encodeURIComponent(c.cveId)}`,
        }));
      })().catch(() => {}),
    );
  }
  if (needed.has('kev')) {
    tasks.push(
      (async () => {
        const kev = await fetchKevCatalog(200);
        pools.kev = kev.map((k) => ({
          id: k.cveId,
          text: `${k.cveId} ${k.vendorProject ?? ''} ${k.product ?? ''} ${k.vulnerabilityName ?? ''}`,
          title: k.vulnerabilityName ?? k.cveId,
          url: `/api/aegis/kev/view?id=${encodeURIComponent(k.cveId)}`,
        }));
      })().catch(() => {}),
    );
  }
  if (needed.has('breach')) {
    tasks.push(
      (async () => {
        const breaches = await fetchHibpBreaches(100);
        pools.breach = breaches.map((b) => ({
          // NOT `b.id` — that is a positional index into the HIBP response
          // (`idx + 1`), so it renumbers every time HIBP adds an
          // alphabetically-earlier breach, AND collides with the 1-5 demo
          // fallback ids. Both directions of dedup were broken: old breaches
          // re-alerted at their new index, and a genuinely new breach that
          // landed on an already-logged index stayed silent. The HIBP
          // permalink carries the breach name and is stable.
          id: b.sourceUrl ?? `breach-${b.disclosedAt}-${b.breachType ?? 'unknown'}`,
          text: `${b.breachType ?? ''} ${b.source ?? ''} ${b.notes ?? ''} ${(b.relatedCveIds ?? []).join(' ')}`,
          title: b.breachType ?? `Breach ${b.id}`,
          url: b.sourceUrl,
        }));
      })().catch(() => {}),
    );
  }
  if (needed.has('news')) {
    tasks.push(
      (async () => {
        const [cyber, ai] = await Promise.all([
          fetchRSSFeeds('cyber', 40),
          fetchRSSFeeds('ai', 20),
        ]);
        pools.news = [...cyber, ...ai].map((n) => ({
          id: n.id,
          text: `${n.title} ${n.summary ?? ''}`,
          title: n.title,
          url: n.url,
        }));
      })().catch(() => {}),
    );
  }
  if (needed.has('tweet')) {
    tasks.push(
      (async () => {
        const tweets = await fetchTwitterTimeline();
        pools.tweet = tweets.map((t) => ({
          id: t.id,
          text: `${t.text} @${t.authorUsername}`,
          title: `@${t.authorUsername}`,
          url: t.url,
        }));
      })().catch(() => {}),
    );
  }

  await Promise.all(tasks);
  return pools;
}

/**
 * The alert row for one watchlist hit.
 *
 * `entity_id` is the item's URL whenever it's absolute, because
 * `deriveSourceUrl` passes absolute URLs straight through — so the ALERTS row
 * deep-links to the actual article/advisory rather than a dead dashboard focus
 * link (rule #21). `skipDedup` because `monitor_match_log` is already the
 * authoritative uniqueness gate; see insertPipelineAlert.
 *
 * Exported for scan.test.ts.
 */
export function buildMatchAlert(
  monitor: Pick<MonitorRow, 'name' | 'severity'>,
  source: SourceKey,
  item: ScanItem,
  matchedKeyword: string,
) {
  const citable = item.url && /^https?:\/\//i.test(item.url);
  return {
    alertType: 'monitor_match',
    entityKind: source,
    entityId: citable ? (item.url as string) : item.id,
    severity: monitor.severity,
    headline: `${monitor.name}: ${item.title}`.slice(0, 300),
    summary: `Watchlist "${monitor.name}" matched "${matchedKeyword}" in a ${source} item.`,
    skipDedup: true,
  };
}

/** First keyword (case-insensitive substring) that appears in the text, or null. */
function matchKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (k && lower.includes(k)) return kw;
  }
  return null;
}

export interface MonitorScanSummary {
  monitorsScanned: number;
  newMatches: number;
  byMonitor: Record<string, number>;
  /** New matches that landed on the ALERTS board. */
  alertsWritten: number;
  /** Matches that additionally got an agent analysis + toast. */
  agentInvocations: number;
  /** Escalating matches dropped by MAX_AGENT_MATCHES_PER_SCAN (still on the board). */
  escalationsSkipped: number;
}

export async function runMonitorScan(): Promise<MonitorScanSummary> {
  const monitors = await getEnabledMonitors();
  if (monitors.length === 0) {
    return {
      monitorsScanned: 0,
      newMatches: 0,
      byMonitor: {},
      alertsWritten: 0,
      agentInvocations: 0,
      escalationsSkipped: 0,
    };
  }

  const needed = new Set<SourceKey>();
  for (const m of monitors) {
    for (const s of m.sources) if (isSourceKey(s)) needed.add(s);
  }
  const pools = await buildPools(needed);

  let newMatches = 0;
  let alertsWritten = 0;
  let agentInvocations = 0;
  let escalationsSkipped = 0;
  const byMonitor: Record<string, number> = {};

  for (const m of monitors) {
    for (const source of m.sources) {
      if (!isSourceKey(source)) continue;
      for (const item of pools[source]) {
        const kw = matchKeyword(item.text, m.keywords);
        if (!kw) continue;
        const isNew = await recordMonitorMatch({
          monitorId: m.id,
          source,
          itemId: item.id,
          matchedKeyword: kw,
          itemTitle: item.title,
          itemUrl: item.url,
        });
        if (!isNew) continue;

        newMatches++;
        byMonitor[m.id] = (byMonitor[m.id] ?? 0) + 1;

        // Always: put the hit on the board. Cheap, and the operator's guaranteed
        // surface — the agent path below is best-effort on top of it.
        const written = await insertPipelineAlert(buildMatchAlert(m, source, item, kw));
        if (written) alertsWritten++;

        // Escalate only what the operator asked to be interrupted for.
        const wantsEscalation = m.notify_on_match && ESCALATING_SEVERITIES.has(m.severity);
        if (!wantsEscalation) continue;
        if (agentInvocations >= MAX_AGENT_MATCHES_PER_SCAN) {
          escalationsSkipped++;
          continue;
        }
        agentInvocations++;

        try {
          const { processEvent } = await import('@/lib/agent/activation');
          await processEvent('monitor.keyword_match', {
            monitor_id: m.id,
            monitor_name: m.name,
            monitor_severity: m.severity,
            matched_keyword: kw,
            source,
            item_id: item.id,
            item_title: item.title,
            url: item.url,
            headline: `${m.name}: ${item.title}`,
            alert_id: written?.id,
          });
        } catch (err) {
          // The board row is already written; a failed analysis must not abort
          // the rest of the scan.
          console.error('[monitor-scan] agent escalation failed:', err);
        }
      }
    }
    await touchMonitorScanned(m.id);
  }

  if (escalationsSkipped > 0) {
    // Never silently truncate — the operator should be able to tell that a
    // broad keyword outran the escalation budget.
    console.warn(
      `[monitor-scan] ${escalationsSkipped} match(es) matched an escalating monitor but exceeded MAX_AGENT_MATCHES_PER_SCAN=${MAX_AGENT_MATCHES_PER_SCAN}; they are on the ALERTS board but were not analyzed.`,
    );
  }

  void recordAudit({
    action: AUDIT_ACTIONS.DATA_MONITOR_SCANNED,
    outcome: 'success',
    targetKind: 'monitor_scan',
    targetId: `scan-${monitors.length}`,
    details: {
      monitorsScanned: monitors.length,
      newMatches,
      alertsWritten,
      agentInvocations,
      escalationsSkipped,
    },
  });

  return {
    monitorsScanned: monitors.length,
    newMatches,
    byMonitor,
    alertsWritten,
    agentInvocations,
    escalationsSkipped,
  };
}
