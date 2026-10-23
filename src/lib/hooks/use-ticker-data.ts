'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { classifySeverity } from '@/lib/data/normalizer';
import {
  useAdvisoryData,
  useCryptoData,
  useFedData,
  useIocData,
  useMarketData,
} from '@/lib/hooks/use-realtime-data';
import { useDataStore } from '@/lib/store/data-store';
import type {
  Advisory,
  BreachDisclosure,
  CryptoPrice,
  CVE,
  FedData,
  IOC,
  KEV,
  MarketQuote,
  NewsItem,
  Severity,
} from '@/lib/types';
import { formatRelativeTime } from '@/lib/utils/ticker-format';

export interface TickerItem {
  id: string;
  text: string;
  fullText?: string;
  severity: Severity;
  kind: 'cyber' | 'ai' | 'social' | 'news' | 'standby';
  source?: string;
  timestamp?: string;
  /** Raw headline or context for click-to-analyze */
  analyzePrompt?: string;
  /** URL to original article */
  url?: string;
}

export interface MetricTickerItem {
  id: string;
  symbol: string;
  value: string;
  detail: string;
  tone: 'positive' | 'negative' | 'neutral';
  severity: Severity;
  kind:
    | 'cve'
    | 'kev'
    | 'breach'
    | 'ioc'
    | 'advisory'
    | 'market'
    | 'crypto'
    | 'rates'
    | 'macro'
    | 'standby';
  analyzePrompt?: string;
  url?: string;
  source?: string;
}

const STANDBY_ITEMS: TickerItem[] = [
  {
    id: 'standby-1',
    text: 'COCOA THREAT DECK ACTIVE -- Scanning cyber intelligence feeds...',
    severity: 'info',
    kind: 'standby',
  },
  {
    id: 'standby-2',
    text: 'All feeds nominal. Awaiting significant events.',
    severity: 'info',
    kind: 'standby',
  },
];

const VULNERABILITY_STANDBY_ITEMS: MetricTickerItem[] = [
  {
    id: 'vuln-standby-1',
    symbol: 'AEGIS',
    value: 'CLEAR',
    detail: 'NO CRITICAL CVES',
    tone: 'neutral',
    severity: 'info',
    kind: 'standby',
  },
];

const BOTTOM_NEWS_STANDBY_ITEMS: TickerItem[] = [
  {
    id: 'bottom-news-standby-1',
    text: 'Global news wire warming up -- awaiting top stories.',
    severity: 'info',
    kind: 'standby',
  },
];

const MARKET_STANDBY_ITEMS: MetricTickerItem[] = [
  {
    id: 'market-standby-1',
    symbol: 'MKTS',
    value: 'STANDBY',
    detail: 'AWAITING QUOTES',
    tone: 'neutral',
    severity: 'info',
    kind: 'standby',
  },
];

const THREAT_ACTIVITY_STANDBY_ITEMS: MetricTickerItem[] = [
  {
    id: 'threat-activity-standby-1',
    symbol: 'IOC',
    value: 'CLEAR',
    detail: 'NO ACTIVE INDICATORS',
    tone: 'neutral',
    severity: 'info',
    kind: 'standby',
  },
];

const TOP_TICKER_SOCIAL_TEXT_MAX = 96;
const TOP_TICKER_PUBLISHER_TEXT_MAX = 120;

async function fetchTickerNews(params: {
  category?: string;
  mode?: 'ticker' | 'top-pulse';
  limit: number;
}): Promise<NewsItem[]> {
  const search = new URLSearchParams();
  if (params.category) {
    search.set('category', params.category);
  } else {
    search.set('mode', params.mode ?? 'ticker');
  }
  search.set('limit', String(params.limit));

  const res = await fetch(`/api/data/news?${search.toString()}`, {
    cache: params.mode === 'top-pulse' ? 'no-store' : 'default',
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: NewsItem[] };
  return data.items ?? [];
}

function formatCompactNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 2,
    ...options,
  });
}

