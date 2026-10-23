import { dataRequest } from '@/lib/data/service-request';

/**
 * Cross-panel data correlation engine.
 * When autonomous triggers fire, this module gathers related data from
 * adjacent panels to provide the agent with cross-source context.
 */

const baseUrl = 'http://service.invalid';

async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await dataRequest(url);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

interface CorrelationContext {
  relatedMarkets?: unknown;
  relatedNews?: unknown;
  relatedCongress?: unknown;
  relatedPredictions?: unknown;
  relatedWhales?: unknown;
  relatedCrypto?: unknown;
  relatedEarnings?: unknown;
  relatedFedCalendar?: unknown;
  relatedArticle?: string;
  // ─── Cyber (the domain this product actually monitors) ───
  relatedCve?: unknown;
  relatedDefenses?: unknown;
  relatedIncidents?: unknown;
  relatedActor?: unknown;
  relatedAlerts?: unknown;
}

/**
 * Best-effort AEGIS lookup. The tool handlers are the same SQL the agent's own
 * tools run, so correlation and tool-use can't disagree about the data.
 */
async function safeAegis(
  fn: (input: Record<string, unknown>) => Promise<unknown>,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await fn(input);
  } catch {
    return null;
  }
}

/** The active alert board, for "what else is on fire right now" context. */
async function recentAlerts(limit = 5): Promise<unknown> {
  try {
    const { listPipelineAlerts } = await import('@/lib/db/queries/pipeline-alerts');
    const rows = await listPipelineAlerts({ limit });
    return rows.length
      ? rows.map((r) => ({
          severity: r.severity,
          alertType: r.alert_type,
          entityId: r.entity_id,
          headline: r.headline,
        }))
      : null;
  } catch {
    return null;
  }
}

/**
 * Cyber correlation for a CVE-shaped signal (KEV addition, CVE panel click).
 * Pulls the full CVE package plus the defenses that actually mitigate it —
 * the two things a MODE 3 "what do I do about this" answer needs.
 */
async function correlateCve(cveId: string): Promise<CorrelationContext> {
  const { aegisCveDetail, aegisMatchDefenses } = await import('./aegis-tool-handlers');
  const [cve, defenses, alerts] = await Promise.all([
    safeAegis(aegisCveDetail, { cve_id: cveId }),
    safeAegis(aegisMatchDefenses, { cve_id: cveId }),
    recentAlerts(),
  ]);
  return {
    ...(cve ? { relatedCve: cve } : {}),
    ...(defenses ? { relatedDefenses: defenses } : {}),
    ...(alerts ? { relatedAlerts: alerts } : {}),
  };
}

/** Cyber correlation for a breach/incident signal — comparables + the board. */
async function correlateIncident(industry?: string): Promise<CorrelationContext> {
  const { aegisFindIncidentComps } = await import('./aegis-tool-handlers');
  const [comps, alerts] = await Promise.all([
    safeAegis(aegisFindIncidentComps, industry ? { industry } : {}),
    recentAlerts(),
  ]);
  return {
    ...(comps ? { relatedIncidents: comps } : {}),
    ...(alerts ? { relatedAlerts: alerts } : {}),
  };
}

/**
 * Render the gathered context as a prompt block. The finance keys below are
 * still reachable from finance-era PANEL CLICKS (markets/crypto/whales/…),
 * which the deck still ships — only the finance *activation triggers* were
 * removed.
 */
