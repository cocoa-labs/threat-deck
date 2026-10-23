import { safeFetch } from '@/lib/security/safe-fetch';
import type { EarningsEvent } from '@/lib/types';
import { checkRateLimit, getCached, setCache } from '../rate-limiter';

const AV_API_KEY = () => process.env.ALPHA_VANTAGE_API_KEY;
const AV_BASE = 'https://www.alphavantage.co/query';

const FINNHUB_API_KEY = () => process.env.FINNHUB_API_KEY;
const FINNHUB_EARNINGS_URL = 'https://finnhub.io/api/v1/calendar/earnings';

// ─── Finnhub Types ───

interface FinnhubEarningsEntry {
  date: string;
  epsActual: number | null;
  epsEstimate: number | null;
  hour: string; // 'bmo' | 'amc' | 'dmh'
  quarter: number;
  revenueActual: number | null;
  revenueEstimate: number | null;
  symbol: string;
  year: number;
}

interface FinnhubEarningsResponse {
  earningsCalendar: FinnhubEarningsEntry[];
}

// ─── Large-Cap Ticker Set ───
// S&P 500 + notable large-caps for O(1) tier classification

const MAJOR_TICKERS = new Set([
  // Mega-cap tech
  'AAPL',
  'MSFT',
  'GOOGL',
  'GOOG',
  'AMZN',
  'NVDA',
  'META',
  'TSLA',
  'AVGO',
  'ORCL',
  'CRM',
  'ADBE',
  'AMD',
  'INTC',
  'CSCO',
  'QCOM',
  'TXN',
  'AMAT',
  'NOW',
  'INTU',
  'ISRG',
  'LRCX',
  'ADI',
  'MU',
  'KLAC',
  'SNPS',
  'CDNS',
  'PANW',
  'MRVL',
  'FTNT',
  'NXPI',
  'MCHP',
  'ON',
  'MPWR',
  'SWKS',
  'ANSS',
  'KEYS',
  'TER',
  'ZBRA',
  // Financials
  'JPM',
  'V',
  'MA',
  'BAC',
  'WFC',
  'GS',
  'MS',
  'C',
  'AXP',
  'BLK',
  'SCHW',
  'SPGI',
  'CB',
  'MMC',
  'PGR',
  'ICE',
  'CME',
  'AON',
  'MCO',
  'TFC',
  'USB',
  'PNC',
  'COF',
  'MET',
  'AIG',
  'PRU',
  'ALL',
  'AFL',
  'TRV',
  'HIG',
  'BK',
  'STT',
  'NTRS',
  'FIS',
  'FISV',
  'GPN',
  'PYPL',
  // Healthcare
  'UNH',
  'JNJ',
  'LLY',
  'ABBV',
  'MRK',
  'PFE',
  'TMO',
  'ABT',
  'DHR',
  'BMY',
  'AMGN',
  'MDT',
  'ELV',
  'CI',
  'GILD',
  'VRTX',
  'REGN',
  'SYK',
  'BSX',
  'BDX',
  'ZTS',
  'HUM',
  'EW',
  'IDXX',
  'IQV',
  'DXCM',
  'A',
  'MRNA',
  'BIIB',
  'ILMN',
  'ALGN',
  'MTD',
  'BAX',
  'GEHC',
  'HOLX',
  // Consumer
  'PG',
  'KO',
  'PEP',
  'COST',
  'WMT',
  'MCD',
  'NKE',
  'SBUX',
  'TGT',
  'LOW',
  'HD',
  'EL',
  'CL',
  'MNST',
  'KMB',
  'GIS',
  'K',
  'HSY',
  'SJM',
  'CHD',
  'CLX',
  'HRL',
  'MKC',
  'TSN',
  'CAG',
  // Consumer discretionary
  'AMZN',
  'HD',
  'LOW',
  'TJX',
  'NKE',
  'SBUX',
  'MCD',
  'YUM',
  'DPZ',
  'CMG',
  'MAR',
  'HLT',
  'BKNG',
  'ABNB',
  'EXPE',
  'RCL',
  'CCL',
  'NCLH',
  'DRI',
  'LVS',
  'WYNN',
  'MGM',
  'ROST',
  'LULU',
  'GPS',
  'DECK',
  'POOL',
  'BBY',
  'DHI',
  'LEN',
  'PHM',
  'NVR',
  'GRMN',
  'EBAY',
  'ETSY',
  'ORLY',
  'AZO',
  // Industrials
  'GE',
  'CAT',
  'HON',
  'UNP',
  'BA',
  'RTX',
  'LMT',
  'DE',
  'UPS',
  'MMM',
  'GD',
  'NOC',
  'WM',
  'RSG',
  'CSX',
  'NSC',
  'ITW',
  'EMR',
  'ETN',
  'PH',
  'ROK',
  'SWK',
  'FDX',
  'GWW',
  'FAST',
  'CTAS',
  'PAYX',
  'PCAR',
  'CARR',
  'OTIS',
  'JCI',
  'TT',
  'AME',
  'VRSK',
  'IR',
  'DOV',
  'XYL',
  'HUBB',
  'WAB',
  'PWR',
  'DAL',
  'UAL',
  'LUV',
  'AAL',
  // Energy
  'XOM',
  'CVX',
  'COP',
  'SLB',
  'EOG',
  'MPC',
  'PSX',
  'VLO',
  'PXD',
  'OXY',
  'HES',
  'DVN',
  'HAL',
  'BKR',
  'FANG',
  'WMB',
  'KMI',
  'OKE',
  'TRGP',
  'ET',
  // Materials
  'LIN',
  'APD',
  'SHW',
  'ECL',
  'FCX',
  'NEM',
  'DOW',
  'DD',
  'NUE',
  'STLD',
  'VMC',
  'MLM',
  'ALB',
  'PPG',
  'CE',
  'IFF',
  'FMC',
  'CF',
  'MOS',
  'BALL',
  // Utilities
  'NEE',
  'DUK',
  'SO',
  'D',
  'AEP',
  'SRE',
  'EXC',
  'XEL',
  'ED',
  'PEG',
  'WEC',
  'ES',
  'AWK',
  'DTE',
  'EIX',
  'FE',
  'AEE',
  'CMS',
  'ATO',
  'CNP',
  'NI',
  'EVRG',
  // Real estate
  'PLD',
  'AMT',
  'CCI',
  'EQIX',
  'PSA',
  'DLR',
  'O',
  'WELL',
  'SPG',
  'VICI',
  'AVB',
  'EQR',
  'IRM',
  'VTR',
  'ARE',
  'ESS',
  'MAA',
  'UDR',
  'CPT',
  'SUI',
  'REG',
  // Communication
  'DIS',
  'CMCSA',
  'NFLX',
  'T',
  'VZ',
  'TMUS',
  'CHTR',
  'WBD',
  'PARA',
  'FOX',
  'FOXA',
  'OMC',
  'IPG',
  'MTCH',
  'EA',
  'TTWO',
  'ATVI',
  'RBLX',
  'ZM',
  // Other notable
  'BRK.A',
  'BRK.B',
  'UBER',
  'SQ',
  'SHOP',
  'SNOW',
  'DDOG',
  'NET',
  'CRWD',
  'ZS',
  'OKTA',
  'WDAY',
  'TEAM',
  'VEEV',
  'BILL',
  'HUBS',
  'DOCU',
  'TWLO',
  'U',
  'PLTR',
  'COIN',
  'RIVN',
  'LCID',
  'SOFI',
  'HOOD',
  'ARM',
  'SMCI',
  'DELL',
  'HPE',
  'HPQ',
  'IBM',
  'ACN',
  'SAP',
  'SPOT',
]);

