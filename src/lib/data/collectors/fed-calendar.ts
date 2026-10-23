import { safeFetch } from '@/lib/security/safe-fetch';
import type { FedCalendarEvent, FedData } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';
import { fetchFedData } from './fed';

const FRED_RELEASES_URL = 'https://api.stlouisfed.org/fred/releases/dates';
const API_KEY = () => process.env.FRED_API_KEY;

// Fail fast on a slow/hung FRED edge so the calendar route never blocks (mirrors fed.ts).
const FRED_TIMEOUT_MS = 6000;
// Long-lived last-known-good release schedule, served during a FRED outage.
const CAL_LASTGOOD_KEY = 'fed-calendar:lastgood:v3';
const CAL_LASTGOOD_TTL_SECONDS = 604_800; // 7 days

const FINNHUB_CALENDAR_URL = 'https://finnhub.io/api/v1/calendar/economic';
const FINNHUB_API_KEY = () => process.env.FINNHUB_API_KEY;

// ─── Release Whitelist ───
// Only these FRED releases are shown. Keyed by FRED release_id.
// `names` are substring-match patterns used as fallback when release_id doesn't match.

interface WhitelistedRelease {
  names: string[];
  impact: 'HIGH' | 'MEDIUM';
  time: string;
  category: string;
}

const RELEASE_WHITELIST: Record<number, WhitelistedRelease> = {
  // ── Employment ──
  50: {
    names: ['Employment Situation'],
    impact: 'HIGH',
    time: '8:30 AM ET',
    category: 'Employment',
  },
  308: {
    names: ['Unemployment Insurance Weekly Claims'],
    impact: 'HIGH',
    time: '8:30 AM ET',
    category: 'Employment',
  },
  175: {
    names: ['Job Openings and Labor Turnover'],
    impact: 'MEDIUM',
    time: '10:00 AM ET',
    category: 'Employment',
  },
  331: {
    names: ['ADP'],
    impact: 'MEDIUM',
    time: '8:15 AM ET',
    category: 'Employment',
  },

  // ── Inflation ──
  10: {
    names: ['Consumer Price Index'],
    impact: 'HIGH',
    time: '8:30 AM ET',
    category: 'Inflation',
  },
  46: {
    names: ['Producer Price Index'],
    impact: 'HIGH',
    time: '8:30 AM ET',
    category: 'Inflation',
  },
  54: {
    names: ['Personal Income and Outlays'],
    impact: 'HIGH',
    time: '8:30 AM ET',
    category: 'Inflation',
  },
  82: {
    names: ['Import', 'Export Price'],
    impact: 'MEDIUM',
    time: '8:30 AM ET',
    category: 'Inflation',
  },

  // ── Growth ──
  53: {
    names: ['Gross Domestic Product'],
    impact: 'HIGH',
    time: '8:30 AM ET',
    category: 'Growth',
  },
  95: {
    names: ['Advance Monthly Sales', 'Retail and Food'],
    impact: 'MEDIUM',
    time: '8:30 AM ET',
    category: 'Growth',
  },
  13: {
    names: ['Industrial Production'],
    impact: 'MEDIUM',
    time: '9:15 AM ET',
    category: 'Growth',
  },
  86: {
    names: ['Durable Goods', 'Manufacturers'],
    impact: 'MEDIUM',
    time: '8:30 AM ET',
    category: 'Growth',
  },

  // ── Housing ──
  11: {
    names: ['New Residential Construction'],
    impact: 'MEDIUM',
    time: '8:30 AM ET',
    category: 'Housing',
  },
  15: {
    names: ['Existing Home Sales'],
    impact: 'MEDIUM',
    time: '10:00 AM ET',
    category: 'Housing',
  },
  142: {
    names: ['New Residential Sales', 'New Home Sales'],
    impact: 'MEDIUM',
    time: '10:00 AM ET',
    category: 'Housing',
  },

  // ── Consumer ──
  101: {
    names: ['Consumer Confidence'],
    impact: 'MEDIUM',
    time: '10:00 AM ET',
    category: 'Consumer',
  },
  83: {
    names: ['University of Michigan', 'Consumer Sentiment'],
    impact: 'MEDIUM',
    time: '10:00 AM ET',
    category: 'Consumer',
  },

  // ── Manufacturing ──
  103: {
    names: ['ISM Manufacturing', 'ISM Report'],
    impact: 'HIGH',
    time: '10:00 AM ET',
    category: 'Manufacturing',
  },
  206: {
    names: ['ISM Non-Manufacturing', 'ISM Services'],
    impact: 'MEDIUM',
    time: '10:00 AM ET',
    category: 'Manufacturing',
  },

  // ── Fed ──
  21: {
    names: ['Federal Open Market Committee', 'FOMC'],
    impact: 'HIGH',
    time: '2:00 PM ET',
    category: 'Fed',
  },
  52: {
    names: ['Beige Book', 'Summary of Commentary'],
    impact: 'MEDIUM',
    time: '2:00 PM ET',
    category: 'Fed',
  },

  // ── Trade ──
  51: {
    names: ['International Trade', 'Trade in Goods'],
    impact: 'MEDIUM',
    time: '8:30 AM ET',
    category: 'Trade',
  },
  125: {
    names: ['Current Account'],
    impact: 'MEDIUM',
    time: '8:30 AM ET',
    category: 'Trade',
  },
};