function formatMarketValue(value: number): string {
  if (value >= 1000) return formatCompactNumber(value, { maximumFractionDigits: 1 });
  if (value >= 1) return formatCompactNumber(value, { minimumFractionDigits: 2 });
  return value.toFixed(4);
}

function formatCryptoValue(value: number): string {
  if (value >= 1) {
    return `$${formatCompactNumber(value, { minimumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(4)}`;
}

function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function severityFromMove(value: number): Severity {
  const abs = Math.abs(value);
  if (abs >= 3) return 'high';
  if (abs >= 1) return 'medium';
  return 'low';
}

function recordsLabel(records: number): string {
  if (records <= 0) return 'breach';
  if (records >= 1_000_000) return `${(records / 1_000_000).toFixed(1)}M recs`;
  if (records >= 1_000) return `${(records / 1_000).toFixed(0)}K recs`;
  return `${records} recs`;
}

function validMarketQuote(quote: MarketQuote): boolean {
  return Number.isFinite(quote.price) && quote.price > 0;
}

function topTickerSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  if (source.startsWith('@')) return source;

  const labels: Record<string, string> = {
    'OpenAI News': 'OPENAI',
    'Google AI Blog': 'GOOGLE AI',
    'Google DeepMind': 'DEEPMIND',
    'SANS ISC': 'SANS ISC',
    CyberScoop: 'CYBERSCOOP',
    'The Record': 'THE RECORD',
    'Help Net Security': 'HELP NET SEC',
    BleepingComputer: 'BLEEPINGCOMPUTER',
    'The Hacker News': 'THE HACKER NEWS',
    SecurityWeek: 'SECURITYWEEK',
    'The Register Security': 'REGISTER SEC',
    'AI Incident Database': 'AI INCIDENT DB',
    'OWASP Gen AI / LLM Top 10': 'OWASP LLM',
    'Protect AI Blog': 'PROTECT AI',
    'Promptfoo Blog': 'PROMPTFOO',
    'MITRE ATLAS Data': 'MITRE ATLAS',
  };

  return labels[source] ?? source;
}

function topTickerKind(category: string): TickerItem['kind'] {
  if (category === 'social') return 'social';
  if (category === 'ai') return 'ai';
  return 'cyber';
}

function compactTickerText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const clipped = normalized.slice(0, maxLength - 3);
  const wordBoundary = clipped.replace(/\s+\S*$/, '').trim();
  const fallback = clipped.trim();
  return `${wordBoundary.length >= Math.floor(maxLength * 0.6) ? wordBoundary : fallback}...`;
}

/**
 * Top row: AI / cyber / social headlines. NEWS ONLY — deliberately.
 *
 * This used to push up to 5 unacknowledged alerts in FRONT of the news, with no
 * severity floor and no expiry. Nothing auto-acknowledges an alert, so once the
 * alert spine started producing real rows the same handful of vendor release
 * notes led every marquee loop indefinitely. (The branch had been dormant for
 * months only because `alerts-store` had no writer — so it never looked broken.)
 *
 * Alerts have three surfaces that are actually designed for them: the ALERTS
 * panel, the agent toast, and the hero breaking banner. A scrolling headline row
 * is not a fourth. Do not reintroduce them here.
 */
export function buildTopThreatTickerItems(newsItems: NewsItem[] | undefined): TickerItem[] {
  const items: TickerItem[] = [];

  for (const news of (newsItems ?? [])
    .filter(
      (item) => item.category === 'cyber' || item.category === 'ai' || item.category === 'social',
    )
    .slice(0, 15)) {
    const kind = topTickerKind(news.category);
    const fullText = news.title;
    const text = compactTickerText(
      fullText,
      kind === 'social' ? TOP_TICKER_SOCIAL_TEXT_MAX : TOP_TICKER_PUBLISHER_TEXT_MAX,
    );
    items.push({
      id: `${kind}-${news.id}`,
      text,
      fullText: text === fullText ? undefined : fullText,
      severity: classifySeverity(fullText),
      kind,
      source: topTickerSource(news.source),
      timestamp: formatRelativeTime(news.publishedAt),
      analyzePrompt: `Analyze this: ${fullText}`,
      url: news.url,
    });
  }

  return items.length > 0 ? items : STANDBY_ITEMS;
}