// Name map for top tickers (Finnhub doesn't return company names)
const MAJOR_NAMES: Record<string, string> = {
  AAPL: 'Apple Inc',
  MSFT: 'Microsoft Corp',
  GOOGL: 'Alphabet Inc',
  GOOG: 'Alphabet Inc',
  AMZN: 'Amazon.com Inc',
  NVDA: 'NVIDIA Corp',
  META: 'Meta Platforms Inc',
  TSLA: 'Tesla Inc',
  AVGO: 'Broadcom Inc',
  JPM: 'JPMorgan Chase & Co',
  V: 'Visa Inc',
  MA: 'Mastercard Inc',
  UNH: 'UnitedHealth Group',
  JNJ: 'Johnson & Johnson',
  LLY: 'Eli Lilly & Co',
  PG: 'Procter & Gamble',
  HD: 'Home Depot Inc',
  KO: 'Coca-Cola Co',
  PEP: 'PepsiCo Inc',
  COST: 'Costco Wholesale',
  WMT: 'Walmart Inc',
  MCD: "McDonald's Corp",
  ABBV: 'AbbVie Inc',
  MRK: 'Merck & Co',
  PFE: 'Pfizer Inc',
  TMO: 'Thermo Fisher',
  ABT: 'Abbott Labs',
  BAC: 'Bank of America',
  WFC: 'Wells Fargo',
  GS: 'Goldman Sachs',
  MS: 'Morgan Stanley',
  XOM: 'Exxon Mobil',
  CVX: 'Chevron Corp',
  COP: 'ConocoPhillips',
  CRM: 'Salesforce Inc',
  ADBE: 'Adobe Inc',
  AMD: 'Advanced Micro Devices',
  INTC: 'Intel Corp',
  CSCO: 'Cisco Systems',
  QCOM: 'Qualcomm Inc',
  NFLX: 'Netflix Inc',
  DIS: 'Walt Disney Co',
  CMCSA: 'Comcast Corp',
  NKE: 'Nike Inc',
  SBUX: 'Starbucks Corp',
  BA: 'Boeing Co',
  CAT: 'Caterpillar Inc',
  GE: 'GE Aerospace',
  HON: 'Honeywell Intl',
  UNP: 'Union Pacific',
  RTX: 'RTX Corp',
  LMT: 'Lockheed Martin',
  DE: 'Deere & Co',
  UPS: 'United Parcel Service',
  FDX: 'FedEx Corp',
  LOW: "Lowe's Companies",
  TGT: 'Target Corp',
  TJX: 'TJX Companies',
  BKNG: 'Booking Holdings',
  NEE: 'NextEra Energy',
  DUK: 'Duke Energy',
  SO: 'Southern Co',
  BLK: 'BlackRock Inc',
  SCHW: 'Charles Schwab',
  SPGI: 'S&P Global',
  ICE: 'Intercontinental Exchange',
  CME: 'CME Group',
  C: 'Citigroup Inc',
  AXP: 'American Express',
  PYPL: 'PayPal Holdings',
  SQ: 'Block Inc',
  SHOP: 'Shopify Inc',
  SNOW: 'Snowflake Inc',
  DDOG: 'Datadog Inc',
  NET: 'Cloudflare Inc',
  CRWD: 'CrowdStrike Holdings',
  PLTR: 'Palantir Technologies',
  COIN: 'Coinbase Global',
  UBER: 'Uber Technologies',
  ABNB: 'Airbnb Inc',
  ARM: 'Arm Holdings',
  IBM: 'IBM Corp',
  ACN: 'Accenture PLC',
  ORCL: 'Oracle Corp',
  SAP: 'SAP SE',
  SPOT: 'Spotify Technology',
  DELL: 'Dell Technologies',
  SMCI: 'Super Micro Computer',
  NOW: 'ServiceNow Inc',
  INTU: 'Intuit Inc',
  ISRG: 'Intuitive Surgical',
  PANW: 'Palo Alto Networks',
  LRCX: 'Lam Research',
  MU: 'Micron Technology',
  AMAT: 'Applied Materials',
  KLAC: 'KLA Corp',
  SLB: 'Schlumberger Ltd',
  DHR: 'Danaher Corp',
  BMY: 'Bristol-Myers Squibb',
  AMGN: 'Amgen Inc',
  MDT: 'Medtronic PLC',
  GILD: 'Gilead Sciences',
  VRTX: 'Vertex Pharma',
  REGN: 'Regeneron Pharma',
  SYK: 'Stryker Corp',
  LIN: 'Linde PLC',
  APD: 'Air Products',
  SHW: 'Sherwin-Williams',
  PLD: 'Prologis Inc',
  AMT: 'American Tower',
  CCI: 'Crown Castle',
  EQIX: 'Equinix Inc',
  T: 'AT&T Inc',
  VZ: 'Verizon Communications',
  TMUS: 'T-Mobile US',
  GD: 'General Dynamics',
  NOC: 'Northrop Grumman',
  DAL: 'Delta Air Lines',
  UAL: 'United Airlines',
  LUV: 'Southwest Airlines',
  RIVN: 'Rivian Automotive',
  LCID: 'Lucid Group',
  MRNA: 'Moderna Inc',
  ZM: 'Zoom Video',
  RBLX: 'Roblox Corp',
  EA: 'Electronic Arts',
  TTWO: 'Take-Two Interactive',
  WDAY: 'Workday Inc',
  HUBS: 'HubSpot Inc',
  HOOD: 'Robinhood Markets',
  SOFI: 'SoFi Technologies',
};

