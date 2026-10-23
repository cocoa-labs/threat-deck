'use client';

import { useEffect, useRef } from 'react';
import { useAgentStore } from '@/lib/store/agent-store';
import { useDataStore } from '@/lib/store/data-store';
import type { Severity } from '@/lib/types';
import { advisoryIdentityKey } from '@/lib/utils/advisory-identity';

/**
 * Client-side activation event emitter.
 * Watches data store changes and emits activation events to the server
 * when thresholds are crossed. The server-side processEvent() handles
 * evaluation, cooldowns, and agent invocation.
 */

const ACTIVATION_COOLDOWN_MS = 120_000; // 2 min client-side dedup
const activationTimestamps = new Map<string, number>();

// AI-cyber relevance floor for the news alert — matches the autonomous-action
// bar used by the KEV→tweet path (activation.ts: ai_relevance > 0.6).
const AI_NEWS_RELEVANCE_THRESHOLD = 0.6;

function shouldFire(key: string): boolean {
  const last = activationTimestamps.get(key) ?? 0;
  if (Date.now() - last < ACTIVATION_COOLDOWN_MS) return false;
  activationTimestamps.set(key, Date.now());
  return true;
}

/**
 * Best-effort org name from a HIBP breach URL's `#Fragment`, used only as a
 * fallback for rows that predate the `organization` field (stale cache). Both
 * the live HIBP mapper and the demo seeds now set `organization` directly.
 */
function orgFromBreachUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const fragment = url.split('#')[1];
  if (!fragment) return undefined;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * Pure selection core for the AI+cyber news alert: keep only unseen stories
 * published after `publishedAfter`, at or above the relevance threshold, newest
 * first, capped. Extracted for unit testing — this is the anti-spam guard (the
 * old IWM storm came from exactly a missing dedup/threshold like this).
 * Exported for use-activation-events.test.ts.
 */
export function selectNewsAlerts<
  T extends { id: string; aiRelevance?: number; publishedAt: string },
>(items: T[], seenIds: Set<string>, threshold: number, cap: number, publishedAfter: number): T[] {
  return items
    .filter(
      (n) =>
        !seenIds.has(n.id) &&
        (n.aiRelevance ?? 0) >= threshold &&
        new Date(n.publishedAt).getTime() > publishedAfter,
    )
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, cap);
}

/** Advisories: how many may fire in a single tick. */
const ADVISORY_ALERT_CAP = 1;

/**
 * Pure selection core for the advisory alert. The advisory watcher had none of
 * the news watcher's guards, and it showed: two NCSC items about the same story
 * landed in one poll and produced two near-identical agent toasts.
 *
 * Three things fix that, and all three still matter:
 *  - a SESSION-LEVEL fired-set, not just the previous-tick diff. This was
 *    originally load-bearing because two hooks wrote one store slice wholesale
 *    and it thrashed between disjoint payloads; the slices are separated now,
 *    but the set still covers any wholesale rewrite (a refetch, a remount, a
 *    reordered feed) that a prev-tick diff would misread as new.
 *  - a PER-TICK CAP, so a batch refresh can't fan out into N agent runs.
 *  - a PUBLISHED-AFTER-MOUNT gate, so opening the dashboard never replays the
 *    existing backlog as breaking.
 *
 * Exported for use-activation-events.test.ts.
 */
export function selectAdvisoryAlerts<T extends { severity?: string; publishedAt: string }>(
  items: T[],
  keyOf: (item: T) => string,
  seenKeys: Set<string>,
  publishedAfter: number,
): T[] {
  return items
    .filter(
      (a) =>
        !seenKeys.has(keyOf(a)) &&
        (a.severity === 'critical' || a.severity === 'high') &&
        new Date(a.publishedAt).getTime() > publishedAfter,
    )
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, ADVISORY_ALERT_CAP);
}

/** CERT / national bodies. Everything else in the advisory feed is a vendor. */
const CERT_ISSUERS = new Set(['cisa', 'ncsc_uk', 'enisa', 'cert_eu', 'jpcert', 'acsc', 'cccs']);

async function fireEvent(
  eventType: string,
  data: Record<string, unknown>,
  severity: Severity,
  headline: string,
) {
  // Master mute — when the user has silenced autonomous alerts, suppress every
  // trigger at this single choke point. getState() reads the live value (rule
  // #24: closure-captured selector values go stale in module-scope callbacks).
  if (!useAgentStore.getState().autonomousAlertsEnabled) return;

  try {
    const response = await fetch('/api/agent/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `headline` rides along so the persisted alert row has a readable title
      // from the moment it lands — the server previously had to invent one.
      body: JSON.stringify({ eventType, data, headline }),
    });

    if (!response.ok) return;

    const result = (await response.json()) as {
      triggered: boolean;
      text?: string;
      headline?: string;
    };

    if (result.triggered && result.text) {
      useAgentStore.getState().addAutonomousResult({
        id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        triggerSource: eventType,
        task: headline,
        headline: result.headline ?? headline,
        severity,
        text: result.text,
        timestamp: Date.now(),
        dismissed: false,
        eventData: data,
      });
    }
  } catch {
    // Best-effort — don't disrupt the UI
  }
}

