import { dataRequest } from '@/lib/data/service-request';
import { validatePublicUrl } from '@/lib/security/safe-fetch';

/**
 * Tool handler implementations.
 * Each function is called by the ToolRegistry when the agent invokes a tool.
 * These proxy to the data pipeline collectors and analysis functions.
 */

// ─── AEGIS Intelligence (cybersecurity) ───
export {
  aegisActorForecast,
  aegisCounterfactual,
  aegisCveDetail,
  aegisExploitForecast,
  aegisFindIncidentComps,
  aegisMatchDefenses,
  aegisRecentAlerts,
  aegisRunRiskSimulation,
  aegisScoreThreatActor,
  aegisScreenCompromisedOrgs,
  aegisSearchCves,
  aegisTimeseries,
} from './aegis-tool-handlers';

// ─── Outbound side-effects (email, media, etc.) ───
export {
  checkEmailReplies,
  checkXReplies,
  emailConversation,
  generateImage,
  generateVideo,
  getGeneratedMediaStatus,
  postToX,
  replyToEmail,
  replyToTweet,
} from './outbound-tool-handlers';

import {
  checkRateLimit as webCheckRateLimit,
  getCached as webGetCached,
  setCache as webSetCache,
} from '@/lib/data/rate-limiter';

const baseUrl = 'http://service.invalid';

// ─── Data Retrieval ───