// ─── Whitelist Matcher ───

function matchWhitelist(releaseId: number, releaseName: string): WhitelistedRelease | null {
  // Pass 1: exact ID match
  const byId = RELEASE_WHITELIST[releaseId];
  if (byId) return byId;

  // Pass 2: name substring match against all whitelist entries
  const lowerName = releaseName.toLowerCase();
  for (const entry of Object.values(RELEASE_WHITELIST)) {
    if (entry.names.some((n) => lowerName.includes(n.toLowerCase()))) {
      return entry;
    }
  }

  return null;
}

// ─── FRED → Finnhub Event Name Mapping ───
// Maps FRED release names to Finnhub `event` field search terms.

const FINNHUB_EVENT_MAP: Record<string, string[]> = {
  'Employment Situation': [
    'Nonfarm Payrolls',
    'Non-Farm Payrolls',
    'Non Farm Payrolls',
    'Unemployment Rate',
  ],
  'Consumer Price Index': ['CPI', 'Consumer Price Index'],
  'Gross Domestic Product': ['GDP', 'Gross Domestic Product'],
  'Federal Open Market Committee': ['Fed Interest Rate Decision', 'FOMC', 'Federal Funds Rate'],
  'Personal Income and Outlays': [
    'PCE Price Index',
    'Core PCE Price Index',
    'Personal Income',
    'Personal Spending',
  ],
  'Producer Price Index': ['PPI', 'Producer Price Index'],
  'Retail Sales': ['Retail Sales'],
  'Advance Monthly Sales for Retail and Food Services': ['Retail Sales'],
  'Industrial Production and Capacity Utilization': ['Industrial Production'],
  'Housing Starts': ['Housing Starts', 'Building Permits'],
  'New Residential Construction': ['Housing Starts', 'Building Permits'],
  'Consumer Confidence': ['CB Consumer Confidence', 'Consumer Confidence'],
  'University of Michigan': ['Michigan Consumer Sentiment', 'Consumer Sentiment'],
  'ISM Manufacturing': ['ISM Manufacturing PMI', 'ISM Manufacturing'],
  'International Trade in Goods and Services': ['Trade Balance', 'Balance of Trade'],
  'Durable Goods': ['Durable Goods Orders'],
  'Unemployment Insurance Weekly Claims': ['Initial Jobless Claims', 'Continuing Jobless Claims'],
  'Job Openings and Labor Turnover': ['JOLTs Job Openings', 'JOLTS'],
  'Import/Export Prices': ['Import Prices', 'Export Prices'],
  'ISM Non-Manufacturing': ['ISM Non-Manufacturing PMI', 'ISM Services PMI'],
  'Existing Home Sales': ['Existing Home Sales'],
  'New Residential Sales': ['New Home Sales'],
  'Beige Book': ['Beige Book'],
  'Current Account': ['Current Account'],
  'ADP National Employment Report': ['ADP Nonfarm Employment', 'ADP Employment'],
};

