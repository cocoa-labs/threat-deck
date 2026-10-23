/**
 * AEGIS ingest orchestrator.
 *
 * Sequences the five committed source ingestors and aggregates their summaries
 * into a single rollup. CVEs run FIRST because `aegis_kev.cve_id` is a foreign
 * key into `aegis_cves` — KEV entries for CVEs we haven't yet ingested would
 * otherwise violate the constraint. The remaining four are order-independent.
 *
 * Writes exactly one audit row per run (the `DATA_AEGIS_INGESTED` rollup) — per
 * Phase 1 the source ingestors record their own per-run cursor rows; this layer
 * only emits the aggregate. The audit call is fire-and-forget (`void`), matching
 * the EPSS collector pattern; `recordAudit` handles its own errors and never
 * throws.
 */

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { isRedisConnected, redis } from '@/lib/redis/client';
import { ingestAdvisories } from './ingest-advisories';
import { ingestBreaches } from './ingest-breaches';
import { type IngestSummary, ingestCves } from './ingest-cves';
import { ingestIocs } from './ingest-iocs';
import { ingestKev } from './ingest-kev';

export interface AegisIngestSummary {
  ok: boolean;
  totalUpserted: number;
  sources: IngestSummary[];
}

/**
 * Redis channel the ingest publishes refresh nudges to. The WS-server process
 * (a DIFFERENT process from this cron in prod) SUBSCRIBEs to it via the bridge
 * in `src/lib/ws/redis-bridge.ts` and re-broadcasts each nudge to clients.
 */
export const AEGIS_PUSH_CHANNEL = 'aegis:push';

/**
 * Publish one lightweight refresh nudge per source that actually changed
 * (`ok && upserted > 0`). The nudge is `{ channel, type:'refresh', count }` —
 * no row payloads (Rule #1: JSON-serializable; the client refetches the
 * authoritative data on receipt).
 *
 * Fully best-effort (Rule #9 spirit): early-returns when Redis is disconnected
 * and swallows any publish error so a Redis failure can NEVER fail the ingest
 * or change its return value. The 5-minute client poll floor backstops a
 * dropped nudge.
 */
export async function publishIngestNudges(sources: IngestSummary[]): Promise<void> {
  if (!isRedisConnected()) return;
  for (const s of sources) {
    if (s.ok && s.upserted > 0) {
      try {
        await redis.publish(
          AEGIS_PUSH_CHANNEL,
          JSON.stringify({ channel: s.source, type: 'refresh', count: s.upserted }),
        );
      } catch {
        // Swallow — push is best-effort; the 5-min poll floor backstops it.
      }
    }
  }
}

/**
 * Run all AEGIS source ingestors in dependency order and return an aggregate
 * summary. Never throws — each source ingestor is itself fail-soft (records a
 * failed run and returns `{ ok: false }` on error), so a single bad source
 * doesn't abort the rest.
 */
export async function runAegisIngest(): Promise<AegisIngestSummary> {
  // CVEs first (KEV FK depends on them), then the rest.
  const sources: IngestSummary[] = [];
  sources.push(await ingestCves());
  sources.push(await ingestKev());
  sources.push(await ingestIocs());
  sources.push(await ingestAdvisories());
  sources.push(await ingestBreaches());

  const totalUpserted = sources.reduce((n, s) => n + s.upserted, 0);
  const ok = sources.every((s) => s.ok);

  void recordAudit({
    action: AUDIT_ACTIONS.DATA_AEGIS_INGESTED,
    outcome: ok ? 'success' : 'failure',
    targetKind: 'aegis_ingest',
    targetId: 'cron',
    details: { totalUpserted, sources },
  });

  // Best-effort real-time nudge: publish one refresh per changed source so the
  // WS-server bridge can fan it out to clients. Never throws / never affects the
  // return value (Rule #9 spirit).
  await publishIngestNudges(sources);

  return { ok, totalUpserted, sources };
}
