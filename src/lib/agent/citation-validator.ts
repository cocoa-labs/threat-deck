// ═══════════════════════════════════════════════
// Citation Validator — Post-stream repair layer
// Catches and fixes citation issues programmatically
// ═══════════════════════════════════════════════

export interface CitationRepair {
  type: 'confidence_cap' | 'tool_name' | 'missing_link';
  original: string;
  repaired: string;
  line: number;
}

export interface ValidationResult {
  text: string;
  repairs: CitationRepair[];
  repairCount: number;
}

// ─── Confidence tier caps ───

const TIER_CAPS: Record<string, number> = {
  VERIFIED: 95,
  RECALLED: 70,
  ASSESSED: 50,
};

// ─── Tool → Canonical Source mapping (from SOUL.md) ───

const TOOL_TO_SOURCE: Record<string, { name: string; url: string }> = {
  fetch_market_snapshot: { name: 'Yahoo Finance', url: 'https://finance.yahoo.com' },
  fetch_chart_data: { name: 'Yahoo Finance', url: 'https://finance.yahoo.com' },
  fetch_economic_data: { name: 'FRED', url: 'https://fred.stlouisfed.org' },
  fetch_fed_calendar: { name: 'FRED', url: 'https://fred.stlouisfed.org' },
  fetch_congress_trades: {
    name: 'Quiver Quantitative',
    url: 'https://www.quiverquant.com',
  },
  fetch_whale_transactions: { name: 'Whale Alert', url: 'https://whale-alert.io' },
  fetch_crypto_data: { name: 'CoinGecko', url: 'https://www.coingecko.com' },
  fetch_prediction_markets: { name: 'Polymarket', url: 'https://polymarket.com' },
  fetch_government_contracts: {
    name: 'USASpending',
    url: 'https://www.usaspending.gov',
  },
  fetch_earnings_calendar: {
    name: 'Yahoo Finance',
    url: 'https://finance.yahoo.com/calendar/earnings',
  },
  fetch_twitter_feed: { name: 'X', url: 'https://x.com' },
  x_check_replies: { name: 'X', url: 'https://x.com' },
  // Email has no public permalink — empty url keeps the source name without a
  // bad link (the TOOL_NAME_PATTERNS builder skips empty-url entries).
  check_email_replies: { name: 'Email', url: '' },
  fetch_news_feed: { name: 'NewsAPI', url: 'https://newsapi.org' },
  fetch_tv_context: { name: 'TV Context', url: '' },
  aegis_search_cves: { name: 'AEGIS CVE', url: '/api/aegis/cves/view' },
  aegis_cve_detail: { name: 'AEGIS CVE Detail', url: '/api/aegis/cves/view' },
  aegis_score_threat_actor: {
    name: 'AEGIS Threat Actor',
    url: '/api/aegis/threat-actors/view',
  },
  aegis_find_incident_comps: { name: 'AEGIS Incident', url: '/api/aegis/incidents/view' },
  aegis_run_risk_simulation: {
    name: 'AEGIS Risk Simulation',
    url: '/api/aegis/risk-simulation/view',
  },
  aegis_match_defenses: { name: 'AEGIS Defense', url: '/api/aegis/defenses/view' },
  aegis_screen_compromised_orgs: {
    name: 'AEGIS Compromised Org',
    url: '/api/aegis/compromised-orgs/view',
  },
  aegis_recent_alerts: { name: 'AEGIS Alert Board', url: '/api/data/alerts' },
  get_monitor_matches: { name: 'Watchlist', url: '' },
  // Phase 11.D.13 — forecast-aware tools
  aegis_exploit_forecast: {
    name: 'AEGIS Forecast',
    url: '/api/aegis/cves/view',
  },
  aegis_actor_forecast: {
    name: 'AEGIS Forecast',
    url: '/api/aegis/threat-actors/view',
  },
  aegis_timeseries: {
    name: 'AEGIS Forecast',
    url: '/api/aegis/predictions/timeseries',
  },
  aegis_counterfactual: {
    name: 'AEGIS Forecast',
    url: '/api/aegis/predictions/counterfactual',
  },
};

// Build lookup variants: snake_case, space-separated, natural language
const TOOL_NAME_PATTERNS: Array<{ pattern: RegExp; source: { name: string; url: string } }> = [];

for (const [toolName, source] of Object.entries(TOOL_TO_SOURCE)) {
  // Skip TV Context — no URL to link to
  if (!source.url) continue;

  // Strip fetch_ prefix for shorter forms
  const baseName = toolName.replace(/^fetch_/, '');
  // "market_snapshot" → "market snapshot" → "Market snapshot"
  const spaceName = baseName.replace(/_/g, ' ');

  // Match the full tool name, base name, or space-separated form
  // Case-insensitive, must appear as a standalone source name
  const variants = [
    toolName, // fetch_market_snapshot
    baseName, // market_snapshot
    spaceName, // market snapshot
  ];

  const escaped = variants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  TOOL_NAME_PATTERNS.push({
    pattern: new RegExp(`(?<=Source:\\s*(?:\\[\\w+\\]\\s*)?)(?:${escaped})(?=[,)\\s*])`, 'gi'),
    source,
  });
}

// ─── 1. Tool Name Detection & Replacement ───