export function buildTopVulnerabilityTickerItems(
  cves: CVE[],
  kev: KEV[],
  breaches: BreachDisclosure[],
): MetricTickerItem[] {
  const items: MetricTickerItem[] = [];

  const critical = cves
    .filter((c) => c.severity === 'critical')
    .sort((a, b) => (b.cvssV3Score ?? 0) - (a.cvssV3Score ?? 0))
    .slice(0, 6);

  for (const cve of critical) {
    const score = cve.cvssV3Score ?? 0;
    items.push({
      id: `cve-${cve.cveId}`,
      symbol: cve.cveId,
      value: score > 0 ? score.toFixed(1) : 'n/a',
      detail: cve.isKev ? 'KEV' : cve.exploitedInWild ? 'EXPLOITED' : 'CRIT',
      tone: 'negative',
      severity: 'critical',
      kind: 'cve',
      url: cve.nvdSourceUrl ?? `/api/aegis/cves/view?id=${encodeURIComponent(cve.cveId)}`,
      source: 'NVD',
      analyzePrompt: `Analyze CVE ${cve.cveId} (CVSS ${score.toFixed(1)}${cve.isKev ? ', KEV-listed' : ''}): ${cve.summary?.slice(0, 200) ?? ''}`,
    });
  }

  for (const k of kev.slice(0, 4)) {
    const vendor = k.vendorProject ?? k.product ?? 'KEV';
    items.push({
      id: `kev-${k.cveId}`,
      symbol: k.cveId,
      value: vendor,
      detail: 'EXPLOITED',
      tone: 'negative',
      severity: 'high',
      kind: 'kev',
      url: `/api/aegis/kev/view?id=${encodeURIComponent(k.cveId)}`,
      source: 'CISA KEV',
      analyzePrompt: `Analyze KEV-listed CVE ${k.cveId} (${vendor}): actively exploited -- required action: ${k.requiredAction ?? 'patch immediately'}`,
    });
  }

  for (const b of breaches.slice(0, 4)) {
    const breachType = b.breachType ?? 'BREACH';
    items.push({
      id: `breach-${b.id}`,
      symbol: breachType.toUpperCase(),
      value: recordsLabel(b.recordsCompromised ?? 0),
      detail: b.source ?? 'DISCLOSED',
      tone: 'negative',
      severity: 'high',
      kind: 'breach',
      url: b.sourceUrl,
      source: b.source,
      analyzePrompt: `Analyze breach disclosure ${b.id} (type: ${breachType}, source: ${b.source ?? 'unknown'}): ${b.notes?.slice(0, 200) ?? ''}`,
    });
  }

  return items.length > 0 ? items : VULNERABILITY_STANDBY_ITEMS;
}

export function buildBottomNewsTickerItems(newsItems: NewsItem[] | undefined): TickerItem[] {
  const items: TickerItem[] = [];

  for (const news of (newsItems ?? []).filter((item) => item.category !== 'cyber').slice(0, 14)) {
    items.push({
      id: `bottom-news-${news.id}`,
      text: news.title,
      severity: classifySeverity(news.title),
      kind: 'news',
      source: news.source,
      timestamp: formatRelativeTime(news.publishedAt),
      analyzePrompt: `Analyze this top story: ${news.title}`,
      url: news.url,
    });
  }

  return items.length > 0 ? items : BOTTOM_NEWS_STANDBY_ITEMS;
}