// ─── Helpers ───

function todayStr(): string {
  return new Date().toISOString().split('T')[0]!;
}

function dateStr(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0]!;
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

// ─── Finnhub Fetcher ───

async function fetchFinnhubEarnings(
  startDate: string,
  endDate: string,
): Promise<FinnhubEarningsEntry[]> {
  const apiKey = FINNHUB_API_KEY();
  if (!apiKey) return [];

  if (!checkRateLimit('finnhub_earnings')) return [];

  try {
    const url = `${FINNHUB_EARNINGS_URL}?from=${startDate}&to=${endDate}`;
    const res = await safeFetch(url, {
      headers: { 'X-Finnhub-Token': apiKey },
      next: { revalidate: 1800 },
      // Hard cap: Finnhub has hung for 60s+ in the wild → never block the route.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[Earnings] Finnhub API returned ${res.status}:`,
        body.slice(0, 200) || '(no body)',
      );
      return [];
    }
    const data: FinnhubEarningsResponse = await res.json();
    if (!data.earningsCalendar || !Array.isArray(data.earningsCalendar)) return [];
    return data.earningsCalendar;
  } catch (error) {
    console.warn(
      '[Earnings] Finnhub fetch failed:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

// ─── Enrichment Functions ───

function enrichWithFinnhub(
  avEvents: EarningsEvent[],
  finnhubEntries: FinnhubEarningsEntry[],
): EarningsEvent[] {
  // Build lookup: symbol+date → FinnhubEntry
  const lookup = new Map<string, FinnhubEarningsEntry>();
  for (const entry of finnhubEntries) {
    const key = `${entry.symbol}:${entry.date}`;
    // Prefer entries with actuals
    const existing = lookup.get(key);
    if (!existing || (entry.epsActual !== null && existing.epsActual === null)) {
      lookup.set(key, entry);
    }
  }

  return avEvents.map((event) => {
    const key = `${event.symbol}:${event.reportDate}`;
    const fh = lookup.get(key);
    if (!fh) return event;

    const { surprise, surprisePercent } = computeSurprise(fh.epsActual, fh.epsEstimate);

    return {
      ...event,
      epsActual: fh.epsActual,
      revenueEstimate: fh.revenueEstimate,
      revenueActual: fh.revenueActual,
      surprise,
      surprisePercent,
      hour: fh.hour || null,
      quarter: fh.quarter ?? null,
      year: fh.year ?? null,
      // Use Finnhub estimate if AV didn't have one
      estimate: event.estimate ?? fh.epsEstimate,
    };
  });
}

function buildRecentResults(
  finnhubEntries: FinnhubEarningsEntry[],
  today: string,
): EarningsEvent[] {
  // Filter to past entries with actuals, major tickers only
  const pastWithActuals = finnhubEntries.filter(
    (e) => e.date < today && e.epsActual !== null && MAJOR_TICKERS.has(e.symbol),
  );

  // Deduplicate by symbol+date — Finnhub can return multiple entries per ticker
  // (e.g., different quarters). Keep the one with actuals, prefer higher quarter.
  const deduped = new Map<string, FinnhubEarningsEntry>();
  for (const entry of pastWithActuals) {
    const key = `${entry.symbol}:${entry.date}`;
    const existing = deduped.get(key);
    if (
      !existing ||
      (entry.epsActual !== null && existing.epsActual === null) ||
      entry.quarter > (existing.quarter ?? 0)
    ) {
      deduped.set(key, entry);
    }
  }

  // Sort by date descending (most recent first)
  const sorted = [...deduped.values()];
  sorted.sort((a, b) => b.date.localeCompare(a.date));

  return sorted.map((entry) => {
    const { surprise, surprisePercent } = computeSurprise(entry.epsActual, entry.epsEstimate);
    return {
      id: `e-past-${entry.symbol}-${entry.date}`,
      symbol: entry.symbol,
      name: MAJOR_NAMES[entry.symbol] ?? entry.symbol,
      reportDate: entry.date,
      fiscalDateEnding: '',
      estimate: entry.epsEstimate,
      currency: 'USD',
      epsActual: entry.epsActual,
      revenueEstimate: entry.revenueEstimate,
      revenueActual: entry.revenueActual,
      surprise,
      surprisePercent,
      hour: entry.hour || null,
      quarter: entry.quarter ?? null,
      year: entry.year ?? null,
      isMajor: true,
      isPast: true,
    };
  });
}

// ─── CSV Parser (Alpha Vantage) ───

function parseCsv(csvText: string, daysAhead: number): EarningsEvent[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() + daysAhead);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayString = todayStr();

  const events: EarningsEvent[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // CSV format: symbol,name,reportDate,fiscalDateEnding,estimate,currency
    const parts = line.split(',');
    if (parts.length < 6) continue;

    const symbol = parts[0]?.trim() ?? '';
    const name = parts[1]?.trim() ?? '';
    const reportDate = parts[2]?.trim() ?? '';
    const fiscalDateEnding = parts[3]?.trim() ?? '';
    const estimateStr = parts[4]?.trim() ?? '';
    const currency = parts[5]?.trim() ?? 'USD';

    if (!symbol || !reportDate) continue;

    const reportDateObj = new Date(reportDate);
    if (reportDateObj < today || reportDateObj > cutoffDate) continue;

    const estimate = estimateStr && estimateStr !== '' ? parseFloat(estimateStr) : null;

    events.push({
      id: `e-${symbol}-${reportDate}`,
      symbol,
      name,
      reportDate,
      fiscalDateEnding,
      estimate: estimate !== null && !Number.isNaN(estimate) ? estimate : null,
      currency,
      // New fields — will be enriched by Finnhub or remain null
      epsActual: null,
      revenueEstimate: null,
      revenueActual: null,
      surprise: null,
      surprisePercent: null,
      hour: null,
      quarter: null,
      year: null,
      isMajor: MAJOR_TICKERS.has(symbol),
      isPast: reportDate < todayString,
    });
  }

  // Sort by reportDate ascending
  events.sort((a, b) => a.reportDate.localeCompare(b.reportDate));

  return events;
}

// ─── Fallback Demo Data ───

function getFutureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0]!;
}