export function formatCorrelationContext(context: CorrelationContext): string {
  const parts: string[] = [];

  if (context.relatedMarkets) {
    parts.push(`RELATED MARKETS: ${JSON.stringify(context.relatedMarkets).slice(0, 500)}`);
  }
  if (context.relatedNews) {
    parts.push(`RELATED NEWS: ${JSON.stringify(context.relatedNews).slice(0, 500)}`);
  }
  if (context.relatedCongress) {
    parts.push(`RELATED CONGRESS TRADES: ${JSON.stringify(context.relatedCongress).slice(0, 500)}`);
  }
  if (context.relatedPredictions) {
    parts.push(`RELATED PREDICTIONS: ${JSON.stringify(context.relatedPredictions).slice(0, 500)}`);
  }
  if (context.relatedWhales) {
    parts.push(`RELATED WHALE ACTIVITY: ${JSON.stringify(context.relatedWhales).slice(0, 500)}`);
  }
  if (context.relatedCrypto) {
    parts.push(`RELATED CRYPTO: ${JSON.stringify(context.relatedCrypto).slice(0, 500)}`);
  }
  if (context.relatedEarnings) {
    parts.push(`RELATED EARNINGS: ${JSON.stringify(context.relatedEarnings).slice(0, 500)}`);
  }
  if (context.relatedFedCalendar) {
    const fed = JSON.stringify(context.relatedFedCalendar).slice(0, 500);
    parts.push(`RELATED FED CALENDAR: ${fed}`);
  }
  if (context.relatedArticle) {
    parts.push(`ARTICLE CONTENT:\n${context.relatedArticle.slice(0, 2500)}`);
  }
  if (context.relatedCve) {
    parts.push(`RELATED CVE PACKAGE: ${JSON.stringify(context.relatedCve).slice(0, 1500)}`);
  }
  if (context.relatedDefenses) {
    parts.push(`MATCHING DEFENSES: ${JSON.stringify(context.relatedDefenses).slice(0, 800)}`);
  }
  if (context.relatedIncidents) {
    parts.push(`COMPARABLE INCIDENTS: ${JSON.stringify(context.relatedIncidents).slice(0, 800)}`);
  }
  if (context.relatedActor) {
    parts.push(`THREAT ACTOR PROFILE: ${JSON.stringify(context.relatedActor).slice(0, 800)}`);
  }
  if (context.relatedAlerts) {
    parts.push(`ACTIVE ALERT BOARD: ${JSON.stringify(context.relatedAlerts).slice(0, 600)}`);
  }

  if (parts.length === 0) return '';

  return `\n\n## CROSS-PANEL CORRELATION DATA\n${parts.join('\n')}`;
}

/**
 * Gather cross-panel correlation data for a panel click.
 * Maps each sourcePanel to adjacent data sources for corroboration.
 * Runs all fetches in parallel — best-effort, never throws.
 */