export function buildBottomMarketTickerItems(params: {
  indices: MarketQuote[];
  commodities: MarketQuote[];
  crypto: CryptoPrice[];
  fedData: FedData | null;
}): MetricTickerItem[] {
  const items: MetricTickerItem[] = [];

  for (const quote of [...params.indices, ...params.commodities].filter(validMarketQuote)) {
    const change = quote.changePct;
    items.push({
      id: `market-${quote.symbol}`,
      symbol: quote.symbol,
      value: formatMarketValue(quote.price),
      detail: formatSignedPercent(change),
      tone: change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral',
      severity: severityFromMove(change),
      kind: 'market',
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}`,
      source: 'Markets',
      analyzePrompt: `Analyze ${quote.name} (${quote.symbol}) at ${formatMarketValue(quote.price)} (${formatSignedPercent(change)}). What's driving this move and what are the implications?`,
    });
  }

  for (const coin of params.crypto.slice(0, 6)) {
    const change = coin.change24h;
    items.push({
      id: `crypto-${coin.id}`,
      symbol: coin.symbol.toUpperCase(),
      value: formatCryptoValue(coin.price),
      detail: formatSignedPercent(change),
      tone: change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral',
      severity: severityFromMove(change),
      kind: 'crypto',
      url: coin.url,
      source: 'Crypto',
      analyzePrompt: `Analyze ${coin.name} (${coin.symbol.toUpperCase()}) at ${formatCryptoValue(coin.price)} (${formatSignedPercent(change)} over 24h). Summarize the market signal and risk context.`,
    });
  }

  const fed = params.fedData;
  if (fed?.fedFunds) {
    items.push({
      id: 'rates-fed-funds',
      symbol: 'FED FUNDS',
      value: `${fed.fedFunds.value.toFixed(2)}%`,
      detail: 'RATE',
      tone: 'neutral',
      severity: 'info',
      kind: 'rates',
      url: 'https://fred.stlouisfed.org/series/FEDFUNDS',
      source: 'FRED',
      analyzePrompt: `The Fed Funds rate is at ${fed.fedFunds.value.toFixed(2)}%. Analyze implications for equities, bonds, and risk assets.`,
    });
  }
  if (fed?.treasury10Y) {
    items.push({
      id: 'rates-10y',
      symbol: '10Y',
      value: `${fed.treasury10Y.value.toFixed(2)}%`,
      detail: 'UST',
      tone: 'neutral',
      severity: 'info',
      kind: 'rates',
      url: 'https://fred.stlouisfed.org/series/DGS10',
      source: 'FRED',
      analyzePrompt: `The 10-Year Treasury yield is at ${fed.treasury10Y.value.toFixed(2)}%. Analyze the bond-market signal and cross-asset implications.`,
    });
  }
  if (fed?.yieldSpread) {
    items.push({
      id: 'rates-10y2y',
      symbol: '10Y-2Y',
      value: `${fed.yieldSpread.value.toFixed(2)}%`,
      detail: fed.yieldSpread.value < 0 ? 'INVERTED' : 'CURVE',
      tone: fed.yieldSpread.value < 0 ? 'negative' : 'positive',
      severity: fed.yieldSpread.value < 0 ? 'medium' : 'low',
      kind: 'rates',
      url: 'https://fred.stlouisfed.org/series/T10Y2Y',
      source: 'FRED',
      analyzePrompt: `The 10Y-2Y yield spread is at ${fed.yieldSpread.value.toFixed(2)}%. Analyze recession signal and market implications.`,
    });
  }
  if (fed?.cpi) {
    items.push({
      id: 'macro-cpi',
      symbol: 'CPI',
      value: `${fed.cpi.value.toFixed(1)}%`,
      detail: formatSignedPercent(fed.cpi.change),
      tone: fed.cpi.change > 0 ? 'negative' : fed.cpi.change < 0 ? 'positive' : 'neutral',
      severity: Math.abs(fed.cpi.change) >= 0.3 ? 'medium' : 'low',
      kind: 'macro',
      url: 'https://fred.stlouisfed.org/series/CPIAUCSL',
      source: 'FRED',
      analyzePrompt: `CPI inflation is at ${fed.cpi.value.toFixed(1)}% YoY (${formatSignedPercent(fed.cpi.change)} change). Analyze inflation trajectory and Fed implications.`,
    });
  }

  return items.length > 0 ? items.slice(0, 24) : MARKET_STANDBY_ITEMS;
}

function advisorySeverity(sev: Advisory['severity']): Severity {
  if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') return sev;
  return 'medium';
}

