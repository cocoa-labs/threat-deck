import { getLocalDevSessionEmail } from '@/lib/auth/config';
import { fetchKevCatalog, fetchRecentCves } from '@/lib/data/collectors/cve-feed';
import type { CVE, KEV } from '@/lib/types';
import { AmbientTicker, type TickerItem } from './AmbientTicker';
import { AuthTerminal } from './AuthTerminal';
import styles from './login.module.css';

/**
 * Login route — SSR-rendered. Pulls a fresh slice of cyber intel for the
 * ambient ticker on each request. Caches via the underlying collectors
 * (5-minute TTL each), so first paint is fast even after a deploy.
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const [kev, cves] = await Promise.all([
    fetchKevCatalog(10).catch(() => [] as KEV[]),
    fetchRecentCves(20).catch(() => [] as CVE[]),
  ]);

  const tickerItems = buildTickerItems(kev, cves);
  const criticalCveCount = cves.filter(
    (c) => c.severity === 'critical' || c.isKev || c.exploitedInWild,
  ).length;
  const lastBriefMinutes = computeMinutesSinceLastSignal(cves, kev);
  const devBypassEmail = getLocalDevSessionEmail();

  return (
    <main className={styles.page}>
      <AuthTerminal
        lastBriefMinutes={lastBriefMinutes}
        criticalCveCount={criticalCveCount}
        devBypassEmail={devBypassEmail}
      />
      <div className={styles.seam} aria-hidden />
      <AmbientTicker items={tickerItems} />
    </main>
  );
}

/* ─── Data shaping ─── */

function buildTickerItems(kev: KEV[], cves: CVE[]): TickerItem[] {
  const items: TickerItem[] = [];

  // KEV entries (always critical — CISA only catalogs exploited vulns)
  for (const k of kev) {
    items.push({
      id: `kev:${k.cveId}`,
      time: formatTime(k.addedToKevAt),
      tag: 'KEV',
      severity: 'critical',
      text: composeKevHeadline(k),
    });
  }

  // CVE entries, dedupe against KEV IDs we just added
  const kevIds = new Set(kev.map((k) => k.cveId));
  for (const c of cves) {
    if (kevIds.has(c.cveId)) continue;
    items.push({
      id: `cve:${c.cveId}`,
      time: formatTime(c.publishedAt),
      tag: c.cveId.length > 14 ? `${c.cveId.slice(0, 13)}…` : c.cveId,
      severity: mapSeverity(c.severity),
      text: truncate(c.summary, 110),
    });
  }

  // Sort newest first by ticker-relevant timestamp (we already mapped to HH:MM,
  // but for stable ordering use raw timestamps)
  items.sort((a, b) => b.time.localeCompare(a.time));

  // Cap at 24 — track is doubled in the component for seamless loop
  return items.slice(0, 24);
}

function composeKevHeadline(k: KEV): string {
  const subject = [k.vendorProject, k.product].filter(Boolean).join(' ');
  const headline = k.vulnerabilityName ?? k.shortDescription ?? 'Known exploited vulnerability';
  const ransomBadge = k.knownRansomwareUse === 'Known' ? ' — ransomware-used' : '';
  return subject ? `${subject} · ${headline}${ransomBadge}` : `${headline}${ransomBadge}`;
}

function mapSeverity(s: string): TickerItem['severity'] {
  if (s === 'critical' || s === 'high' || s === 'medium' || s === 'low') return s;
  return 'low';
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '--:--';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--';
    const hh = d.getUTCHours().toString().padStart(2, '0');
    const mm = d.getUTCMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '--:--';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Best-available proxy for "minutes since last AEGIS brief" until activation.ts wires it. */
function computeMinutesSinceLastSignal(cves: CVE[], kev: KEV[]): number {
  const timestamps: number[] = [];
  for (const c of cves) {
    const t = Date.parse(c.publishedAt);
    if (!Number.isNaN(t)) timestamps.push(t);
  }
  for (const k of kev) {
    const t = Date.parse(k.addedToKevAt);
    if (!Number.isNaN(t)) timestamps.push(t);
  }
  if (timestamps.length === 0) return 0;
  const newest = Math.max(...timestamps);
  const diff = Math.max(0, Date.now() - newest);
  return Math.min(999, Math.round(diff / 60_000));
}