export async function correlateClickContext(
  sourcePanel: string,
  _dataType: string,
  trendData: Record<string, unknown>,
): Promise<string> {
  const symbol = (trendData.symbol as string) ?? '';
  const articleUrl = (trendData.url as string) ?? (trendData.sourceUrl as string) ?? '';

  let context: CorrelationContext = {};

  try {
    switch (sourcePanel) {
      case 'markets':
      case 'heatmap': {
        const [news, congress, predictions] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/news?category=finance&limit=5`),
          symbol
            ? safeFetch(`${baseUrl}/api/data/congress?symbol=${symbol}`)
            : Promise.resolve(null),
          safeFetch(`${baseUrl}/api/data/polymarket?category=economics`),
        ]);
        context = { relatedNews: news, relatedCongress: congress, relatedPredictions: predictions };
        break;
      }
      case 'crypto': {
        const [news, whales, predictions] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/news?category=finance&limit=5`),
          safeFetch(`${baseUrl}/api/data/whales`),
          safeFetch(`${baseUrl}/api/data/polymarket?category=crypto`),
        ]);
        context = { relatedNews: news, relatedWhales: whales, relatedPredictions: predictions };
        break;
      }
      case 'whales': {
        const [crypto, news] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/crypto`),
          safeFetch(`${baseUrl}/api/data/news?category=finance&limit=5`),
        ]);
        context = { relatedCrypto: crypto, relatedNews: news };
        break;
      }
      case 'congress': {
        const [markets, news, earnings] = await Promise.all([
          symbol
            ? safeFetch(`${baseUrl}/api/data/markets?symbols=${symbol}`)
            : Promise.resolve(null),
          safeFetch(`${baseUrl}/api/data/news?category=government&limit=5`),
          safeFetch(`${baseUrl}/api/data/earnings`),
        ]);
        context = { relatedMarkets: markets, relatedNews: news, relatedEarnings: earnings };
        break;
      }
      case 'news':
      case 'newsFeed': {
        const fetches: Promise<unknown>[] = [
          safeFetch(`${baseUrl}/api/data/markets?symbols=SPY,QQQ,VIX`),
          safeFetch(`${baseUrl}/api/data/polymarket`),
        ];
        // Scrape the full article if a URL is available
        if (articleUrl) {
          const { firecrawlScrape } = await import('@/lib/data/firecrawl');
          fetches.push(firecrawlScrape(articleUrl));
        } else {
          fetches.push(Promise.resolve(null));
        }
        const [markets, predictions, article] = await Promise.all(fetches);
        context = {
          relatedMarkets: markets,
          relatedPredictions: predictions,
          relatedArticle: (article as string) ?? undefined,
        };
        break;
      }
      case 'polymarket': {
        const [news, markets] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/news?limit=5`),
          safeFetch(`${baseUrl}/api/data/markets?symbols=SPY`),
        ]);
        context = { relatedNews: news, relatedMarkets: markets };
        break;
      }
      case 'fed': {
        const [markets, news, fedCalendar] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/markets?symbols=TLT,GLD,SPY`),
          safeFetch(`${baseUrl}/api/data/news?category=government&limit=3`),
          safeFetch(`${baseUrl}/api/data/fed-calendar`),
        ]);
        context = {
          relatedMarkets: markets,
          relatedNews: news,
          relatedFedCalendar: fedCalendar,
        };
        break;
      }
      case 'earnings': {
        const [markets, congress, news] = await Promise.all([
          symbol
            ? safeFetch(`${baseUrl}/api/data/markets?symbols=${symbol}`)
            : Promise.resolve(null),
          symbol
            ? safeFetch(`${baseUrl}/api/data/congress?symbol=${symbol}`)
            : Promise.resolve(null),
          safeFetch(`${baseUrl}/api/data/news?category=finance&limit=3`),
        ]);
        context = { relatedMarkets: markets, relatedCongress: congress, relatedNews: news };
        break;
      }
      case 'contracts': {
        const [news, congress] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/news?category=government&limit=3`),
          safeFetch(`${baseUrl}/api/data/congress`),
        ]);
        context = { relatedNews: news, relatedCongress: congress };
        break;
      }
      case 'twitter': {
        const [news, markets] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/news?limit=5`),
          safeFetch(`${baseUrl}/api/data/markets?symbols=SPY`),
        ]);
        context = { relatedNews: news, relatedMarkets: markets };
        break;
      }
      case 'map': {
        const name = (trendData.name as string) ?? '';
        const type = (trendData.type as string) ?? '';
        const isFinancial =
          type.includes('bank') || type.includes('financ') || type.includes('stock');
        const fetches: Promise<unknown>[] = [
          safeFetch(
            `${baseUrl}/api/data/news?category=${isFinancial ? 'finance' : 'politics'}&limit=5`,
          ),
        ];
        if (isFinancial) {
          fetches.push(safeFetch(`${baseUrl}/api/data/markets?symbols=SPY,QQQ`));
        } else {
          fetches.push(Promise.resolve(null));
        }
        if (name) {
          fetches.push(
            safeFetch(`${baseUrl}/api/data/osint?query=${encodeURIComponent(name)}&limit=3`),
          );
        } else {
          fetches.push(Promise.resolve(null));
        }
        const [news, markets, intel] = await Promise.all(fetches);
        context = {
          relatedNews: news,
          ...(markets ? { relatedMarkets: markets } : {}),
          ...(intel ? { relatedPredictions: intel } : {}),
        };
        break;
      }
      // ─── Cyber panels ───
      // The whole switch above was finance-era; every cyber panel click fell
      // through to `default` and reached the agent with zero correlation, which
      // is exactly backwards for a cybersecurity product.
      case 'cvePipeline':
      case 'kevAlerts':
      case 'breakingAlert': {
        const cveId =
          (trendData.cveId as string) ??
          (trendData.cve_id as string) ??
          (trendData.entityKind === 'cve' ? (trendData.entityId as string) : '');
        if (cveId) {
          context = await correlateCve(cveId);
        } else {
          const alerts = await recentAlerts();
          context = alerts ? { relatedAlerts: alerts } : {};
        }
        break;
      }
      case 'alerts': {
        const cveId = trendData.entityKind === 'cve' ? (trendData.entityId as string) : '';
        context = cveId ? await correlateCve(cveId) : await correlateIncident();
        break;
      }
      case 'breachDisclosure':
      case 'incidentAssessment': {
        context = await correlateIncident(trendData.industry as string | undefined);
        break;
      }
      case 'threatActorScores': {
        const { aegisScoreThreatActor } = await import('./aegis-tool-handlers');
        const actorName =
          (trendData.actorId as string) ??
          (trendData.actor as string) ??
          (trendData.name as string) ??
          '';
        const actor = actorName
          ? await safeAegis(aegisScoreThreatActor, { actor: actorName })
          : null;
        context = { ...(actor ? { relatedActor: actor } : {}) };
        break;
      }
      case 'patchTracker':
      case 'iocFeed': {
        const [news, alerts] = await Promise.all([
          safeFetch(`${baseUrl}/api/data/news?category=cyber&limit=5`),
          recentAlerts(),
        ]);
        context = {
          ...(news ? { relatedNews: news } : {}),
          ...(alerts ? { relatedAlerts: alerts } : {}),
        };
        break;
      }
      default:
        // Unknown panel — no correlation
        break;
    }
  } catch {
    // Correlation is best-effort
  }

  return formatCorrelationContext(context);
}

/**
 * Auto-detect event type and gather appropriate correlation data.
 *
 * This branched exclusively on `market.extreme_move` / `whale.large_transaction`
 * / `congress.new_trade` — all three of which were deleted from EVENT_TRIGGERS
 * in the cyber refactor. `evaluateEvent` returns null for those keys before
 * `processEvent` ever calls this, so every autonomous activation the product
 * actually fires was reaching the agent with an empty correlation block.
 */
export async function gatherCorrelation(
  eventType: string,
  data: Record<string, unknown>,
): Promise<string> {
  let context: CorrelationContext = {};

  try {
    switch (eventType) {
      case 'cve.kev_added': {
        const cveId = (data.cve_id as string) ?? '';
        if (cveId) context = await correlateCve(cveId);
        break;
      }
      case 'breach.disclosed': {
        context = await correlateIncident(data.industry as string | undefined);
        break;
      }
      case 'advisory.published': {
        // A CERT advisory is about a campaign or a class of exposure, not one
        // product — the alert board is the useful context, plus any CVEs it
        // names.
        const cveIds = data.cve_ids;
        const firstCve = Array.isArray(cveIds) ? (cveIds[0] as string | undefined) : undefined;
        if (firstCve) {
          context = await correlateCve(firstCve);
        } else {
          const alerts = await recentAlerts();
          context = alerts ? { relatedAlerts: alerts } : {};
        }
        break;
      }
      case 'patch.released': {
        // A patch matters because of what it fixes — lead with the first CVE
        // it covers, fall back to the alert board.
        const cveIds = data.cve_ids;
        const firstCve = Array.isArray(cveIds) ? (cveIds[0] as string | undefined) : undefined;
        if (firstCve) {
          context = await correlateCve(firstCve);
        } else {
          const alerts = await recentAlerts();
          context = alerts ? { relatedAlerts: alerts } : {};
        }
        break;
      }
      case 'news.breaking': {
        // Scrape the story, and show what's already on the alert board so the
        // agent can say whether this is new or a known thread.
        const articleUrl = (data.url as string) ?? '';
        const [article, alerts] = await Promise.all([
          articleUrl
            ? import('@/lib/data/firecrawl')
                .then((m) => m.firecrawlScrape(articleUrl))
                .catch(() => null)
            : Promise.resolve(null),
          recentAlerts(),
        ]);
        context = {
          ...(article ? { relatedArticle: article as string } : {}),
          ...(alerts ? { relatedAlerts: alerts } : {}),
        };
        break;
      }
      case 'monitor.keyword_match': {
        const alerts = await recentAlerts();
        context = alerts ? { relatedAlerts: alerts } : {};
        break;
      }
      default:
        break;
    }
  } catch {
    // Correlation is best-effort
  }

  return formatCorrelationContext(context);
}