/** IOC + CERT advisory activity (bottom row 2) — the cyber replacement for the legacy market row. */
export function buildBottomThreatActivityTickerItems(
  iocs: IOC[],
  advisories: Advisory[],
): MetricTickerItem[] {
  const items: MetricTickerItem[] = [];

  for (const advisory of advisories.slice(0, 8)) {
    const issuer = advisory.issuer ?? 'CERT';
    const label = advisory.advisoryId ?? advisory.title ?? 'Advisory';
    items.push({
      id: `advisory-${advisory.id}`,
      symbol: String(issuer).toUpperCase(),
      value: compactTickerText(label, 28),
      detail: (advisory.severity ?? 'ADVISORY').toUpperCase(),
      tone: 'negative',
      severity: advisorySeverity(advisory.severity),
      kind: 'advisory',
      url: advisory.advisoryUrl,
      source: String(issuer),
      analyzePrompt: `Analyze security advisory ${label} from ${issuer}: ${advisory.summary?.slice(0, 200) ?? advisory.title ?? ''}`,
    });
  }

  for (const ioc of iocs.slice(0, 12)) {
    const type = String(ioc.iocType).toUpperCase();
    items.push({
      id: `ioc-${ioc.iocType}-${ioc.value}`,
      symbol: type,
      value: compactTickerText(ioc.value, 24),
      detail: (ioc.source ?? 'IOC').toUpperCase(),
      tone: 'negative',
      severity: (ioc.confidence ?? 0) >= 75 ? 'high' : 'medium',
      kind: 'ioc',
      source: ioc.source,
      analyzePrompt: `Analyze this ${type} indicator of compromise from ${ioc.source ?? 'the threat feeds'}: ${ioc.value}`,
    });
  }

  return items.length > 0 ? items : THREAT_ACTIVITY_STANDBY_ITEMS;
}

/** AI / cyber headline ticker (top row 1). News only — see buildTopThreatTickerItems. */
export function useTopThreatTickerData(): TickerItem[] {
  const { data: newsItems } = useQuery({
    queryKey: ['ticker-news', 'top-threat'],
    queryFn: () => fetchTickerNews({ mode: 'top-pulse', limit: 18 }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  return useMemo(() => buildTopThreatTickerItems(newsItems), [newsItems]);
}

/** CVE / KEV / breach ticker (top row 2). */
export function useTopVulnerabilityTickerData(): MetricTickerItem[] {
  const cves = useDataStore((s) => s.cves);
  const kev = useDataStore((s) => s.kev);
  const breaches = useDataStore((s) => s.breaches);

  return useMemo(
    () => buildTopVulnerabilityTickerItems(cves, kev, breaches),
    [cves, kev, breaches],
  );
}

/** General news ticker (bottom row 1). */
export function useBottomNewsTickerData(): TickerItem[] {
  const { data: newsItems } = useQuery({
    queryKey: ['ticker-news', 'bottom-news'],
    queryFn: () => fetchTickerNews({ limit: 18 }),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  return useMemo(() => buildBottomNewsTickerItems(newsItems), [newsItems]);
}

/** Market / rates / crypto ticker (bottom row 2). */
export function useBottomMarketTickerData(): MetricTickerItem[] {
  useMarketData();
  useCryptoData();
  useFedData();

  const indices = useDataStore((s) => s.indices);
  const commodities = useDataStore((s) => s.commodities);
  const crypto = useDataStore((s) => s.crypto);
  const fedData = useDataStore((s) => s.fedData);

  return useMemo(
    () => buildBottomMarketTickerItems({ indices, commodities, crypto, fedData }),
    [indices, commodities, crypto, fedData],
  );
}

/** IOC / CERT-advisory threat-activity ticker (bottom row 2). */
export function useBottomThreatActivityTickerData(): MetricTickerItem[] {
  useIocData();
  useAdvisoryData();

  const iocs = useDataStore((s) => s.iocs);
  const advisories = useDataStore((s) => s.advisories);

  return useMemo(() => buildBottomThreatActivityTickerItems(iocs, advisories), [iocs, advisories]);
}