export async function fetchMarketSnapshot(input: Record<string, unknown>): Promise<unknown> {
  const symbols = input.symbols as string[];

  try {
    const response = await dataRequest(`${baseUrl}/api/data/markets?symbols=${symbols.join(',')}`);
    if (!response.ok) return { error: `Markets API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return {
      error: `Failed to fetch market data: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

export async function searchIntelligence(input: Record<string, unknown>): Promise<unknown> {
  const query = input.query as string;
  const sources = input.sources as string[] | undefined;
  const since = input.since as string | undefined;
  const limit = input.limit as number | undefined;

  const params = new URLSearchParams({ q: query });
  if (sources) params.set('sources', sources.join(','));
  if (since) params.set('since', since);
  if (limit) params.set('limit', String(limit));

  try {
    const response = await dataRequest(`${baseUrl}/api/data/osint?${params}`);
    if (!response.ok) return { error: `Search returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Search failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchNewsFeed(input: Record<string, unknown>): Promise<unknown> {
  const categories = input.categories as string[];
  const limit = (input.limit as number) ?? 15;

  try {
    const results = await Promise.all(
      categories.map(async (cat) => {
        const res = await dataRequest(`${baseUrl}/api/data/news?category=${cat}&limit=${limit}`);
        if (!res.ok) return { category: cat, error: res.status };
        const data = await res.json();
        return { category: cat, ...data };
      }),
    );
    return { feeds: results };
  } catch (err) {
    return { error: `News fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchCongressTrades(input: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams();
  if (input.member) params.set('member', input.member as string);
  if (input.symbol) params.set('symbol', input.symbol as string);
  if (input.days) params.set('days', String(input.days));

  try {
    const response = await dataRequest(`${baseUrl}/api/data/congress?${params}`);
    if (!response.ok) return { error: `Congress API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Congress fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchWhaleTransactions(input: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams();
  if (input.min_value_usd) params.set('min_value', String(input.min_value_usd));
  if (input.blockchain) params.set('blockchain', input.blockchain as string);

  try {
    const response = await dataRequest(`${baseUrl}/api/data/whales?${params}`);
    if (!response.ok) return { error: `Whales API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Whale fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchPredictionMarkets(input: Record<string, unknown>): Promise<unknown> {
  const topics = input.topics as string[];

  try {
    const results = await Promise.all(
      topics.map(async (topic) => {
        const res = await dataRequest(`${baseUrl}/api/data/polymarket?category=${topic}`);
        if (!res.ok) return { topic, error: res.status };
        const data = await res.json();
        return { topic, ...data };
      }),
    );
    return { markets: results };
  } catch (err) {
    return { error: `Polymarket fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchEconomicData(input: Record<string, unknown>): Promise<unknown> {
  const indicators = input.indicators as string[];

  try {
    const params = new URLSearchParams({ indicators: indicators.join(',') });
    const response = await dataRequest(`${baseUrl}/api/data/fed?${params}`);
    if (!response.ok) return { error: `Fed API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Fed fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchEarningsCalendar(input: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams();
  if (input.days) params.set('days', String(input.days));
  if (input.limit) params.set('limit', String(input.limit));

  try {
    const response = await dataRequest(`${baseUrl}/api/data/earnings?${params}`);
    if (!response.ok) return { error: `Earnings API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Earnings fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchGovernmentContracts(input: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams();
  if (input.limit) params.set('limit', String(input.limit));

  try {
    const response = await dataRequest(`${baseUrl}/api/data/government?${params}`);
    if (!response.ok) return { error: `Government API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Government fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchTwitterFeed(input: Record<string, unknown>): Promise<unknown> {
  if (process.env.FEATURE_TWITTER === 'false') {
    return { error: 'Twitter feed is disabled' };
  }

  const params = new URLSearchParams();
  if (input.query) params.set('q', input.query as string);
  if (input.account) params.set('account', input.account as string);
  if (input.limit) params.set('limit', String(input.limit));

  try {
    const response = await dataRequest(`${baseUrl}/api/data/twitter?${params}`);
    if (!response.ok) return { error: `Twitter API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Twitter fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchFedCalendar(input: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams();
  if (input.days_forward) params.set('days_forward', String(input.days_forward));
  if (input.days_back) params.set('days_back', String(input.days_back));
  if (input.category) params.set('category', input.category as string);

  try {
    const response = await dataRequest(`${baseUrl}/api/data/fed-calendar?${params}`);
    if (!response.ok) return { error: `Fed calendar API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return {
      error: `Fed calendar fetch failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

export async function fetchCryptoData(input: Record<string, unknown>): Promise<unknown> {
  const params = new URLSearchParams();
  if (input.coins) params.set('coins', (input.coins as string[]).join(','));
  if (input.limit) params.set('limit', String(input.limit));

  try {
    const response = await dataRequest(`${baseUrl}/api/data/crypto?${params}`);
    if (!response.ok) return { error: `Crypto API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Crypto fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function fetchChartData(input: Record<string, unknown>): Promise<unknown> {
  const symbol = input.symbol as string;
  const timeframe = (input.timeframe as string) ?? '1M';
  const interval = (input.interval as string) ?? '1day';

  const params = new URLSearchParams({
    symbol,
    timeframe,
    interval,
  });

  try {
    const response = await dataRequest(`${baseUrl}/api/data/chart?${params}`);
    if (!response.ok) return { error: `Chart data API returned ${response.status}` };
    return response.json();
  } catch (err) {
    return { error: `Chart data fetch failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

// ─── Analysis ───

export async function generateBrief(input: Record<string, unknown>): Promise<unknown> {
  const topic = input.topic as string;
  const format = (input.format as string) ?? 'standard';
  const audience = (input.audience as string) ?? 'general';

  return {
    __brief: true,
    topic,
    format,
    audience,
    instruction: `Generate a ${format} intelligence brief on: ${topic}. Target audience: ${audience}. Follow the ${format} brief template structure. Start with a HEADLINE, then the full structured brief.`,
  };
}

// ─── Actions ───

/**
 * Create a keyword watchlist monitor against the real `monitors` table.
 *
 * Replaces `create_alert_rule`, which was theatre: it returned
 * `{ created: true, ... }` echoing the agent's own input and wrote nothing, so
 * Max told the operator a rule existed when none did. The `alert_rules` table
 * it nominally targeted is retired; `monitors` is the live system (owner-scoped
 * CRUD at /api/monitors, scanned every 5 min by /api/cron/monitor-scan, shown
 * in MonitorsPanel).
 *
 * Ownership comes from `operatorEmail`, the server-trusted value merged onto
 * tool input by `ToolRegistry` — never from a model-supplied field.
 */
export async function createMonitorTool(input: Record<string, unknown>): Promise<unknown> {
  const { MONITOR_SEVERITIES, MONITOR_SOURCES } = await import('@/lib/monitors/constants');
  const { resolveOperatorUserByEmail } = await import('@/lib/auth/operator-by-email');
  const { createMonitor, listMonitors } = await import('@/lib/db/queries/monitors');

  const operatorEmail = typeof input.operatorEmail === 'string' ? input.operatorEmail : null;
  const user = await resolveOperatorUserByEmail(operatorEmail);
  if (!user) {
    return {
      created: false,
      error: 'no_operator',
      summary: 'NOT CREATED — no signed-in operator to own the monitor.',
    };
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { created: false, error: 'missing_name', summary: 'NOT CREATED — a name is required.' };
  }

  const keywords = Array.isArray(input.keywords)
    ? input.keywords
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];
  if (keywords.length === 0) {
    return {
      created: false,
      error: 'missing_keywords',
      summary: 'NOT CREATED — at least one keyword is required.',
    };
  }

  // Mirror the zod contract on /api/monitors so a tool-created monitor is
  // indistinguishable from a UI-created one.
  const severity = MONITOR_SEVERITIES.includes(
    input.severity as (typeof MONITOR_SEVERITIES)[number],
  )
    ? (input.severity as string)
    : 'medium';
  const requestedSources = Array.isArray(input.sources) ? input.sources : [];
  const sources = requestedSources.filter((s): s is (typeof MONITOR_SOURCES)[number] =>
    MONITOR_SOURCES.includes(s as (typeof MONITOR_SOURCES)[number]),
  );
  const effectiveSources = sources.length > 0 ? sources : [...MONITOR_SOURCES];

  // Same-name dedup: the agent re-proposing a watch it already created should
  // report the existing one, not stack duplicates the operator has to prune.
  try {
    const existing = await listMonitors(user.id);
    const dupe = existing.find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (dupe) {
      return {
        created: false,
        existing: true,
        monitorId: dupe.id,
        name: dupe.name,
        keywords: dupe.keywords,
        summary: `ALREADY WATCHING — "${dupe.name}" exists with keywords: ${dupe.keywords.join(', ')}.`,
      };
    }
  } catch {
    // Dedup is best-effort — a read failure must not block the create.
  }

  try {
    const monitor = await createMonitor({
      userId: user.id,
      name,
      keywords,
      severity,
      sources: effectiveSources,
      notifyOnMatch: input.notifyOnMatch !== false,
    });
    return {
      created: true,
      monitorId: monitor.id,
      name: monitor.name,
      keywords: monitor.keywords,
      severity: monitor.severity,
      sources: monitor.sources,
      summary: `Watching "${monitor.name}" for ${monitor.keywords.join(', ')} across ${monitor.sources.join(', ')}. Scans every 5 minutes; manage it in the MY MONITORS panel.`,
    };
  } catch (err) {
    return {
      created: false,
      error: 'db_write_failed',
      summary: `NOT CREATED — the monitor could not be saved (${err instanceof Error ? err.message : 'unknown error'}).`,
    };
  }
}

/**
 * What the operator's watchlists have actually caught.
 *
 * The MONITORS panel has always offered "what has my X watchlist caught?" as a
 * click-to-agent action, but Max had no tool that could read `monitor_match_log`
 * — so it answered from the raw CVE/news catalogue instead of from what the
 * scan genuinely matched. This is the tool that makes that question answerable.
 */
export async function getMonitorMatchesTool(input: Record<string, unknown>): Promise<unknown> {
  const { resolveOperatorUserByEmail } = await import('@/lib/auth/operator-by-email');
  const { listMonitors, recentMatchesForOperator, recentMonitorMatches } = await import(
    '@/lib/db/queries/monitors'
  );

  const operatorEmail = typeof input.operatorEmail === 'string' ? input.operatorEmail : null;
  const user = await resolveOperatorUserByEmail(operatorEmail);
  if (!user) {
    return { matches: [], total: 0, summary: 'No signed-in operator — no watchlists to read.' };
  }

  const limit = Math.min(typeof input.limit === 'number' ? input.limit : 20, 50);
  const wanted = typeof input.monitor === 'string' ? input.monitor.trim() : '';

  try {
    let rows: Awaited<ReturnType<typeof recentMatchesForOperator>>;
    let scope = 'all watchlists';

    if (wanted) {
      // Accept a name as well as an id — the operator says "Fortinet", not a UUID.
      const monitors = await listMonitors(user.id);
      const target =
        monitors.find((m) => m.id === wanted) ??
        monitors.find((m) => m.name.toLowerCase() === wanted.toLowerCase()) ??
        monitors.find((m) => m.name.toLowerCase().includes(wanted.toLowerCase()));
      if (!target) {
        return {
          matches: [],
          total: 0,
          error: 'unknown_monitor',
          available: monitors.map((m) => m.name),
          summary: `No watchlist matching "${wanted}". Existing: ${monitors.map((m) => m.name).join(', ') || 'none'}.`,
        };
      }
      rows = await recentMonitorMatches(target.id, user.id, limit);
      scope = `"${target.name}"`;
    } else {
      rows = await recentMatchesForOperator(user.id, limit);
    }

    const matches = rows.map((r) => ({
      monitor: r.monitor_name,
      matchedKeyword: r.matched_keyword,
      source: r.source,
      title: r.item_title,
      firedAt: r.fired_at,
      // Rule #21 — every hit cites the item it matched.
      sourceUrl: r.item_url,
    }));

    return {
      matches,
      total: matches.length,
      scope,
      summary:
        matches.length === 0
          ? `No recorded hits for ${scope} in the retention window (90 days).`
          : `${matches.length} recent hit(s) across ${scope}.`,
    };
  } catch (err) {
    return {
      matches: [],
      total: 0,
      error: err instanceof Error ? err.message : 'unknown error',
      summary: 'Could not read watchlist hits.',
    };
  }
}

/**
 * List the operator's active watchlist monitors. Pairs with create_monitor so
 * the agent can answer "what am I watching?" and avoid proposing duplicates.
 */
export async function listMonitorsTool(input: Record<string, unknown>): Promise<unknown> {
  const { resolveOperatorUserByEmail } = await import('@/lib/auth/operator-by-email');
  const { listMonitorsWithStats } = await import('@/lib/db/queries/monitors');

  const operatorEmail = typeof input.operatorEmail === 'string' ? input.operatorEmail : null;
  const user = await resolveOperatorUserByEmail(operatorEmail);
  if (!user) {
    return { monitors: [], total: 0, summary: 'No signed-in operator — no monitors to list.' };
  }

  try {
    const rows = await listMonitorsWithStats(user.id);
    return {
      monitors: rows.map((m) => ({
        id: m.id,
        name: m.name,
        keywords: m.keywords,
        severity: m.severity,
        sources: m.sources,
        enabled: m.enabled,
        lastScannedAt: m.last_scanned_at,
        // Hit stats let Max answer "why hasn't my Fortinet watch fired?" —
        // never scanned, scanned-but-no-hits, and hits-you-missed are three
        // very different answers.
        matchCount: m.match_count,
        lastMatchAt: m.last_match_at,
      })),
      total: rows.length,
      summary:
        rows.length === 0
          ? 'No watchlist monitors configured yet.'
          : `${rows.length} monitor(s): ${rows.map((m) => m.name).join(', ')}.`,
    };
  } catch (err) {
    return {
      monitors: [],
      total: 0,
      error: err instanceof Error ? err.message : 'unknown error',
      summary: 'Could not read the watchlist.',
    };
  }
}

// ─── Map Control ───

export async function mapFlyTo(input: Record<string, unknown>): Promise<unknown> {
  const { geocodeForward } = await import('@/lib/mapbox/geocode-api');

  const location = input.location as string | undefined;
  const lat = input.lat as number | undefined;
  const lon = input.lon as number | undefined;
  const zoom = input.zoom as number | undefined;

  // Prefer geocoding the location name (hits reliable static table + Mapbox API)
  // over trusting agent-provided lat/lon which may be hallucinated
  if (location) {
    const geo = await geocodeForward(location);
    if (geo) {
      return { __map_command: 'fly_to', lat: geo.lat, lon: geo.lon, zoom: zoom ?? 6 };
    }
  }

  // Agent provided lat/lon without location — likely hallucinated coordinates.
  // Log a warning so we can track this pattern.
  if (lat != null && lon != null) {
    return { __map_command: 'fly_to', lat, lon, zoom: zoom ?? 6 };
  }

  return {
    error: location
      ? `Unknown location: "${location}". Provide lat/lon instead.`
      : 'Provide either location name or lat/lon coordinates.',
  };
}

export async function mapHighlightMarkers(input: Record<string, unknown>): Promise<unknown> {
  const category = input.category as string | undefined;
  const ids = input.ids as string[] | undefined;

  return {
    __map_command: 'highlight_markers',
    category: category ?? null,
    ids: ids ?? [],
  };
}

export async function mapToggleLayer(input: Record<string, unknown>): Promise<unknown> {
  const layer = input.layer as string;
  const visible = input.visible as boolean | undefined;

  return {
    __map_command: 'toggle_layer',
    layer,
    visible: visible ?? null,
  };
}

export async function mapDrawAttention(input: Record<string, unknown>): Promise<unknown> {
  const { geocodeForward } = await import('@/lib/mapbox/geocode-api');

  const location = input.location as string | undefined;
  let lat = input.lat as number | undefined;
  let lon = input.lon as number | undefined;
  const label = input.label as string | undefined;
  const duration = (input.duration as number) ?? 5;

  if (location && (lat == null || lon == null)) {
    const geo = await geocodeForward(location);
    if (geo) {
      lat = geo.lat;
      lon = geo.lon;
    }
  }

  if (lat == null || lon == null) {
    return { error: 'Could not determine coordinates for attention area.' };
  }

  return {
    __map_command: 'draw_attention',
    lat,
    lon,
    label: label ?? location ?? 'Alert',
    duration,
    color: '#ff0040',
  };
}

export async function mapPlaceMarkers(input: Record<string, unknown>): Promise<unknown> {
  const { geocodeForward } = await import('@/lib/mapbox/geocode-api');

  const rawMarkers = input.markers as Array<Record<string, unknown>>;
  const ttl = (input.ttl as number) ?? 60;

  const resolved: Array<Record<string, unknown>> = [];

  for (const m of rawMarkers) {
    let lat = m.lat as number | undefined;
    let lon = m.lon as number | undefined;
    const location = m.location as string | undefined;

    // Geocode by name if no coords provided
    if ((lat == null || lon == null) && location) {
      const geo = await geocodeForward(location);
      if (geo) {
        lat = geo.lat;
        lon = geo.lon;
      }
    }

    if (lat == null || lon == null) continue; // Skip unresolvable

    resolved.push({
      lat,
      lon,
      label: m.label as string,
      description: (m.description as string) ?? '',
      severity: (m.severity as string) ?? 'medium',
      category: (m.category as string) ?? 'strategic',
    });
  }

  if (resolved.length === 0) {
    return { error: 'No markers could be geocoded' };
  }

  return {
    __map_command: 'place_markers',
    markers: resolved,
    ttl,
  };
}

// ─── Spatial Intelligence ───

export async function mapQueryViewport(_input: Record<string, unknown>): Promise<unknown> {
  const { getViewportContext } = await import('@/lib/mapbox/viewport-context');
  const snapshot = getViewportContext();
  if (!snapshot) {
    return { error: 'No viewport data available. The map may not be visible.' };
  }
  return {
    viewport: {
      center: snapshot.center,
      zoom: snapshot.zoom,
      zoomTier: snapshot.zoomTier,
      baseStyle: snapshot.baseStyle,
      activeLayers: snapshot.activeLayers,
      klammerMarkers: snapshot.klammerMarkers,
    },
    features: snapshot.features,
    featureCount: snapshot.features.length,
    capturedAt: snapshot.capturedAt,
  };
}

export async function mapSearchFeatures(input: Record<string, unknown>): Promise<unknown> {
  const query = input.query as string;
  const near = input.near as { lat: number; lon: number } | undefined;
  const types = input.types as string[] | undefined;
  const limit = Math.min((input.limit as number) ?? 5, 10);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return { error: 'Mapbox token not configured.' };

  // Check static geocode table first — prevents proximity bias from
  // overriding known-good locations like "Times Square"
  const { geocodeLocation } = await import('@/lib/mapbox/geocode');
  const staticMatch = geocodeLocation(query.toLowerCase().trim());
  if (staticMatch) {
    return {
      __map_command: 'search_results',
      results: [
        {
          name: query,
          type: 'place',
          category: 'landmark',
          address: query,
          lat: staticMatch.lat,
          lon: staticMatch.lon,
        },
      ],
      query,
    };
  }

  // If no `near` coords, read from viewport context
  const { getViewportContext } = await import('@/lib/mapbox/viewport-context');
  const viewport = getViewportContext();
  const proximity = near ?? viewport?.center;

  const params = new URLSearchParams({
    q: query,
    access_token: token,
    limit: String(limit),
    language: 'en',
  });
  if (proximity) params.set('proximity', `${proximity.lon},${proximity.lat}`);
  if (types?.length) params.set('types', types.join(','));

  try {
    const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`);
    if (!res.ok) return { error: `Mapbox geocoding failed: ${res.status}` };

    const data = (await res.json()) as {
      features?: Array<{
        properties: Record<string, unknown>;
        geometry: { coordinates: [number, number] };
      }>;
    };
    const results =
      data.features?.map((f) => ({
        name: (f.properties.name as string) ?? (f.properties.full_address as string),
        type: f.properties.feature_type as string,
        category: (f.properties.poi_category as string) ?? (f.properties.feature_type as string),
        address: f.properties.full_address as string,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      })) ?? [];

    if (results.length === 0) return { results: [], message: 'No results found.' };

    return {
      __map_command: 'search_results',
      results,
      query,
    };
  } catch (err) {
    return {
      error: `Mapbox search failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── TV Context ───

export async function fetchTvContext(input: Record<string, unknown>): Promise<unknown> {
  const channelId = input.channel_id as string | undefined;
  if (!channelId) {
    return {
      error:
        'No channel_id provided. The user\'s current channel is already in your system prompt under "ACTIVE LIVESTREAM". Use that context to answer. If you need to call this tool, extract the channelId from there.',
    };
  }

  try {
    const { assembleTvContext } = await import('@/lib/data/collectors/tv-context');
    const context = await assembleTvContext(channelId);
    if (!context) {
      return { error: `Unknown channel: ${channelId}` };
    }
    return context;
  } catch (err) {
    return {
      error: `TV context fetch failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

// ─── TV Control ───

const CHANNEL_ALIASES: Record<string, string> = {
  bloomberg: 'bloomberg',
  bb: 'bloomberg',
  cnbc: 'cnbc',
  yahoo: 'yahoo',
  'yahoo finance': 'yahoo',
  fox: 'fox-biz',
  'fox business': 'fox-biz',
  'fox biz': 'fox-biz',
  aj: 'aljazeera',
  'al jazeera': 'aljazeera',
  aljazeera: 'aljazeera',
  sky: 'sky',
  'sky news': 'sky',
  'france 24': 'france24',
  france24: 'france24',
  dw: 'dw',
  'dw news': 'dw',
  'deutsche welle': 'dw',
  ndtv: 'ndtv',
  nhk: 'nhk',
  'nhk world': 'nhk',
  nasa: 'nasa',
  'nasa tv': 'nasa',
  cbs: 'cbs-news',
  'cbs news': 'cbs-news',
  reuters: 'reuters',
  euronews: 'euronews',
  wion: 'wion',
  cna: 'cna',
  cheddar: 'cheddar',
  coindesk: 'coindesk',
};

export async function tvSwitchChannel(input: Record<string, unknown>): Promise<unknown> {
  const { resolveChannelConfig } = await import('@/lib/data/livestream-channels');

  const raw = (input.channel as string).toLowerCase().trim();
  const channelId = CHANNEL_ALIASES[raw] ?? raw;
  const channels = resolveChannelConfig();
  const channel = channels.find((c) => c.id === channelId);

  if (!channel) {
    return {
      error: `Unknown channel: "${raw}". Valid channels: ${channels.map((c) => c.id).join(', ')}`,
    };
  }

  const panel = (input.panel as string | undefined) ?? 'auto';

  // Fetch TV context for the new channel so Claude can describe what's on
  let nowPlaying: Record<string, unknown> | null = null;
  try {
    const { assembleTvContext } = await import('@/lib/data/collectors/tv-context');
    const tvContext = await assembleTvContext(channelId);
    if (tvContext) {
      nowPlaying = {
        videoTitle: tvContext.videoMeta?.title ?? null,
        description: tvContext.description,
        channelHeadlines: tvContext.channelHeadlines?.slice(0, 5).map((h) => h.title) ?? [],
        livePage: tvContext.livePage
          ? {
              headlines: tvContext.livePage.headlines.slice(0, 5).map((h) => h.title),
              liveUpdates: tvContext.livePage.liveUpdates.slice(0, 3),
            }
          : null,
        ccSummary: tvContext.ccSummary?.text ?? null,
      };
    }
  } catch {
    // Best-effort — agent can still confirm the switch without context
  }

  return {
    __channel_command: 'switch',
    channelId: channel.id,
    channelLabel: channel.label,
    category: channel.category,
    panel,
    nowPlaying,
    instruction:
      'Channel switched successfully and is now playing. Respond with light markdown: bold the **channel name**, one sentence on what is airing, then 2-3 bullet points for top headlines/topics. Keep it to 3-4 lines max. If nowPlaying is null, just confirm the switch with the bolded channel name.',
  };
}

export async function tvListChannels(input: Record<string, unknown>): Promise<unknown> {
  const { resolveChannelConfig } = await import('@/lib/data/livestream-channels');

  const channels = resolveChannelConfig();
  const category = input.category as string | undefined;

  // Best-effort live status fetch
  let liveStatus: Record<string, { isLive: boolean }> = {};
  try {
    const res = await dataRequest(`${baseUrl}/api/data/livestream/resolve`);
    if (res.ok) {
      liveStatus = (await res.json()) as Record<string, { isLive: boolean }>;
    }
  } catch {
    // Best-effort — continue without live status
  }

  const filtered = category ? channels.filter((c) => c.category === category) : channels;

  return {
    channels: filtered.map((c) => ({
      id: c.id,
      label: c.label,
      category: c.category,
      type: c.type,
      isLive: c.type === 'hls' ? true : (liveStatus[c.id]?.isLive ?? null),
      description: c.description ?? null,
    })),
    count: filtered.length,
    note: 'HLS channels are always live. YouTube channel live status depends on API resolution. Check your system prompt for the currently active channel.',
  };
}

// ─── Web fetch / search / crawl / extract (FireCrawl + GitHub) ───
//
// Four DATA_RETRIEVAL tools that give Max real web powers: read a pasted URL
// (GitHub repos via the live REST API first, else a FireCrawl scrape), search
// with full page content, crawl a bounded set of pages, and pull structured
// fields. Each follows the canonical handler contract: parse/validate → cache →
// rate-limit → client → cap content → cache (success only) → return a plain
// object with a top-level `sourceUrl`. Errors are `{ error }` (+ `sourceUrl`
// when a URL is known). They NEVER throw (rules #4 / #9).
//
// The tokenBudgets in tools.ts are sized ABOVE each tool's worst-case
// serialized size so ToolResultCompressor keeps policy FULL and never shreds
// fetched page content to 200 chars. Keep the content caps here in sync with
// those budgets.

const HTTP_URL_RE = /^https?:\/\//i;

/** Tiny djb2 string hash (no crypto dep) — bounds the extract cache key. */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // >>> 0 → unsigned; base36 keeps the key short.
  return (hash >>> 0).toString(36);
}

// ─── extract_structured presets (cyber-focused, freeform fallback) ───
// Each preset supplies a default `prompt` + JSON Schema `schema`. A user-
// supplied prompt/schema overrides the preset's. Unknown preset → error.

interface ExtractPreset {
  prompt: string;
  schema: Record<string, unknown>;
}

const EXTRACT_PRESETS: Record<string, ExtractPreset> = {
  cve_advisory: {
    prompt:
      'Extract every CVE discussed on the page with its severity, CVSS score, affected products (vendor/product/version range), patched/fixed versions, and any documented workarounds. Add a one-line summary of the advisory.',
    schema: {
      type: 'object',
      properties: {
        cves: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              severity: { type: 'string' },
              cvss: { type: 'string' },
              affectedProducts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    vendor: { type: 'string' },
                    product: { type: 'string' },
                    versionRange: { type: 'string' },
                  },
                },
              },
              patchVersions: { type: 'array', items: { type: 'string' } },
              workarounds: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        summary: { type: 'string' },
      },
    },
  },
  iocs: {
    prompt:
      'Extract every indicator of compromise (IOC) on the page — IPs, domains, URLs, file hashes (md5/sha1/sha256), email addresses, registry keys — with the IOC type and a short note of the surrounding context.',
    schema: {
      type: 'object',
      properties: {
        iocs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              value: { type: 'string' },
              context: { type: 'string' },
            },
          },
        },
      },
    },
  },
  affected_products: {
    prompt:
      'Extract every affected product on the page with its vendor, product name, the affected version range, and the fixed/patched version where stated.',
    schema: {
      type: 'object',
      properties: {
        products: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              vendor: { type: 'string' },
              product: { type: 'string' },
              affectedVersions: { type: 'string' },
              fixedVersion: { type: 'string' },
            },
          },
        },
      },
    },
  },
  patch_info: {
    prompt:
      'Extract patch / fix information from the page: for each affected product, the fixed version, the advisory URL, and the release date of the patch.',
    schema: {
      type: 'object',
      properties: {
        patches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product: { type: 'string' },
              fixedVersion: { type: 'string' },
              advisoryUrl: { type: 'string' },
              releasedAt: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

interface ResolvedExtract {
  prompt?: string;
  schema?: unknown;
  error?: string;
}

/**
 * Resolve the prompt + schema for an extract call. A named preset supplies the
 * defaults; a user-supplied prompt and/or schema override the preset's. Unknown
 * preset → error. No preset AND no prompt AND no schema → error.
 */
function resolveExtractPreset(
  presetRaw: unknown,
  promptRaw: unknown,
  schemaRaw: unknown,
): ResolvedExtract {
  const preset = typeof presetRaw === 'string' ? presetRaw : undefined;
  const userPrompt = typeof promptRaw === 'string' && promptRaw.trim() ? promptRaw : undefined;
  const userSchema =
    schemaRaw && typeof schemaRaw === 'object' && !Array.isArray(schemaRaw) ? schemaRaw : undefined;

  if (preset) {
    const def = EXTRACT_PRESETS[preset];
    if (!def) {
      return {
        error: `extract_structured: unknown preset "${preset}" — valid presets: ${Object.keys(
          EXTRACT_PRESETS,
        ).join(', ')}.`,
      };
    }
    // Preset supplies defaults; user prompt/schema override when provided.
    return { prompt: userPrompt ?? def.prompt, schema: userSchema ?? def.schema };
  }

  if (!userPrompt && !userSchema) {
    return {
      error:
        'extract_structured: provide a preset, a prompt, or a schema describing the fields to extract.',
    };
  }
  return { prompt: userPrompt, schema: userSchema };
}

/**
 * read_url — fetch a single pasted URL. GitHub repo URLs are read via the live
 * REST API first (works even on repos too fresh to be web-indexed); everything
 * else falls back to a FireCrawl scrape.
 */
export async function readUrl(input: Record<string, unknown>): Promise<unknown> {
  const url = String(input.url ?? '').trim();
  try {
    await validatePublicUrl(url);
  } catch {
    return { error: 'unsafe_url' };
  }
  if (!HTTP_URL_RE.test(url)) {
    return { error: 'read_url: a valid http(s) URL is required.' };
  }

  // ── GitHub fast path FIRST ── live repo data even when un-indexed.
  const { parseGithubUrl, fetchGithubRepo } = await import('@/lib/data/github-repo');
  const p = parseGithubUrl(url);
  if (p.kind === 'repo' && p.owner && p.repo) {
    const repo = await fetchGithubRepo(p.owner, p.repo, {
      includeFileTree: Boolean(input.include_file_tree),
    });
    if (repo) {
      return { kind: 'github_repo', sourceUrl: repo.sourceUrl, repo };
    }
    // null → repo 404/private/rate-limited → fall through to a scrape.
  }

  const cacheKey = `webfetch:${url}`;
  const cached = await webGetCached<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  if (!webCheckRateLimit('firecrawl_read')) {
    return { error: 'read_url: rate limit reached — try again shortly.', sourceUrl: url };
  }

  const { firecrawlScrape } = await import('@/lib/data/firecrawl');
  const md = await firecrawlScrape(url, { maxChars: 10500 });
  if (md == null) {
    return {
      error: `read_url: could not fetch ${url} (blocked, paywalled, no key, or timed out).`,
      sourceUrl: url,
    };
  }

  const truncated = md.length > 10000;
  const content = truncated ? `${md.slice(0, 10000)}\n\n…[truncated]` : md;
  const result = {
    kind: 'markdown',
    url,
    sourceUrl: url,
    contentMarkdown: content,
    truncated,
    charCount: content.length,
  };

  await webSetCache(cacheKey, result);
  return result;
}

/**
 * web_search — search the web via FireCrawl and return result page CONTENT (not
 * just snippets), so Max can read and cite real article bodies.
 */
export async function webSearch(input: Record<string, unknown>): Promise<unknown> {
  const query = String(input.query ?? '');
  if (!query.trim()) {
    return { error: 'web_search: a query is required.' };
  }
  const limit = Math.min(Number(input.limit) || 5, 8);

  const cacheKey = `websearch:${limit}:${query.toLowerCase().trim()}`;
  const cached = await webGetCached<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  if (!webCheckRateLimit('firecrawl_search')) {
    return { error: 'web_search: rate limit reached — try again shortly.' };
  }

  const { firecrawlSearch } = await import('@/lib/data/firecrawl');

  try {
    const data = await firecrawlSearch(query, limit, {
      scrapeContent: true,
      maxCharsPerResult: 2500,
    });
    const results = data.results.map((r) => ({
      title: r.title,
      url: r.url,
      sourceUrl: r.url,
      snippet: r.description,
      content: r.markdown ?? null,
    }));
    const result = { query, count: results.length, results };
    await webSetCache(cacheKey, result);
    return result;
  } catch (err) {
    return { error: `web_search failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

/**
 * crawl_site — crawl a bounded set of pages from one site/docs section. Reports
 * an honest `status` (a `timeout`/`partial` still returns the pages gathered);
 * never invents pages.
 */
export async function crawlSite(input: Record<string, unknown>): Promise<unknown> {
  const url = String(input.url ?? '').trim();
  try {
    await validatePublicUrl(url);
  } catch {
    return { error: 'unsafe_url' };
  }
  if (!HTTP_URL_RE.test(url)) {
    return { error: 'crawl_site: a valid http(s) URL is required.' };
  }

  const limit = Math.min(Number(input.limit) || 8, 10);
  const maxDepth = Math.min(Number(input.maxDepth) || 2, 2);

  const cacheKey = `webcrawl:${maxDepth}:${limit}:${url}`;
  const cached = await webGetCached<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  if (!webCheckRateLimit('firecrawl_crawl')) {
    return { error: 'crawl_site: rate limit reached — try again shortly.', sourceUrl: url };
  }

  const { firecrawlCrawl } = await import('@/lib/data/firecrawl');
  const { status, pages, pagesCrawled, note } = await firecrawlCrawl(url, {
    limit,
    maxDepth,
    maxCharsPerPage: 3500,
    maxWaitMs: 75_000,
  });

  if (status === 'no_key') {
    return { error: 'crawl_site: web crawling is not configured.', sourceUrl: url };
  }
  if (status === 'failed' && pages.length === 0) {
    return {
      error: `crawl_site: crawl failed${note ? ` (${note})` : ''}.`,
      sourceUrl: url,
    };
  }

  const result = {
    rootUrl: url,
    sourceUrl: url,
    status,
    pagesCrawled,
    note: note ?? null,
    pages: pages.map((pg) => ({
      url: pg.url,
      sourceUrl: pg.url,
      title: pg.title ?? null,
      content: pg.markdown,
    })),
  };

  // Cache only honest, useful states (completed / partial / timeout) — never a
  // hard failure (no 6h poison).
  if (status === 'completed' || status === 'partial' || status === 'timeout') {
    await webSetCache(cacheKey, result);
  }
  return result;
}

/**
 * extract_structured — pull structured fields from one or more URLs. Cyber
 * presets (cve_advisory / iocs / affected_products / patch_info) supply a
 * default prompt + JSON schema; a freeform prompt and/or schema also works.
 */
export async function extractStructured(input: Record<string, unknown>): Promise<unknown> {
  const candidate = Array.isArray(input.urls) ? (input.urls as unknown[]) : [input.url as unknown];
  const urls = candidate
    .filter((u): u is string => typeof u === 'string' && HTTP_URL_RE.test(u))
    .slice(0, 5);
  if (urls.length === 0) {
    return { error: 'extract_structured: at least one valid http(s) url (or urls[]) is required.' };
  }

  const presetName = typeof input.preset === 'string' ? input.preset : undefined;
  const resolved = resolveExtractPreset(input.preset, input.prompt, input.schema);
  if (resolved.error) {
    return { error: resolved.error, sourceUrl: urls[0] };
  }

  const cacheKey = `webextract:${presetName ?? 'free'}:${urls.join(',')}:${djb2(
    resolved.prompt ?? '',
  )}`;
  const cached = await webGetCached<Record<string, unknown>>(cacheKey);
  if (cached) return cached;

  if (!webCheckRateLimit('firecrawl_extract')) {
    return {
      error: 'extract_structured: rate limit reached — try again shortly.',
      sourceUrl: urls[0],
    };
  }

  const { firecrawlExtract } = await import('@/lib/data/firecrawl');
  const { status, data, note } = await firecrawlExtract(urls, {
    prompt: resolved.prompt,
    schema: resolved.schema,
    maxWaitMs: 60_000,
  });

  if (status === 'no_key' || status === 'failed') {
    return {
      error: `extract_structured: extraction ${status === 'no_key' ? 'is not configured' : 'failed'}${
        note ? ` (${note})` : ''
      }.`,
      sourceUrl: urls[0],
    };
  }

  const result = {
    sourceUrl: urls[0],
    urls,
    preset: presetName ?? null,
    status,
    data,
    note: note ?? null,
  };

  if (status === 'completed') {
    await webSetCache(cacheKey, result);
  }
  return result;
}

// ─── YouTube ───

export async function youtubeSearch(input: Record<string, unknown>): Promise<unknown> {
  const query = input.query as string;
  const filters = input.filters as Record<string, unknown> | undefined;

  try {
    const params = new URLSearchParams({ q: query });
    if (filters?.publishedAfter) params.set('publishedAfter', filters.publishedAfter as string);
    if (filters?.videoDuration) params.set('videoDuration', filters.videoDuration as string);
    if (filters?.order) params.set('order', filters.order as string);
    if (filters?.maxResults) params.set('maxResults', String(filters.maxResults));

    const response = await dataRequest(`${baseUrl}/api/data/youtube/search?${params}`);
    if (!response.ok) return { error: `YouTube search returned ${response.status}` };
    const data = await response.json();
    const results = data.results ?? [];

    if (results.length === 0) {
      return { error: 'No videos found. Try different search terms.' };
    }

    return {
      __youtube_command: 'search_results',
      autoPlay: results[0],
      alternatives: results.slice(1),
      query,
      resultCount: results.length,
      instruction:
        'Video is now playing in the YouTube panel. Present the auto-playing video with bold **title**, channel name, and duration. Then list alternatives numbered #2-#5 with title, channel, and duration. Keep response to 4-6 lines. If user says "play #N", use youtube_play with that video\'s ID.',
    };
  } catch (err) {
    return { error: `YouTube search failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}

export async function youtubePlay(input: Record<string, unknown>): Promise<unknown> {
  const videoId = input.videoId as string;
  const title = input.title as string | undefined;

  return {
    __youtube_command: 'play',
    videoId,
    title: title ?? null,
    instruction: 'Video is now playing. Confirm with bold **title** in one sentence.',
  };
}

export async function youtubeQueue(input: Record<string, unknown>): Promise<unknown> {
  const videos = input.videos as Array<{ videoId: string; title?: string }>;

  if (!videos || videos.length === 0) {
    return { error: 'No videos provided for queue.' };
  }

  return {
    __youtube_command: 'queue',
    videos,
    autoPlayFirst: true,
    instruction: `Queued ${videos.length} videos. First video is now playing. List the queue with numbered titles.`,
  };
}

// ─── Memory ───

export async function readMemory(input: Record<string, unknown>): Promise<unknown> {
  const { getAgentMemory } = await import('@/lib/db/queries/agent');

  try {
    const memories = await getAgentMemory({
      topic: input.topic as string,
      limit: 10,
    });
    return {
      memories: memories.map((m) => ({
        topic: m.topic,
        content: m.content,
        importance: m.importance,
        created: m.created_at,
        accessCount: m.access_count,
      })),
    };
  } catch {
    return { memories: [], note: 'Memory system unavailable' };
  }
}

export async function writeMemory(input: Record<string, unknown>): Promise<unknown> {
  const { writeAgentMemory } = await import('@/lib/db/queries/agent');

  try {
    const id = await writeAgentMemory({
      topic: input.topic as string,
      content: input.content as string,
      importance: (input.importance as string) ?? 'medium',
    });
    return { stored: true, id };
  } catch {
    return { stored: false, note: 'Memory system unavailable' };
  }
}