function replaceToolNames(text: string, repairs: CitationRepair[]): string {
  let result = text;

  for (const { pattern, source } of TOOL_NAME_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((match = pattern.exec(result)) !== null) {
      const original = match[0];
      const replacement = source.url ? `[${source.name}](${source.url})` : source.name;

      // Find line number for the match
      const beforeMatch = result.slice(0, match.index);
      const lineNum = beforeMatch.split('\n').length;

      repairs.push({
        type: 'tool_name',
        original,
        repaired: replacement,
        line: lineNum,
      });

      result =
        result.slice(0, match.index) + replacement + result.slice(match.index + original.length);

      // Reset regex since we mutated the string
      pattern.lastIndex = match.index + replacement.length;
    }
  }

  return result;
}

// ─── 2. VERIFIED Link Enforcement ───

function enforceVerifiedLinks(text: string, repairs: CitationRepair[]): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    // Look for [VERIFIED] on this line
    if (!line.includes('[VERIFIED]')) {
      result.push(line);
      continue;
    }

    // Check for a markdown link on this line only (citations are single-line)
    const hasLink = /\[.+?\]\((https?:\/\/|\/)[^)]+\)/.test(line);

    if (!hasLink) {
      // Downgrade to ASSESSED
      line = line.replace(/\[VERIFIED\]/g, '[ASSESSED]');

      repairs.push({
        type: 'missing_link',
        original: '[VERIFIED]',
        repaired: '[ASSESSED] (downgraded — no verifiable link)',
        line: i + 1,
      });
    }

    result.push(line);
  }

  return result.join('\n');
}

// ─── 3. Confidence Capping ───

function capConfidence(text: string, repairs: CitationRepair[]): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!;

    // Match confidence pattern: *Confidence: XX%* or Confidence: XX%
    const confMatch = line.match(/(\*?)Confidence:\s*(\d+)%(\*?)/);
    if (!confMatch) {
      result.push(line);
      continue;
    }

    const currentConf = Number.parseInt(confMatch[2]!, 10);

    // Look backward (up to 3 lines) for the nearest tier badge
    let tier: string | null = null;
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      const tierMatch = lines[j]!.match(/\[(VERIFIED|RECALLED|ASSESSED)\]/);
      if (tierMatch) {
        tier = tierMatch[1]!;
        break;
      }
    }

    if (!tier) {
      result.push(line);
      continue;
    }

    const cap = TIER_CAPS[tier];
    if (cap == null || currentConf <= cap) {
      result.push(line);
      continue;
    }

    // Clamp the confidence value
    const original = confMatch[0];
    const repaired = `${confMatch[1]}Confidence: ${cap}%${confMatch[3]}`;
    line = line.replace(original, repaired);

    repairs.push({
      type: 'confidence_cap',
      original: `Confidence: ${currentConf}%`,
      repaired: `Confidence: ${cap}% (capped for ${tier})`,
      line: i + 1,
    });

    result.push(line);
  }

  return result.join('\n');
}

// ─── 4. Source Aggregation Footer ───

interface ExtractedSource {
  tier: 'VERIFIED' | 'RECALLED' | 'ASSESSED';
  name: string;
  url: string | null;
  timestamp: string | null;
}

const TIER_RANK: Record<string, number> = { VERIFIED: 3, RECALLED: 2, ASSESSED: 1 };

const SOURCE_PATTERN =
  /\*\(Source:\s*\[(VERIFIED|RECALLED|ASSESSED)\]\s*(?:\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)]+)\)(?:,\s*([^)]*?))?|([^)]+?))\)\*/g;

function appendSourcesFooter(text: string): string {
  // Don't double-append
  if (text.includes('**Sources:**')) return text;

  const sources = new Map<string, ExtractedSource>();

  let match: RegExpExecArray | null;
  SOURCE_PATTERN.lastIndex = 0;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = SOURCE_PATTERN.exec(text)) !== null) {
    const tier = match[1] as ExtractedSource['tier'];
    const linkedName = match[2] ?? null;
    const url = match[3] ?? null;
    const unlinkedName = match[5] ?? null;

    const name = linkedName ?? unlinkedName?.trim() ?? 'Unknown';
    const timestamp = match[4]?.trim() ?? null;

    // Dedup key: URL for linked sources, name for non-linked
    const key = url ?? name;

    const existing = sources.get(key);
    if (existing) {
      // Keep highest tier
      if ((TIER_RANK[tier] ?? 0) > (TIER_RANK[existing.tier] ?? 0)) {
        existing.tier = tier;
      }
      // Keep earliest timestamp
      if (timestamp && !existing.timestamp) {
        existing.timestamp = timestamp;
      }
    } else {
      sources.set(key, { tier, name, url, timestamp });
    }
  }

  // Only append when 2+ unique sources
  if (sources.size < 2) return text;

  const lines: string[] = ['\n\n---', '**Sources:**'];
  for (const source of sources.values()) {
    if (source.url) {
      const ts = source.timestamp ? `, ${source.timestamp}` : '';
      lines.push(`- [${source.tier}] [${source.name}](${source.url})${ts}`);
    } else {
      lines.push(`- [${source.tier}] ${source.name}`);
    }
  }

  return text + lines.join('\n');
}

// ─── Composed Validator ───

export function validateCitations(text: string): ValidationResult {
  const repairs: CitationRepair[] = [];
  let result = text;

  // Order matters:
  // 1. Tool names first (canonical names before link checking)
  // 2. Link enforcement (may downgrade tier)
  // 3. Confidence capping (uses final tier)
  // 4. Source aggregation (runs on final text, needs canonical names + final tiers)
  result = replaceToolNames(result, repairs);
  result = enforceVerifiedLinks(result, repairs);
  result = capConfidence(result, repairs);
  result = appendSourcesFooter(result);

  return { text: result, repairs, repairCount: repairs.length };
}
