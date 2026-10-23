#!/usr/bin/env tsx
/**
 * Phase 11.A.2 — NVD bulk historical backfill.
 *
 * Pulls 2-3 years of CVE history from NVD REST 2.0 + the CISA KEV catalog
 * into our local aegis_cves + aegis_kev + aegis_cve_severity_history
 * tables, giving the Phase 11.B logistic-regression trainer and the
 * Phase 11.C HMM trainer a real historical training set instead of the
 * 8-CVE seed.
 *
 * Usage:
 *   npx tsx scripts/backfill-nvd-history.ts                  # default: 3 years
 *   npx tsx scripts/backfill-nvd-history.ts --years=2
 *   npx tsx scripts/backfill-nvd-history.ts --start-date=2022-01-01
 *   npx tsx scripts/backfill-nvd-history.ts --skip-kev       # CVE pass only
 *   npx tsx scripts/backfill-nvd-history.ts --dry-run        # parse + print, no DB writes
 *   NVD_API_KEY=xxxx npx tsx scripts/backfill-nvd-history.ts # 10x faster
 *
 * Architecture:
 *
 *   1. Walk the requested date range in 120-day buckets (NVD's max range
 *      per request).
 *   2. Within each bucket, paginate via startIndex up to totalResults.
 *      resultsPerPage=2000 (NVD's max).
 *   3. For each CVE row in a page: UPSERT into aegis_cves; if it was a
 *      NEW insert (xmax = 0), emit `published` severity_history event
 *      tied to the actual NVD publish date — that's the HMM's "Discovered"
 *      state observation.
 *   4. Per-page JSON cached to data/training/nvd/ git-ignored — re-runs
 *      skip pages already on disk.
 *   5. After all NVD pages: pull CISA KEV JSON; UPSERT aegis_kev; UPDATE
 *      aegis_cves.is_kev = true + kev_added_date; emit `kev_added` event
 *      keyed to the dateAdded. Idempotency via SELECT-then-emit.
 *
 * Rate limits:
 *   - NVD_API_KEY unset: ~5 req/30s → ~6s pause between requests
 *   - NVD_API_KEY set:   ~50 req/30s → ~0.7s pause between requests
 *
 * Wall-clock budget for 3 years:
 *   - Without API key: 30-60 min (≈40 pages × 6s rate-limit pause)
 *   - With API key:    3-5 min   (same 40 pages × 0.7s pause)
 *
 * Bail-loud: exit 1 on:
 *   - First-attempt fetch returning non-200 + non-429
 *   - JSON parse failure on a NVD response
 *   - DB connection failure
 *
 * 429 responses are handled via exponential backoff (up to 4 retries with
 * 30s/60s/120s/240s sleeps). After 4 retries we bail.
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from '@/lib/db/migrate-utils';

// Boot: load .env.local FIRST so process.env.DATABASE_URL is populated
// before we touch any module that initializes a pg Pool at import time.
loadEnv(resolve(__dirname, '..'));

// Dynamic imports — these modules read DATABASE_URL at module-load time
// to construct their pg Pool. Static imports are hoisted to run BEFORE
// `loadEnv` above, which leaves password=undefined and breaks SCRAM auth.
type QueryFn = typeof import('@/lib/db/client').query;
type EmitFn = typeof import('@/lib/aegis/severity-history-emitter').emitSeverityEvent;
let query!: QueryFn;
let emitSeverityEvent!: EmitFn;
async function initDb(): Promise<void> {
  const dbClient = await import('@/lib/db/client');
  const emitter = await import('@/lib/aegis/severity-history-emitter');
  query = dbClient.query;
  emitSeverityEvent = emitter.emitSeverityEvent;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const USER_AGENT = 'CocoaAI-ThreatDeck-Backfill/1.0';
const PAGE_SIZE = 2000; // NVD max
// NVD docs say "max 120 days" but the actual implementation rejects requests
// where pubEndDate - pubStartDate >= 120 days (with our 23:59:59.999 end
// timestamp, a 120-day delta is 120.999d which NVD treats as >120 → 404).
// 119 days is the empirically safe upper bound.
const BUCKET_DAYS = 119;
const CACHE_DIR = resolve(__dirname, '..', 'data', 'training', 'nvd');

// Rate-limit pauses (ms). NVD docs: 5 req / 30s without key, 50 req / 30s with.
// We pad conservatively so a long-running backfill doesn't hit a rolling window.
const RATE_PAUSE_NO_KEY = 6_500;
const RATE_PAUSE_WITH_KEY = 750;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CliArgs {
  years: number;
  startDate: string | null;
  skipKev: boolean;
  skipNvd: boolean;
  dryRun: boolean;
}

interface NvdResponse {
  resultsPerPage: number;
  startIndex: number;
  totalResults: number;
  vulnerabilities: Array<{
    cve: {
      id: string;
      published: string;
      lastModified: string;
      descriptions?: Array<{ lang: string; value: string }>;
      weaknesses?: Array<{ description?: Array<{ lang: string; value: string }> }>;
      metrics?: {
        cvssMetricV31?: Array<{
          cvssData: { baseScore?: number; vectorString?: string; baseSeverity?: string };
        }>;
        cvssMetricV30?: Array<{
          cvssData: { baseScore?: number; vectorString?: string; baseSeverity?: string };
        }>;
      };
    };
  }>;
}

interface KevEntry {
  cveID: string;
  dateAdded: string;
  dueDate?: string;
  requiredAction?: string;
  vulnerabilityName?: string;
  vendorProject?: string;
  product?: string;
  shortDescription?: string;
  knownRansomwareCampaignUse?: string;
}

interface KevResponse {
  vulnerabilities?: KevEntry[];
}

interface BackfillStats {
  cvesInserted: number;
  cvesUpdated: number;
  publishedEventsEmitted: number;
  kevsInserted: number;
  kevsUpdated: number;
  kevAddedEventsEmitted: number;
  cacheHits: number;
  apiRequests: number;
  errors: string[];
}

// ─── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = {
    years: 3,
    startDate: null,
    skipKev: false,
    skipNvd: false,
    dryRun: false,
  };
  for (const a of args) {
    if (a.startsWith('--years=')) {
      const n = Number.parseInt(a.slice('--years='.length), 10);
      if (Number.isFinite(n) && n > 0 && n <= 10) out.years = n;
    } else if (a.startsWith('--start-date=')) {
      out.startDate = a.slice('--start-date='.length);
    } else if (a === '--skip-kev') out.skipKev = true;
    else if (a === '--skip-nvd') out.skipNvd = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      console.error(`[backfill] unknown arg: ${a}`);
      printUsage();
      process.exit(1);
    }
  }
  return out;
}

function printUsage(): void {
  console.log(`Usage:
  npx tsx scripts/backfill-nvd-history.ts [options]

Options:
  --years=N           Number of years to backfill (1-10, default 3)
  --start-date=YYYY-MM-DD  Explicit start date (overrides --years)
  --skip-nvd          Skip the NVD pass (KEV only)
  --skip-kev          Skip the KEV pass (NVD only)
  --dry-run           Parse + print but make NO database writes
  -h, --help          Print this message and exit

Environment:
  NVD_API_KEY         Optional. With key: ~50 req/30s. Without: ~5 req/30s.
`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Initialize DB modules AFTER loadEnv has populated process.env.
  await initDb();

  const args = parseArgs();
  const apiKey = process.env.NVD_API_KEY ?? null;
  const start = Date.now();
  const stats: BackfillStats = {
    cvesInserted: 0,
    cvesUpdated: 0,
    publishedEventsEmitted: 0,
    kevsInserted: 0,
    kevsUpdated: 0,
    kevAddedEventsEmitted: 0,
    cacheHits: 0,
    apiRequests: 0,
    errors: [],
  };

  console.log('━'.repeat(72));
  console.log('Phase 11.A.2 — NVD historical backfill');
  console.log('━'.repeat(72));
  console.log(`Years:        ${args.startDate ? `(from ${args.startDate})` : args.years}`);
  console.log(`API key:      ${apiKey ? 'set (fast path)' : 'unset (slow path)'}`);
  console.log(`Dry run:      ${args.dryRun}`);
  console.log(`Skip NVD:     ${args.skipNvd}`);
  console.log(`Skip KEV:     ${args.skipKev}`);
  console.log(`Cache dir:    ${CACHE_DIR}`);
  console.log('');

  await mkdir(CACHE_DIR, { recursive: true });

  // ─── NVD pass ─────────────────────────────────────────────────────────────
  if (!args.skipNvd) {
    const startDate = args.startDate
      ? new Date(args.startDate)
      : new Date(Date.now() - args.years * 365 * 24 * 60 * 60 * 1000);
    const endDate = new Date();
    console.log(`[nvd] Window: ${fmtDate(startDate)} → ${fmtDate(endDate)}`);

    const buckets = buildDateBuckets(startDate, endDate, BUCKET_DAYS);
    console.log(`[nvd] ${buckets.length} buckets (≤${BUCKET_DAYS}d each)`);
    console.log('');

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]!;
      console.log(
        `[nvd] bucket ${i + 1}/${buckets.length}  ${fmtDate(bucket.start)} → ${fmtDate(bucket.end)}`,
      );
      await processBucket(bucket, apiKey, args.dryRun, stats);
    }
  } else {
    console.log('[nvd] (skipped via --skip-nvd)');
  }

  // ─── KEV pass ─────────────────────────────────────────────────────────────
  if (!args.skipKev) {
    console.log('');
    console.log('[kev] fetching CISA KEV catalog');
    await processKev(args.dryRun, stats);
  } else {
    console.log('[kev] (skipped via --skip-kev)');
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const elapsedSec = Math.round((Date.now() - start) / 1000);
  console.log('');
  console.log('━'.repeat(72));
  console.log('Summary');
  console.log('━'.repeat(72));
  console.log(`CVEs inserted:           ${stats.cvesInserted}`);
  console.log(`CVEs updated:            ${stats.cvesUpdated}`);
  console.log(`published events:        ${stats.publishedEventsEmitted}`);
  console.log(`KEV rows inserted:       ${stats.kevsInserted}`);
  console.log(`KEV rows updated:        ${stats.kevsUpdated}`);
  console.log(`kev_added events:        ${stats.kevAddedEventsEmitted}`);
  console.log(`Cache hits:              ${stats.cacheHits}`);
  console.log(`API requests:            ${stats.apiRequests}`);
  console.log(`Errors:                  ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    for (const e of stats.errors.slice(0, 10)) console.log(`   ${e}`);
    if (stats.errors.length > 10) console.log(`   …and ${stats.errors.length - 10} more`);
  }
  console.log(`Wall-clock:              ${elapsedSec}s`);
  console.log('');

  // Exit non-zero ONLY on fatal-class errors. KEV FK violations are expected
  // for out-of-window CVEs (e.g., the CISA KEV catalog has 20 years of
  // history; we only backfill 3) — those are "correct skips," not failures.
  // Distinguish by filtering FK-violation errors out of the failure count.
  const fkSkips = stats.errors.filter((e) => /foreign key constraint/i.test(e)).length;
  const fatalErrors = stats.errors.length - fkSkips;
  if (fkSkips > 0) {
    console.log(
      `[backfill] note: ${fkSkips} KEV FK skips (out-of-window CVEs) — expected, not a failure`,
    );
  }
  if (fatalErrors > Math.max(10, stats.apiRequests * 0.1)) {
    console.error(`[backfill] ${fatalErrors} non-FK errors — exit 1`);
    process.exit(1);
  }
  process.exit(0);
}

// ─── NVD bucket processing ───────────────────────────────────────────────────

interface DateBucket {
  start: Date;
  end: Date;
}

function buildDateBuckets(start: Date, end: Date, days: number): DateBucket[] {
  const buckets: DateBucket[] = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(cursor.getTime() + days * 24 * 60 * 60 * 1000);
    buckets.push({ start: new Date(cursor), end: next > end ? end : new Date(next) });
    cursor = next;
  }
  return buckets;
}

async function processBucket(
  bucket: DateBucket,
  apiKey: string | null,
  dryRun: boolean,
  stats: BackfillStats,
): Promise<void> {
  let startIndex = 0;
  let totalResults = -1; // unknown until first response
  let pageNum = 0;

  while (totalResults < 0 || startIndex < totalResults) {
    pageNum++;
    const cacheFile = pageCacheFile(bucket, startIndex);
    let json: NvdResponse;

    if (await fileExists(cacheFile)) {
      json = JSON.parse(await readFile(cacheFile, 'utf8')) as NvdResponse;
      stats.cacheHits++;
    } else {
      json = await fetchNvdPage(bucket, startIndex, apiKey, stats);
      await writeFile(cacheFile, JSON.stringify(json));
    }

    if (totalResults < 0) totalResults = json.totalResults ?? 0;
    const items = json.vulnerabilities ?? [];
    console.log(
      `   page ${pageNum} startIndex=${startIndex} got ${items.length}  total=${totalResults}`,
    );

    if (!dryRun) {
      for (const wrap of items) {
        await upsertCve(wrap.cve, stats);
      }
    }

    startIndex += json.resultsPerPage ?? PAGE_SIZE;
    if (items.length === 0) break; // safety: stop if NVD returns empty mid-bucket
  }
}

function pageCacheFile(bucket: DateBucket, startIndex: number): string {
  const a = fmtDate(bucket.start);
  const b = fmtDate(bucket.end);
  return resolve(CACHE_DIR, `${a}__${b}__${startIndex}.json`);
}

async function fetchNvdPage(
  bucket: DateBucket,
  startIndex: number,
  apiKey: string | null,
  stats: BackfillStats,
): Promise<NvdResponse> {
  const url = new URL(NVD_BASE);
  url.searchParams.set('pubStartDate', `${fmtDate(bucket.start)}T00:00:00.000`);
  url.searchParams.set('pubEndDate', `${fmtDate(bucket.end)}T23:59:59.999`);
  url.searchParams.set('resultsPerPage', String(PAGE_SIZE));
  url.searchParams.set('startIndex', String(startIndex));

  const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
  if (apiKey) headers.apiKey = apiKey;
  const pauseMs = apiKey ? RATE_PAUSE_WITH_KEY : RATE_PAUSE_NO_KEY;

  // Exponential-backoff loop for transient failures. Three classes retry here:
  //   1. HTTP 429 — explicit NVD throttle
  //   2. HTTP 503 — Cloudflare upstream blip
  //   3. Network errors (EHOSTUNREACH, ECONNRESET, ETIMEDOUT, fetch failed) —
  //      the local network or the route between us and NVD blipped
  // After 4 attempts (sleeps: 30s, 60s, 120s, 240s) we bail-loud.
  let attempt = 0;
  while (true) {
    attempt++;
    stats.apiRequests++;
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers, cache: 'no-store' });
    } catch (err) {
      // Network-level error — treat like 503 and retry. node:undici wraps the
      // OS error in a TypeError('fetch failed') with .cause carrying the real
      // errno. Log the inner cause for clarity.
      const cause = (err as { cause?: { code?: string; errno?: number } }).cause;
      const code = cause?.code ?? 'unknown';
      const backoffMs = Math.min(30_000 * 2 ** (attempt - 1), 240_000);
      console.warn(
        `   [nvd] network error (${code}) on attempt ${attempt}, sleeping ${backoffMs / 1000}s`,
      );
      if (attempt >= 4) {
        throw new Error(
          `[nvd] network error (${code}) after 4 retries on ${url.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      await sleep(backoffMs);
      continue;
    }

    if (res.status === 429 || res.status === 503) {
      const backoffMs = Math.min(30_000 * 2 ** (attempt - 1), 240_000);
      console.warn(`   [nvd] ${res.status} on attempt ${attempt}, sleeping ${backoffMs / 1000}s`);
      if (attempt >= 4) {
        throw new Error(`[nvd] ${res.status} after 4 retries on ${url.toString()}`);
      }
      await sleep(backoffMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`[nvd] ${res.status} on ${url.toString()}: ${await res.text()}`);
    }

    // Polite pause AFTER the request so the next bucket call respects the
    // rolling-window limit.
    await sleep(pauseMs);

    try {
      return (await res.json()) as NvdResponse;
    } catch (err) {
      throw new Error(`[nvd] JSON parse failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ─── CVE row helpers ─────────────────────────────────────────────────────────

async function upsertCve(
  item: NvdResponse['vulnerabilities'][number]['cve'],
  stats: BackfillStats,
): Promise<void> {
  const v31 = item.metrics?.cvssMetricV31?.[0];
  const v30 = item.metrics?.cvssMetricV30?.[0];
  const score = v31?.cvssData?.baseScore ?? v30?.cvssData?.baseScore ?? null;
  const vector = v31?.cvssData?.vectorString ?? v30?.cvssData?.vectorString ?? null;
  const severity = mapSeverity(v31?.cvssData?.baseSeverity ?? v30?.cvssData?.baseSeverity, score);
  const summary = pickEnglish(item.descriptions);
  const cwe = pickCwe(item.weaknesses);

  // Use xmax = 0 to detect a fresh INSERT (vs UPDATE). xmax is 0 for newly-
  // inserted rows that no transaction has yet modified.
  try {
    const { rows } = await query<{ inserted: boolean }>(
      `INSERT INTO aegis_cves
         (cve_id, published_at, last_modified_at, summary, cwe_id,
          cvss_v3_score, cvss_v3_vector, severity, nvd_source_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (cve_id) DO UPDATE
         SET last_modified_at = EXCLUDED.last_modified_at,
             summary          = EXCLUDED.summary,
             cwe_id           = EXCLUDED.cwe_id,
             cvss_v3_score    = EXCLUDED.cvss_v3_score,
             cvss_v3_vector   = EXCLUDED.cvss_v3_vector,
             severity         = EXCLUDED.severity
       RETURNING (xmax = 0) AS inserted`,
      [
        item.id,
        item.published,
        item.lastModified,
        summary,
        cwe,
        score,
        vector,
        severity,
        `https://nvd.nist.gov/vuln/detail/${item.id}`,
      ],
    );
    const isNew = rows[0]?.inserted === true;
    if (isNew) {
      stats.cvesInserted++;
      // Emit `published` event tied to the actual NVD publish date — that's
      // the HMM's "Discovered" state observation. emitSeverityEvent is
      // fail-soft so a FK violation here (shouldn't happen since we just
      // inserted) won't crash the run.
      const result = await emitSeverityEvent({
        cveId: item.id,
        eventType: 'published',
        observedAt: item.published,
        cvssScore: score ?? undefined,
        source: 'nvd_backfill',
      });
      if (result.ok) stats.publishedEventsEmitted++;
    } else {
      stats.cvesUpdated++;
    }
  } catch (err) {
    stats.errors.push(`upsert ${item.id}: ${err instanceof Error ? err.message : err}`);
  }
}

function mapSeverity(
  raw: string | undefined,
  score: number | null,
): 'critical' | 'high' | 'medium' | 'low' | null {
  if (raw) {
    const s = raw.toLowerCase();
    if (s === 'critical') return 'critical';
    if (s === 'high') return 'high';
    if (s === 'medium') return 'medium';
    if (s === 'low') return 'low';
  }
  if (score == null) return null;
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  if (score > 0) return 'low';
  return null;
}

function pickEnglish(
  descriptions: NvdResponse['vulnerabilities'][number]['cve']['descriptions'],
): string | null {
  if (!descriptions) return null;
  const en = descriptions.find((d) => d.lang === 'en');
  return en?.value ?? null;
}

function pickCwe(
  weaknesses: NvdResponse['vulnerabilities'][number]['cve']['weaknesses'],
): string | null {
  if (!weaknesses) return null;
  for (const w of weaknesses) {
    const en = w.description?.find((d) => d.lang === 'en');
    if (en?.value?.startsWith('CWE-')) return en.value;
  }
  return null;
}

// ─── KEV pass ────────────────────────────────────────────────────────────────

async function processKev(dryRun: boolean, stats: BackfillStats): Promise<void> {
  const cacheFile = resolve(CACHE_DIR, '..', 'kev.json');
  let kevs: KevEntry[];

  if (await fileExists(cacheFile)) {
    const json = JSON.parse(await readFile(cacheFile, 'utf8')) as KevResponse;
    kevs = json.vulnerabilities ?? [];
    stats.cacheHits++;
    console.log(`[kev] cache hit  ${kevs.length} entries`);
  } else {
    console.log('[kev] downloading from CISA');
    const res = await fetch(KEV_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
    });
    stats.apiRequests++;
    if (!res.ok) {
      throw new Error(`[kev] ${res.status} on ${KEV_URL}`);
    }
    const json = (await res.json()) as KevResponse;
    kevs = json.vulnerabilities ?? [];
    await writeFile(cacheFile, JSON.stringify(json));
    console.log(`[kev] downloaded  ${kevs.length} entries`);
  }

  if (dryRun) {
    console.log('[kev] (dry-run, skipping DB writes)');
    return;
  }

  let i = 0;
  for (const kev of kevs) {
    i++;
    if (i % 200 === 0) console.log(`   [kev] processed ${i}/${kevs.length}`);
    if (!kev.cveID || !kev.dateAdded) continue;

    try {
      // UPSERT into aegis_kev. Note: aegis_kev's PK is (cve_id, added_to_kev_at)
      // pattern from earlier inspection — we let ON CONFLICT handle it.
      const kevResult = await query<{ inserted: boolean }>(
        `INSERT INTO aegis_kev
           (cve_id, added_to_kev_at, due_date, required_action, vulnerability_name,
            vendor_project, product, short_description, known_ransomware_use)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (cve_id) DO UPDATE
           SET due_date          = EXCLUDED.due_date,
               required_action   = EXCLUDED.required_action,
               vulnerability_name = EXCLUDED.vulnerability_name,
               vendor_project    = EXCLUDED.vendor_project,
               product           = EXCLUDED.product,
               short_description = EXCLUDED.short_description,
               known_ransomware_use = EXCLUDED.known_ransomware_use
         RETURNING (xmax = 0) AS inserted`,
        [
          kev.cveID,
          kev.dateAdded,
          kev.dueDate ?? null,
          kev.requiredAction ?? null,
          kev.vulnerabilityName ?? null,
          kev.vendorProject ?? null,
          kev.product ?? null,
          kev.shortDescription ?? null,
          kev.knownRansomwareCampaignUse ?? null,
        ],
      );
      if (kevResult.rows[0]?.inserted) stats.kevsInserted++;
      else stats.kevsUpdated++;

      // Flip aegis_cves.is_kev so consumers (e.g. aegis_v_top_likely_exploits)
      // see the KEV status. FK guarantees aegis_cves row exists.
      await query(
        `UPDATE aegis_cves
            SET is_kev = TRUE,
                kev_added_date = $1
          WHERE cve_id = $2 AND (is_kev = FALSE OR kev_added_date IS NULL)`,
        [kev.dateAdded, kev.cveID],
      );

      // Emit kev_added event ONLY if not already emitted for this CVE+date.
      // Idempotency: backfill should not double-emit on re-run.
      const exists = await query(
        `SELECT 1 FROM aegis_cve_severity_history
           WHERE cve_id = $1
             AND event_type = 'kev_added'
             AND SUBSTRING(observed_at FROM 1 FOR 10) = $2
           LIMIT 1`,
        [kev.cveID, kev.dateAdded.slice(0, 10)],
      );
      if (exists.rows.length === 0) {
        const result = await emitSeverityEvent({
          cveId: kev.cveID,
          eventType: 'kev_added',
          observedAt: kev.dateAdded,
          source: 'nvd_backfill_kev',
        });
        if (result.ok) stats.kevAddedEventsEmitted++;
      }
    } catch (err) {
      stats.errors.push(`kev ${kev.cveID}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