function getPastDate(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split('T')[0]!;
}

const DEMO_EARNINGS: EarningsEvent[] = [
  // Recent results (past, with actuals)
  {
    id: 'e-demo-past-msft',
    symbol: 'MSFT',
    name: 'Microsoft Corp',
    reportDate: getPastDate(3),
    fiscalDateEnding: '2025-12-31',
    estimate: 3.22,
    currency: 'USD',
    epsActual: 3.4,
    revenueEstimate: 68_700_000_000,
    revenueActual: 69_600_000_000,
    surprise: 0.18,
    surprisePercent: 5.59,
    hour: 'amc',
    quarter: 4,
    year: 2025,
    isMajor: true,
    isPast: true,
  },
  {
    id: 'e-demo-past-meta',
    symbol: 'META',
    name: 'Meta Platforms Inc',
    reportDate: getPastDate(2),
    fiscalDateEnding: '2025-12-31',
    estimate: 6.78,
    currency: 'USD',
    epsActual: 6.55,
    revenueEstimate: 46_500_000_000,
    revenueActual: 45_800_000_000,
    surprise: -0.23,
    surprisePercent: -3.39,
    hour: 'amc',
    quarter: 4,
    year: 2025,
    isMajor: true,
    isPast: true,
  },
  // Upcoming
  {
    id: 'e-demo-aapl',
    symbol: 'AAPL',
    name: 'Apple Inc',
    reportDate: getFutureDate(3),
    fiscalDateEnding: '2025-12-31',
    estimate: 2.35,
    currency: 'USD',
    epsActual: null,
    revenueEstimate: 124_300_000_000,
    revenueActual: null,
    surprise: null,
    surprisePercent: null,
    hour: 'amc',
    quarter: 1,
    year: 2026,
    isMajor: true,
    isPast: false,
  },
  {
    id: 'e-demo-nvda',
    symbol: 'NVDA',
    name: 'NVIDIA Corp',
    reportDate: getFutureDate(5),
    fiscalDateEnding: '2026-01-31',
    estimate: 0.89,
    currency: 'USD',
    epsActual: null,
    revenueEstimate: 38_000_000_000,
    revenueActual: null,
    surprise: null,
    surprisePercent: null,
    hour: 'amc',
    quarter: 4,
    year: 2025,
    isMajor: true,
    isPast: false,
  },
  {
    id: 'e-demo-amzn',
    symbol: 'AMZN',
    name: 'Amazon.com Inc',
    reportDate: getFutureDate(7),
    fiscalDateEnding: '2025-12-31',
    estimate: 1.48,
    currency: 'USD',
    epsActual: null,
    revenueEstimate: 187_500_000_000,
    revenueActual: null,
    surprise: null,
    surprisePercent: null,
    hour: 'amc',
    quarter: 4,
    year: 2025,
    isMajor: true,
    isPast: false,
  },
  {
    id: 'e-demo-googl',
    symbol: 'GOOGL',
    name: 'Alphabet Inc',
    reportDate: getFutureDate(10),
    fiscalDateEnding: '2025-12-31',
    estimate: 2.12,
    currency: 'USD',
    epsActual: null,
    revenueEstimate: 96_200_000_000,
    revenueActual: null,
    surprise: null,
    surprisePercent: null,
    hour: 'amc',
    quarter: 4,
    year: 2025,
    isMajor: true,
    isPast: false,
  },
  {
    id: 'e-demo-tsla',
    symbol: 'TSLA',
    name: 'Tesla Inc',
    reportDate: getFutureDate(12),
    fiscalDateEnding: '2025-12-31',
    estimate: 0.76,
    currency: 'USD',
    epsActual: null,
    revenueEstimate: 27_200_000_000,
    revenueActual: null,
    surprise: null,
    surprisePercent: null,
    hour: 'amc',
    quarter: 4,
    year: 2025,
    isMajor: true,
    isPast: false,
  },
  {
    id: 'e-demo-jpm',
    symbol: 'JPM',
    name: 'JPMorgan Chase & Co',
    reportDate: getFutureDate(14),
    fiscalDateEnding: '2025-12-31',
    estimate: 4.81,
    currency: 'USD',
    epsActual: null,
    revenueEstimate: 43_800_000_000,
    revenueActual: null,
    surprise: null,
    surprisePercent: null,
    hour: 'bmo',
    quarter: 4,
    year: 2025,
    isMajor: true,
    isPast: false,
  },
  // Minor ticker example
  {
    id: 'e-demo-minor',
    symbol: 'ACME',
    name: 'Acme Corp',
    reportDate: getFutureDate(4),
    fiscalDateEnding: '2025-12-31',
    estimate: 0.45,
    currency: 'USD',
    epsActual: null,
    revenueEstimate: null,
    revenueActual: null,
    surprise: null,
    surprisePercent: null,
    hour: null,
    quarter: null,
    year: null,
    isMajor: false,
    isPast: false,
  },
];