export function useActivationEvents() {
  // Cyber slices (Phase 6.6)
  const kev = useDataStore((s) => s.kev);
  const breaches = useDataStore((s) => s.breaches);
  // Both slices: this watcher is the one consumer that genuinely wants CERT
  // advisories AND vendor patches — it routes them to two different event
  // types with different severity policies.
  const certAdvisories = useDataStore((s) => s.advisories);
  const vendorPatches = useDataStore((s) => s.patches);
  // AI + cyber news slices for the breaking-news alert. Populated by
  // <CyberAiNewsBridge /> (mounted under QueryClientProvider in DashboardShell).
  // This hook runs at the shell's top level — OUTSIDE the provider — so it may
  // only READ the store here, never call useQuery (that throws "No QueryClient
  // set"; same constraint that gave us WebSocketBridge).
  const cyberNews = useDataStore((s) => s.news.cyber);
  const aiNews = useDataStore((s) => s.news.ai);

  // Track previous values for change detection
  const prevKevRef = useRef<typeof kev | null>(null);
  const prevBreachesRef = useRef<typeof breaches | null>(null);
  const prevAdvisoriesRef = useRef<typeof certAdvisories | null>(null);
  // News alert: only stories published after this hook mounted may fire (so the
  // existing backlog never alerts, regardless of how the store populates), and
  // each story fires at most once per session.
  const newsWatchStartRef = useRef<number>(Date.now());
  const firedNewsIdsRef = useRef<Set<string>>(new Set());
  // Advisories get the same treatment as news — see selectAdvisoryAlerts for
  // why a prev-tick diff alone was not enough.
  const advisoryWatchStartRef = useRef<number>(Date.now());
  const firedAdvisoryKeysRef = useRef<Set<string>>(new Set());

  // ─── AI + cyber news alert ───
  // Fires on high-AI-relevance breaking stories from the cyber + ai RSS feeds.
  // Replaces the removed legacy finance triggers. Tuned to be quiet (the
  // opposite of the old IWM bug): medium severity so it auto-dismisses, deduped
  // once per story, capped per tick, and only fires for stories that break
  // after the dashboard is open — never the existing backlog.
  useEffect(() => {
    const items = [...(cyberNews ?? []), ...(aiNews ?? [])];
    if (items.length === 0) return;

    // cap per tick — server cooldown caps visible toasts further
    const fresh = selectNewsAlerts(
      items,
      firedNewsIdsRef.current,
      AI_NEWS_RELEVANCE_THRESHOLD,
      2,
      newsWatchStartRef.current,
    );

    for (const item of fresh) {
      firedNewsIdsRef.current.add(item.id);
      if (shouldFire(`news:${item.id}`)) {
        const headline = item.title.length > 80 ? `${item.title.slice(0, 80)}…` : item.title;
        fireEvent(
          'news.breaking',
          {
            id: item.id,
            title: item.title,
            url: item.url,
            source: item.source,
            category: item.category,
            ai_relevance: item.aiRelevance,
            severity: 'medium',
          },
          'medium',
          headline,
        );
      }
    }
  }, [cyberNews, aiNews]);

  // ─── Cyber triggers (Phase 6.6) ───

  // KEV addition — new entry in CISA Known Exploited Vulnerabilities
  useEffect(() => {
    if (!kev || kev.length === 0) return;
    // Demo/fallback KEV entries (fictional CVEs served when CISA is down) must
    // never fire — cve.kev_added is ALWAYS critical and drives email/RSS/X.
    // Skip the whole tick without touching the baseline ref, so a real→demo→real
    // flap doesn't replay the live catalog as "new" on recovery.
    if (kev.some((k) => k.isFallback)) return;
    const prev = prevKevRef.current;
    prevKevRef.current = kev;
    if (!prev) return;

    const prevIds = new Set(prev.map((k) => k.cveId));
    for (const entry of kev) {
      if (!prevIds.has(entry.cveId)) {
        const key = `kev:${entry.cveId}`;
        if (shouldFire(key)) {
          fireEvent(
            'cve.kev_added',
            {
              cve_id: entry.cveId,
              vulnerability_name: entry.vulnerabilityName,
              vendor_project: entry.vendorProject,
              product: entry.product,
              due_date: entry.dueDate,
              known_ransomware_use: entry.knownRansomwareUse,
            },
            'critical',
            `KEV: ${entry.vulnerabilityName ?? entry.cveId}${entry.vendorProject ? ` (${entry.vendorProject})` : ''}`,
          );
        }
      }
    }
  }, [kev]);

  // Breach disclosure — new entry in breach feed (HIBP / news-correlated incident)
  useEffect(() => {
    if (!breaches || breaches.length === 0) return;
    // Demo/fallback breaches (the Acme/Nimbus/… seed served during an HIBP
    // outage) must never fire an alert or invoke Max. Skip before touching the
    // baseline ref, so demo data doesn't poison the diff — otherwise the whole
    // real feed replays as "new" the moment HIBP recovers.
    if (breaches.some((b) => b.isFallback)) return;
    const prev = prevBreachesRef.current;
    prevBreachesRef.current = breaches;
    if (!prev) return;

    const prevIds = new Set(prev.map((b) => b.id));
    for (const b of breaches) {
      if (!prevIds.has(b.id)) {
        const records = b.recordsCompromised ?? 0;
        const severity: 'low' | 'medium' | 'high' | 'critical' =
          records > 10_000_000 ? 'critical' : records > 1_000_000 ? 'high' : 'medium';
        const recKey = `breach:${b.id}`;
        if (shouldFire(recKey)) {
          // Real org name — the live mapper sets `organization` (HIBP
          // Title/Name), the demo seeds set it too; the URL fragment is a
          // last-ditch fallback for stale cached rows. This replaces the old
          // `org_${b.orgId}`, which was always "org_unknown" (orgId is never
          // populated for HIBP breaches).
          const org =
            b.organization ?? orgFromBreachUrl(b.sourceUrl) ?? 'an undisclosed organization';
          fireEvent(
            'breach.disclosed',
            {
              organization: org,
              // Raw ids for the alert spine — `org_id` resolves to the AEGIS
              // compromised-orgs viewer, `source_url` is the citation fallback.
              org_id: b.orgId != null ? String(b.orgId) : undefined,
              breach_id: String(b.id),
              records_compromised: records,
              disclosed_at: b.disclosedAt,
              breach_type: b.breachType,
              source_url: b.sourceUrl,
            },
            severity,
            `${org}: ${records >= 1_000_000 ? `${Math.round(records / 1e6)}M` : records.toLocaleString()} records breached`,
          );
        }
      }
    }
  }, [breaches]);

  // ─── Advisories + vendor patches ───
  // A CERT advisory is NOT a patch. Routing both through `patch.released` made
  // the agent open with "This isn't a software patch" and spend its answer
  // correcting the premise. Vendor items keep patch.released; CERT items get
  // advisory.published, which keeps the issuer's own severity and never claims
  // a fix shipped.
  //
  // The two now arrive in separate store slices, so this is a deliberate
  // re-union — the only consumer that wants both.
  useEffect(() => {
    // Drop demo/fallback advisories up front so neither the baseline ref nor the
    // select ever sees them. This watcher was only incidentally safe before —
    // the published-after-mount gate happened to reject the seed rows because
    // their dates are stale; the marker makes that explicit and robust.
    const advisories = [...(certAdvisories ?? []), ...(vendorPatches ?? [])].filter(
      (a) => !a.isFallback,
    );
    if (advisories.length === 0) return;
    // The prev-tick ref is retained only so the first populate never replays a
    // backlog; the session fired-set below is what actually dedups.
    const prev = prevAdvisoriesRef.current;
    prevAdvisoriesRef.current = advisories;
    if (!prev) return;

    const keyOf = advisoryIdentityKey;
    const fresh = selectAdvisoryAlerts(
      advisories,
      keyOf,
      firedAdvisoryKeysRef.current,
      advisoryWatchStartRef.current,
    );

    for (const adv of fresh) {
      const advKey = keyOf(adv);
      firedAdvisoryKeysRef.current.add(advKey);
      const isCert = CERT_ISSUERS.has(adv.issuer);
      const eventType = isCert ? 'advisory.published' : 'patch.released';
      if (!shouldFire(`${eventType}:${advKey}`)) continue;

      fireEvent(
        eventType,
        {
          advisory_id: advKey,
          advisory_url: adv.advisoryUrl,
          issuer: adv.issuer,
          vendor: adv.issuer,
          title: adv.title,
          product: adv.affectedProducts?.[0] ?? 'unknown',
          cve_ids: adv.affectedCves,
          severity: adv.severity,
        },
        isCert
          ? adv.severity === 'critical'
            ? 'critical'
            : 'high'
          : adv.severity === 'critical'
            ? 'high'
            : 'medium',
        // No severity word in the label. This used to interpolate the RAW
        // `adv.severity`, but the server deliberately downgrades vendor items
        // (critical→high, high→medium), so the stored row read
        // "VENDOR high: …" while its own `severity` column said `medium`. The
        // row carries the severity; the headline shouldn't contradict it.
        `${adv.issuer.toUpperCase()} ${isCert ? 'advisory' : 'patch'}: ${adv.title ?? advKey}`,
      );
    }
  }, [certAdvisories, vendorPatches]);
}