// ─── Finnhub Types ───

interface FinnhubCalendarEvent {
  actual: number | null;
  country: string;
  estimate: number | null;
  event: string;
  impact: string; // "high" | "medium" | "low"
  prev: number | null;
  time: string; // "YYYY-MM-DD HH:MM:SS"
  unit: string; // e.g. "%", "K", "B", "index"
}

interface FinnhubCalendarResponse {
  economicCalendar: FinnhubCalendarEvent[];
}

// ─── Finnhub Enrichment ───

async function fetchFinnhubCalendar(
  startDate: string,
  endDate: string,
): Promise<FinnhubCalendarEvent[]> {
  const apiKey = FINNHUB_API_KEY();
  if (!apiKey) return [];

  if (!checkRateLimit('finnhub_calendar')) return [];

  try {
    const url = `${FINNHUB_CALENDAR_URL}?from=${startDate}&to=${endDate}`;
    const res = await safeFetch(url, {
      headers: { 'X-Finnhub-Token': apiKey },
      next: { revalidate: 1800 },
      // Hard cap: Finnhub has hung for 60s+ in the wild → never block the route.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[FedCalendar] Finnhub API returned ${res.status}:`,
        body.slice(0, 200) || '(no body)',
      );
      return [];
    }
    const data: FinnhubCalendarResponse = await res.json();
    if (!data.economicCalendar || !Array.isArray(data.economicCalendar)) return [];
    // Filter to US events only
    return data.economicCalendar.filter((e) => e.country === 'US');
  } catch (error) {
    console.warn(
      '[FedCalendar] Finnhub fetch failed:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

function finnhubImpactToImpact(impact: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  const lower = impact.toLowerCase();
  if (lower === 'high') return 'HIGH';
  if (lower === 'medium') return 'MEDIUM';
  return 'LOW';
}

function formatFinnhubValue(value: number | null, unit: string): string | null {
  if (value === null) return null;
  // Append unit suffix for common cases
  if (unit === '%') return `${value}%`;
  if (unit === 'K' || unit === 'k') return `${value}K`;
  if (unit === 'B' || unit === 'b') return `${value}B`;
  if (unit === 'M' || unit === 'm') return `${value}M`;
  if (unit === 'T' || unit === 't') return `${value}T`;
  if (unit) return `${value} ${unit}`;
  return `${value}`;
}

function parseFinnhubTime(timeStr: string): string | null {
  // Finnhub time format: "YYYY-MM-DD HH:MM:SS" (UTC)
  const parts = timeStr.split(' ');
  const timePart = parts[1];
  if (!timePart) return null;

  const [hours, minutes] = timePart.split(':');
  if (!hours || !minutes) return null;

  let h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  // Convert UTC to ET (approximate: UTC-5 EST, UTC-4 EDT)
  // Use -5 as default (EST) — close enough for display purposes
  h = h - 5;
  if (h < 0) h += 24;

  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm} ET`;
}

function matchFinnhubEvent(
  fredName: string,
  fredDate: string,
  finnhubEvents: FinnhubCalendarEvent[],
): FinnhubCalendarEvent | null {
  // Filter Finnhub events to same date
  const sameDateEvents = finnhubEvents.filter((fh) => {
    const fhDate = fh.time.split(' ')[0];
    return fhDate === fredDate;
  });

  if (sameDateEvents.length === 0) return null;

  // Try exact name map first
  const mappedTerms = FINNHUB_EVENT_MAP[fredName];
  if (mappedTerms) {
    const matches = sameDateEvents.filter((fh) =>
      mappedTerms.some(
        (term) =>
          fh.event.toLowerCase().includes(term.toLowerCase()) ||
          term.toLowerCase().includes(fh.event.toLowerCase()),
      ),
    );
    if (matches.length > 0) {
      // Prefer events with actual data, then highest impact
      const withActual = matches.filter((m) => m.actual !== null);
      if (withActual.length > 0) return withActual[0]!;
      return matches[0]!;
    }
  }

  // Fuzzy fallback: check if FRED name words appear in Finnhub event name
  const fredWords = fredName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const fuzzyMatches = sameDateEvents.filter((fh) => {
    const evt = fh.event.toLowerCase();
    return fredWords.some((word) => evt.includes(word));
  });

  if (fuzzyMatches.length > 0) {
    const withActual = fuzzyMatches.filter((m) => m.actual !== null);
    if (withActual.length > 0) return withActual[0]!;
    return fuzzyMatches[0]!;
  }

  return null;
}

function computeSurprise(
  actual: number | null,
  estimate: number | null,
): { surprise: number | null; surprisePercent: number | null } {
  if (actual === null || estimate === null) {
    return { surprise: null, surprisePercent: null };
  }
  const surprise = actual - estimate;
  const surprisePercent = estimate !== 0 ? ((actual - estimate) / Math.abs(estimate)) * 100 : null;
  return {
    surprise: Math.round(surprise * 1000) / 1000,
    surprisePercent: surprisePercent !== null ? Math.round(surprisePercent * 100) / 100 : null,
  };
}

function enrichWithFinnhub(
  events: FedCalendarEvent[],
  finnhubEvents: FinnhubCalendarEvent[],
): FedCalendarEvent[] {
  return events.map((event) => {
    const fhMatch = matchFinnhubEvent(event.releaseName, event.date, finnhubEvents);
    if (!fhMatch) return event;

    const { surprise, surprisePercent } = computeSurprise(fhMatch.actual, fhMatch.estimate);
    const finnhubTime = parseFinnhubTime(fhMatch.time);

    return {
      ...event,
      actual: formatFinnhubValue(fhMatch.actual, fhMatch.unit),
      previous: formatFinnhubValue(fhMatch.prev, fhMatch.unit),
      forecast: formatFinnhubValue(fhMatch.estimate, fhMatch.unit),
      unit: fhMatch.unit || null,
      surprise,
      surprisePercent,
      // Override time with Finnhub's precise time if available
      time: finnhubTime ?? event.time,
      // Upgrade impact if Finnhub says higher
      impact:
        fhMatch.impact && finnhubImpactToImpact(fhMatch.impact) === 'HIGH' ? 'HIGH' : event.impact,
    };
  });
}

// ─── Inflation YoY Override ───
// CPI and PCE releases show raw index values from Finnhub (e.g., 325.41).
// Override with YoY inflation rates from the fed indicators cache to match
// the Indicators tab display.

const INFLATION_RELEASE_IDS: Record<number, 'cpi' | 'pce'> = {
  10: 'cpi', // Consumer Price Index
  54: 'pce', // Personal Income and Outlays (contains PCE)
};

async function overrideInflationWithYoY(events: FedCalendarEvent[]): Promise<FedCalendarEvent[]> {
  // Try cache first, fall back to fetching fed indicators directly
  const fedCache =
    (await getCached<FedData>('fed:data:v2')) ?? (await fetchFedData(['cpi', 'pce']));
  if (!fedCache) return events;

  return events.map((event) => {
    const indicatorKey = INFLATION_RELEASE_IDS[event.releaseId];
    if (!indicatorKey) return event;

    const indicator = fedCache[indicatorKey];
    if (!indicator) return event;

    // For PCE (release 54): only override raw index values, not MoM % values.
    // Finnhub enriches Personal Income and Outlays with multiple sub-events;
    // MoM percentage changes (unit === '%') should be left alone.
    if (indicatorKey === 'pce' && event.unit === '%') return event;

    // indicator.value is the YoY rate (e.g., 2.90)
    // indicator.change is the MoM acceleration of the YoY rate
    const yoyRate = indicator.value;
    const prevYoyRate = yoyRate - indicator.change;

    const updated: FedCalendarEvent = {
      ...event,
      actual: event.actual != null ? `${yoyRate.toFixed(2)}%` : event.actual,
      previous: event.previous != null ? `${prevYoyRate.toFixed(2)}%` : event.previous,
      invertBeatMiss: true,
    };

    // Null out forecast if it looks like a raw index value (>10, not a percentage)
    if (updated.forecast != null) {
      const forecastNum = Number.parseFloat(updated.forecast.replace(/[^-\d.]/g, ''));
      if (!Number.isNaN(forecastNum) && forecastNum > 10) {
        updated.forecast = null;
      }
    }

    // Recalculate surprise if both actual and forecast are present
    if (updated.actual != null && updated.forecast != null) {
      const actualNum = Number.parseFloat(updated.actual.replace(/[^-\d.]/g, ''));
      const forecastNum = Number.parseFloat(updated.forecast.replace(/[^-\d.]/g, ''));
      if (!Number.isNaN(actualNum) && !Number.isNaN(forecastNum)) {
        const { surprise, surprisePercent } = computeSurprise(actualNum, forecastNum);
        updated.surprise = surprise;
        updated.surprisePercent = surprisePercent;
      }
    } else {
      updated.surprise = null;
      updated.surprisePercent = null;
    }

    return updated;
  });
}

// ─── Fallback Demo Data ───

function getDemoCalendar(): FedCalendarEvent[] {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0]!;

  const offsets = [-3, -1, 0, 0, 1, 2, 3, 5, 7, 10, 12, 14];
  const releases: {
    id: number;
    name: string;
    impact: 'HIGH' | 'MEDIUM';
    time: string;
    category: string;
    previous?: string;
    forecast?: string;
    actual?: string;
    reference?: string;
    surprise?: number;
    surprisePercent?: number;
    invertBeatMiss?: boolean;
  }[] = [
    {
      id: 10,
      name: 'Consumer Price Index',
      impact: 'HIGH',
      time: '8:30 AM ET',
      category: 'Inflation',
      previous: '3.1%',
      forecast: '2.9%',
      actual: '2.8%',
      reference: 'Jan',
      surprise: -0.1,
      surprisePercent: -3.45,
      invertBeatMiss: true,
    },
    {
      id: 50,
      name: 'Employment Situation',
      impact: 'HIGH',
      time: '8:30 AM ET',
      category: 'Employment',
      previous: '142K',
      forecast: '175K',
      actual: '178K',
      reference: 'Jan',
      surprise: 3,
      surprisePercent: 1.71,
    },
    {
      id: 308,
      name: 'Unemployment Insurance Weekly Claims',
      impact: 'HIGH',
      time: '8:30 AM ET',
      category: 'Employment',
      previous: '219K',
      forecast: '215K',
      actual: '213K',
      surprise: -2,
      surprisePercent: -0.93,
    },
    {
      id: 53,
      name: 'Gross Domestic Product',
      impact: 'HIGH',
      time: '8:30 AM ET',
      category: 'Growth',
      previous: '3.2%',
      forecast: '2.8%',
      reference: 'Q4',
    },
    {
      id: 21,
      name: 'Federal Open Market Committee',
      impact: 'HIGH',
      time: '2:00 PM ET',
      category: 'Fed',
      previous: '4.50%',
      forecast: '4.50%',
    },
    {
      id: 46,
      name: 'Producer Price Index',
      impact: 'HIGH',
      time: '8:30 AM ET',
      category: 'Inflation',
      previous: '0.2%',
      forecast: '0.3%',
    },
    {
      id: 103,
      name: 'ISM Manufacturing',
      impact: 'HIGH',
      time: '10:00 AM ET',
      category: 'Manufacturing',
      previous: '49.3',
      forecast: '49.5',
    },
    {
      id: 95,
      name: 'Advance Monthly Sales for Retail and Food Services',
      impact: 'MEDIUM',
      time: '8:30 AM ET',
      category: 'Growth',
      previous: '-0.8%',
      forecast: '0.3%',
      reference: 'Jan',
    },
    {
      id: 13,
      name: 'Industrial Production and Capacity Utilization',
      impact: 'MEDIUM',
      time: '9:15 AM ET',
      category: 'Growth',
      previous: '0.1%',
      forecast: '0.2%',
    },
    {
      id: 11,
      name: 'New Residential Construction',
      impact: 'MEDIUM',
      time: '8:30 AM ET',
      category: 'Housing',
    },
    {
      id: 101,
      name: 'Consumer Confidence',
      impact: 'MEDIUM',
      time: '10:00 AM ET',
      category: 'Consumer',
    },
    {
      id: 175,
      name: 'Job Openings and Labor Turnover Survey',
      impact: 'MEDIUM',
      time: '10:00 AM ET',
      category: 'Employment',
    },
  ];

  return offsets.map((offset, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const dateStr = fmt(d);
    const todayStr = fmt(today);
    const release = releases[i]!;
    return {
      releaseId: release.id,
      releaseName: release.name,
      date: dateStr,
      impact: release.impact,
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
      time: release.time,
      category: release.category,
      previous: release.previous ?? null,
      forecast: release.forecast ?? null,
      actual: release.actual ?? null,
      reference: release.reference ?? null,
      surprise: release.surprise ?? null,
      surprisePercent: release.surprisePercent ?? null,
      invertBeatMiss: release.invertBeatMiss,
    };
  });
}

// ─── Public API ───

/**
 * Fallback when a live FRED calendar fetch is unavailable (outage / rate-limit /
 * missing key). Prefers the last-known-good real release schedule over synthetic
 * demo data; falls back to demo only when no snapshot exists yet.
 */
async function calendarFallback(): Promise<FedCalendarEvent[]> {
  const lastGood = await getCached<FedCalendarEvent[]>(CAL_LASTGOOD_KEY);
  if (lastGood && lastGood.length > 0) return lastGood;
  return getDemoCalendar();
}

export async function fetchFedCalendar(): Promise<FedCalendarEvent[]> {
  const cacheKey = 'fed-calendar:data:v3';
  const cached = await getCached<FedCalendarEvent[]>(cacheKey);
  if (cached) return cached;

  const apiKey = API_KEY();
  if (!apiKey) return calendarFallback();

  if (!checkRateLimit('fred')) return calendarFallback();

  try {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const end = new Date(now);
    end.setDate(end.getDate() + 30);

    const fmt = (d: Date) => d.toISOString().split('T')[0]!;
    const todayStr = fmt(now);

    const url =
      `${FRED_RELEASES_URL}?api_key=${apiKey}` +
      `&file_type=json` +
      `&realtime_start=${fmt(start)}` +
      `&realtime_end=${fmt(end)}` +
      `&include_release_dates_with_no_data=true` +
      `&sort_order=asc`;

    const res = await safeFetch(url, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(FRED_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[FedCalendar] FRED API returned ${res.status}`);
      return calendarFallback();
    }

    const data: FredReleaseDatesResponse = await res.json();
    const entries = data.release_dates ?? [];

    // Deduplicate by release_id + date (FRED can return duplicates)
    const seen = new Set<string>();
    let events: FedCalendarEvent[] = [];

    for (const entry of entries) {
      const key = `${entry.release_id}-${entry.date}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const match = matchWhitelist(entry.release_id, entry.release_name);
      if (!match) continue; // Skip non-whitelisted releases

      events.push({
        releaseId: entry.release_id,
        releaseName: entry.release_name,
        date: entry.date,
        impact: match.impact,
        isToday: entry.date === todayStr,
        isPast: entry.date < todayStr,
        time: match.time,
        category: match.category,
      });
    }

    if (events.length === 0) return calendarFallback();

    // Enrich with Finnhub data if API key is available
    if (FINNHUB_API_KEY()) {
      const finnhubEvents = await fetchFinnhubCalendar(fmt(start), fmt(end));
      if (finnhubEvents.length > 0) {
        events = enrichWithFinnhub(events, finnhubEvents);
      }
    }

    // Override CPI/PCE raw index values with YoY inflation rates from fed cache
    events = await overrideInflationWithYoY(events);

    await setCache(cacheKey, events);
    // Persist a long-lived snapshot so a future FRED outage serves the real
    // release schedule instead of demo data.
    await setCache(CAL_LASTGOOD_KEY, events, CAL_LASTGOOD_TTL_SECONDS);
    return events;
  } catch (error) {
    console.warn(
      '[FedCalendar] Failed to fetch data:',
      error instanceof Error ? error.message : error,
    );
    return calendarFallback();
  }
}

// ─── FRED Response Types ───

interface FredReleaseDate {
  release_id: number;
  release_name: string;
  date: string;
}

interface FredReleaseDatesResponse {
  release_dates?: FredReleaseDate[];
}