// ─── Public API ───

export async function fetchEarningsCalendar(
  options: { days?: number; limit?: number } = {},
): Promise<EarningsEvent[]> {
  const { days = 30, limit = 50 } = options;

  const cacheKey = 'earnings:calendar:v2';
  const cached = await getCached<EarningsEvent[]>(cacheKey);
  if (cached) return cached.slice(0, limit);

  const avKey = AV_API_KEY();
  const fhKey = FINNHUB_API_KEY();

  // Neither key available → demo data
  if (!avKey && !fhKey) {
    return DEMO_EARNINGS.slice(0, limit);
  }

  const today = todayStr();
  const past7 = dateStr(-7);
  const future14 = dateStr(14);

  try {
    // Fetch AV and Finnhub in parallel
    const [avEvents, finnhubEntries] = await Promise.all([
      // Alpha Vantage: future earnings CSV
      (async (): Promise<EarningsEvent[]> => {
        if (!avKey) return [];
        if (!checkRateLimit('alpha_vantage')) return [];
        try {
          const url = `${AV_BASE}?function=EARNINGS_CALENDAR&horizon=3month&apikey=${avKey}`;
          const res = await safeFetch(url, { next: { revalidate: 1800 } });
          if (!res.ok) {
            console.warn(`[Earnings] Alpha Vantage returned ${res.status}`);
            return [];
          }
          const csvText = await res.text();
          return parseCsv(csvText, days);
        } catch (error) {
          console.warn(
            '[Earnings] AV fetch failed:',
            error instanceof Error ? error.message : error,
          );
          return [];
        }
      })(),

      // Finnhub: past 7 days + next 14 days in one call
      (async (): Promise<FinnhubEarningsEntry[]> => {
        if (!fhKey) return [];
        return fetchFinnhubEarnings(past7, future14);
      })(),
    ]);

    // Build recent results from Finnhub past data (major tickers only)
    const recentResults =
      finnhubEntries.length > 0 ? buildRecentResults(finnhubEntries, today) : [];

    // Enrich AV events with Finnhub data
    let enrichedAv = avEvents;
    if (finnhubEntries.length > 0 && avEvents.length > 0) {
      enrichedAv = enrichWithFinnhub(avEvents, finnhubEntries);
    }

    // If AV returned nothing but Finnhub has future data, build events from Finnhub
    if (enrichedAv.length === 0 && finnhubEntries.length > 0) {
      // Deduplicate by symbol+date
      const seen = new Map<string, FinnhubEarningsEntry>();
      for (const entry of finnhubEntries.filter((e) => e.date >= today)) {
        const key = `${entry.symbol}:${entry.date}`;
        const existing = seen.get(key);
        if (!existing || (entry.epsActual !== null && existing.epsActual === null)) {
          seen.set(key, entry);
        }
      }
      const futureFromFinnhub = [...seen.values()].map((entry) => {
        const { surprise, surprisePercent } = computeSurprise(entry.epsActual, entry.epsEstimate);
        return {
          id: `e-fh-${entry.symbol}-${entry.date}`,
          symbol: entry.symbol,
          name: MAJOR_NAMES[entry.symbol] ?? entry.symbol,
          reportDate: entry.date,
          fiscalDateEnding: '',
          estimate: entry.epsEstimate,
          currency: 'USD',
          epsActual: entry.epsActual,
          revenueEstimate: entry.revenueEstimate,
          revenueActual: entry.revenueActual,
          surprise,
          surprisePercent,
          hour: entry.hour || null,
          quarter: entry.quarter ?? null,
          year: entry.year ?? null,
          isMajor: MAJOR_TICKERS.has(entry.symbol),
          isPast: false,
        } satisfies EarningsEvent;
      });
      futureFromFinnhub.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
      enrichedAv = futureFromFinnhub;
    }

    // Merge: recent results first, then upcoming
    // Final dedup by ID — guarantees no duplicate keys reach React regardless of source
    const seenIds = new Set<string>();
    const merged: EarningsEvent[] = [];
    for (const event of [...recentResults, ...enrichedAv]) {
      if (seenIds.has(event.id)) continue;
      seenIds.add(event.id);
      merged.push(event);
    }

    if (merged.length === 0) {
      return DEMO_EARNINGS.slice(0, limit);
    }

    await setCache(cacheKey, merged, 1800);
    return merged.slice(0, limit);
  } catch (error) {
    console.warn('[Earnings] Failed to fetch:', error instanceof Error ? error.message : error);
    return DEMO_EARNINGS.slice(0, limit);
  }
}
