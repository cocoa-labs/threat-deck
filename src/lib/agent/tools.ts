/**
 * Tool Registration — Cocoa AI Threat Deck / Max
 *
 * Federation naming convention (future):
 * - Monitor tools: monitor.fetch_market_snapshot, monitor.generate_brief
 * - Intelligence tools: intel.analyze_thesis, intel.model_scenario
 * - Canvas tools: canvas.create_visualization, canvas.share_workspace
 *
 * Current: No prefix (standalone mode)
 */

import * as handlers from './tool-handlers';
import { ToolRegistry } from './tool-registry';
import { ToolCategory } from './types';

/**
 * Register all agent tools.
 * Call this once at server startup.
 */
export function registerAllTools(): void {
  ToolRegistry.registerBatch([
    // ═══════════════════════════════════════════════
    // DATA RETRIEVAL TOOLS (18)
    // ═══════════════════════════════════════════════

    {
      name: 'fetch_market_snapshot',
      description:
        'Get current prices, daily changes, and volume for specified symbols. Covers stocks, ETFs, crypto, commodities, forex, and indices. ' +
        'WHEN TO USE: Current price checks, daily performance, quick multi-asset comparison. ' +
        'WHEN NOT TO USE: Historical trends or technical patterns (use fetch_chart_data). Crypto-specific context like market cap rankings (use fetch_crypto_data). ' +
        'PARAMETER DEFAULTS: include_technicals defaults to false. ' +
        'COMMON MISTAKES: Requesting >10 symbols per call (batch into multiple calls). Confusing VIX level (not a price — it is a volatility index). Using this for historical OHLCV data (use fetch_chart_data instead).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ticker symbols (e.g., ["SPY","NVDA","BTC","GLD","EUR/USD"])',
          },
          include_technicals: {
            type: 'boolean',
            description: 'Include RSI, MACD, Bollinger Bands',
          },
        },
        required: ['symbols'],
      },
      handler: handlers.fetchMarketSnapshot,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },
    {
      name: 'search_intelligence',
      description:
        'Semantic search across all ingested intelligence — news, OSINT, congress trades, whale alerts, prediction markets, economic data. Returns ranked results with relevance scores. ' +
        'WHEN TO USE: Cross-source discovery on a topic. Finding connections across domains. Broad research when you need breadth across multiple data types. ' +
        'WHEN NOT TO USE: Current prices (use fetch_market_snapshot). Latest headlines (use fetch_news_feed — fresher and category-filtered). Specific economic data values (use fetch_economic_data). ' +
        'PARAMETER DEFAULTS: sources defaults to all. limit defaults to 20. ' +
        'COMMON MISTAKES: Using this when a dedicated tool exists for the data type. Not using source filters to narrow results (e.g., sources: ["congress","markets"] for insider trading patterns).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Natural language search query' },
          sources: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'news',
                'osint',
                'congress',
                'markets',
                'predictions',
                'contracts',
                'whales',
                'fed',
              ],
            },
            description: 'Filter by source type (default: all)',
          },
          since: { type: 'string', description: 'ISO timestamp cutoff' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        required: ['query'],
      },
      handler: handlers.searchIntelligence,
      tokenBudget: 10000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 2,
    },
    {
      name: 'fetch_news_feed',
      description:
        'Get latest news articles from categorized feeds. Fresher than search_intelligence for breaking news. ' +
        'WHEN TO USE: Latest headlines in a specific domain. Breaking news monitoring. Category-specific news roundups. ' +
        'WHEN NOT TO USE: Cross-domain discovery across multiple data types (use search_intelligence). Current prices (use fetch_market_snapshot). ' +
        'PARAMETER DEFAULTS: limit defaults to 15. ' +
        'COMMON MISTAKES: Using invalid category names — use canonical categories: "politics", "tech", "finance", "government", "defense", "ai", "cyber". Calling without specifying categories (required parameter).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          categories: { type: 'array', items: { type: 'string' } },
          keywords: { type: 'array', items: { type: 'string' } },
          limit: { type: 'number' },
        },
        required: ['categories'],
      },
      handler: handlers.fetchNewsFeed,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'fetch_congress_trades',
      description:
        'Get recent stock transactions disclosed by US Congress members. Includes member name, party, transaction type, estimated amount range, and filing date. ' +
        'WHEN TO USE: Investigating congressional trading activity. Checking if insiders traded a specific stock. Correlating political activity with market moves. ' +
        'WHEN NOT TO USE: Government spending or federal contracts (use fetch_government_contracts — that is SPENDING, this is PERSONAL TRADES). General market data (use fetch_market_snapshot). ' +
        'PARAMETER DEFAULTS: days defaults to 30. ' +
        'COMMON MISTAKES: Confusing this with fetch_government_contracts (trades ≠ contracts). Note amount is a RANGE (e.g., "$1K-$15K"), not an exact figure. Member names are case-sensitive.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          member: { type: 'string', description: 'Filter by member name' },
          symbol: { type: 'string', description: 'Filter by ticker' },
          days: { type: 'number', description: 'Lookback days (default: 30)' },
        },
        required: [],
      },
      handler: handlers.fetchCongressTrades,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'fetch_whale_transactions',
      description:
        'Get large cryptocurrency transactions (>$500K) from Whale Alert. Includes blockchain, amount, from/to addresses, and USD value. ' +
        'WHEN TO USE: Monitoring large crypto fund flows. Detecting exchange inflows/outflows. Identifying accumulation or distribution patterns. ' +
        'WHEN NOT TO USE: Crypto prices or market cap data (use fetch_crypto_data). Stock market data (use fetch_market_snapshot). ' +
        'PARAMETER DEFAULTS: min_value_usd defaults to 500000. blockchain defaults to all. ' +
        'COMMON MISTAKES: Confusing this with fetch_crypto_data (this is FLOW ACTIVITY, not prices). Note that exchange-labeled addresses carry different signal value than unknown wallets — exchange inflows may signal selling pressure.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          min_value_usd: { type: 'number', description: 'Minimum USD value (default: 500000)' },
          blockchain: { type: 'string', enum: ['bitcoin', 'ethereum', 'all'] },
        },
        required: [],
      },
      handler: handlers.fetchWhaleTransactions,
      tokenBudget: 5000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'fetch_prediction_markets',
      description:
        'Get current odds from Polymarket for political, economic, crypto, and geopolitical prediction markets. ' +
        'WHEN TO USE: Crowd-implied probabilities for events. Comparing market expectations to narrative. Sentiment gauge on binary outcomes. ' +
        'WHEN NOT TO USE: Actual market prices (use fetch_market_snapshot). Hard economic data (use fetch_economic_data). ' +
        'PARAMETER DEFAULTS: None — topics is required. ' +
        'COMMON MISTAKES: Treating probabilities as objective truth — these are CROWD SENTIMENT, always caveat accordingly. Probabilities are 0-1 scale (multiply by 100 for percentage display). Low-volume markets are unreliable — note volume when citing.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topics: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['politics', 'economics', 'crypto', 'geopolitics', 'technology'],
            },
          },
        },
        required: ['topics'],
      },
      handler: handlers.fetchPredictionMarkets,
      tokenBudget: 5000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'fetch_government_contracts',
      description:
        'Get recent US government contract awards from USASpending. Includes awarding agency, contractor, amount, and description. ' +
        'WHEN TO USE: Tracking federal spending patterns. Identifying contractors winning large awards. Defense and infrastructure spending analysis. ' +
        'WHEN NOT TO USE: Congressional stock trades (use fetch_congress_trades — that is PERSONAL TRADES, this is GOVERNMENT SPENDING). General market data (use fetch_market_snapshot). ' +
        'PARAMETER DEFAULTS: limit defaults to 10. ' +
        'COMMON MISTAKES: Confusing this with fetch_congress_trades. Results are recent awards only — not a comprehensive historical database.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: [],
      },
      handler: handlers.fetchGovernmentContracts,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 60,
    },
    {
      name: 'fetch_economic_data',
      description:
        'Get Federal Reserve and economic DATA VALUES from FRED. Returns actual numbers: rates, percentages, index levels. Covers 14 indicators: balance_sheet, m2, fed_funds, unemployment, gdp, cpi, pce, treasury_10y, yield_spread, initial_claims, industrial_production, consumer_sentiment, retail_sales, housing_starts. ' +
        'WHEN TO USE: Getting actual economic data values (e.g., "What is CPI?", "What is the unemployment rate?"). Comparing economic indicators over time. Macro analysis with hard numbers. ' +
        'WHEN NOT TO USE: Release DATES and TIMES for upcoming economic reports (use fetch_fed_calendar). Policy news and commentary (use fetch_news_feed with "government" category). ' +
        'PARAMETER DEFAULTS: None — indicators is required. ' +
        'COMMON MISTAKES: Confusing this with fetch_fed_calendar — THIS returns DATA VALUES, fetch_fed_calendar returns RELEASE DATES. CPI and PCE report YoY inflation rates, not raw index levels. Always pair with fetch_fed_calendar for the complete macro picture.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          indicators: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'balance_sheet',
                'm2',
                'fed_funds',
                'unemployment',
                'gdp',
                'cpi',
                'pce',
                'treasury_10y',
                'yield_spread',
                'initial_claims',
                'industrial_production',
                'consumer_sentiment',
                'retail_sales',
                'housing_starts',
              ],
            },
          },
        },
        required: ['indicators'],
      },
      handler: handlers.fetchEconomicData,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 60,
    },

    {
      name: 'fetch_earnings_calendar',
      description:
        'Get earnings calendar: recent results (past 7 days with BEAT/MISS indicators), this week, and next week upcoming reports. Includes EPS estimates/actuals, revenue, surprise percentages. ' +
        'WHEN TO USE: Checking upcoming earnings dates. Reviewing recent earnings surprises. Pre-earnings analysis for specific stocks. ' +
        'WHEN NOT TO USE: Current stock prices (use fetch_market_snapshot). Historical price trends (use fetch_chart_data). ' +
        'PARAMETER DEFAULTS: days defaults to 14. limit defaults to 50. ' +
        'COMMON MISTAKES: BMO = Before Market Open, AMC = After Market Close — include timing context when citing. Major companies (S&P 500) have full EPS/revenue data; minor tickers have basic info only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          days: { type: 'number', description: 'Look-ahead days (default: 14)' },
          limit: { type: 'number', description: 'Max results (default: 50)' },
        },
        required: [],
      },
      handler: handlers.fetchEarningsCalendar,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 60,
    },

    {
      name: 'web_search',
      description:
        'Search the web via Firecrawl and get back result page CONTENT (not just snippets) plus source URLs. ' +
        'WHEN TO USE: A topic dedicated tools do not cover. Finding the right page to then read_url. Niche/current info not in other feeds. ' +
        'WHEN NOT TO USE: Current prices (fetch_market_snapshot). Latest news (fetch_news_feed — fresher). Economic data (fetch_economic_data). A specific URL you already have (use read_url). Always check dedicated tools FIRST. ' +
        'PARAMETER DEFAULTS: limit defaults to 5 (max 8). ' +
        'COMMON MISTAKES: Using this when a dedicated tool exists. Every result carries a real URL in sourceUrl — cite it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default: 5, max: 8)' },
        },
        required: ['query'],
      },
      handler: handlers.webSearch,
      tokenBudget: 12000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },

    {
      name: 'read_url',
      description:
        'Fetch ONE specific URL and return its clean page content as markdown. The tool to reach for whenever the user pastes a link and says "check/read this". ' +
        'GitHub: for github.com repo links it returns LIVE repo data (stars, README, last-push, language, topics) via the GitHub API — works even on repos too fresh to be web-indexed, where web_search would return nothing. ' +
        'WHEN TO USE: A pasted article/docs/repo URL. Reading the source behind a web_search result. ' +
        'WHEN NOT TO USE: Many pages of one site (use crawl_site). Pulling specific fields out of a page (use extract_structured). A topic with no known URL (use web_search first). ' +
        'COMMON MISTAKES: Inventing content when the fetch fails — if it returns {error}, say you could not retrieve it; never fabricate or cite [VERIFIED].',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'The http(s) URL to fetch' },
          include_file_tree: {
            type: 'boolean',
            description: 'For GitHub repos, also return the top-level file list',
          },
        },
        required: ['url'],
      },
      handler: handlers.readUrl,
      tokenBudget: 14000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 3,
    },

    {
      name: 'crawl_site',
      description:
        'Crawl a bounded set of pages from one site or docs section and return each page as markdown. ' +
        'WHEN TO USE: "Read their docs / the whole changelog / this section" — when one page is not enough. ' +
        'WHEN NOT TO USE: A single page (use read_url). Broad discovery across sites (use web_search). ' +
        'PARAMETER DEFAULTS: limit 8 (max 10), maxDepth 2 (max 2). ' +
        'COMMON MISTAKES: On status "timeout"/"partial" the result still carries the pages gathered — report that honestly and use them; NEVER invent pages or claim the site was "empty".',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Root http(s) URL to crawl from' },
          limit: { type: 'number', description: 'Max pages (default: 8, max: 10)' },
          maxDepth: { type: 'number', description: 'Max crawl depth (default: 2, max: 2)' },
        },
        required: ['url'],
      },
      handler: handlers.crawlSite,
      tokenBudget: 14000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 20,
    },

    {
      name: 'extract_structured',
      description:
        'Pull STRUCTURED fields out of one or more pages as JSON. Use a cyber preset, or a freeform prompt/schema. ' +
        'Presets: cve_advisory (CVEs + CVSS + affected products + patches), iocs (indicators), affected_products, patch_info. ' +
        'WHEN TO USE: "Extract the CVEs/IOCs/affected versions from this advisory." Turning a messy page into clean fields. ' +
        'WHEN NOT TO USE: Just reading a page (use read_url). Searching (use web_search). ' +
        'COMMON MISTAKES: Calling without a url/urls, or without a preset/prompt/schema — provide at least one URL plus a preset (or prompt/schema).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'A single http(s) URL to extract from' },
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: 'Multiple URLs to extract from (max 5)',
          },
          preset: {
            type: 'string',
            enum: ['cve_advisory', 'iocs', 'affected_products', 'patch_info'],
            description: 'Cyber extraction preset (supplies prompt + schema)',
          },
          prompt: {
            type: 'string',
            description: 'Freeform extraction instruction (overrides preset)',
          },
          schema: { type: 'object', description: 'JSON Schema for the fields to extract' },
        },
        required: [],
      },
      handler: handlers.extractStructured,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },

    {
      name: 'fetch_twitter_feed',
      description:
        'Get recent tweets from curated finance/geopolitics accounts on X (Twitter). Tier 4 reliability source — fastest signals but lowest verification. ' +
        'WHEN TO USE: Real-time sentiment on breaking events. Checking what key finance/geopolitics accounts are discussing. Early signal detection before mainstream coverage. ' +
        'WHEN NOT TO USE: Verified news (use fetch_news_feed). Hard data (use dedicated data tools). As a sole source for any claim. ' +
        'PARAMETER DEFAULTS: limit defaults to 20. ' +
        'COMMON MISTAKES: Citing Twitter without cross-referencing Tier 1-2 sources. ALWAYS qualify Twitter-sourced claims with lower confidence. This is signal, not evidence.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query to filter tweets' },
          account: { type: 'string', description: 'Specific account handle (e.g., "zaborsky")' },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        required: [],
      },
      handler: handlers.fetchTwitterFeed,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 15,
    },
    {
      name: 'fetch_fed_calendar',
      description:
        'Get upcoming and recent Federal Reserve economic RELEASE DATES and TIMES from FRED. Includes release name, date, time, impact level, and category. ' +
        'WHEN TO USE: Checking when the next CPI/jobs/GDP report comes out. Upcoming Fed meeting dates. Scheduling awareness for market-moving releases. ' +
        'WHEN NOT TO USE: Getting actual economic DATA VALUES like CPI rate or unemployment percentage (use fetch_economic_data with the appropriate indicator). Policy news (use fetch_news_feed). ' +
        'PARAMETER DEFAULTS: days_forward defaults to 30. days_back defaults to 7. ' +
        'COMMON MISTAKES: Confusing this with fetch_economic_data — THIS returns DATES and TIMES, fetch_economic_data returns DATA VALUES. "When is the next CPI release?" → fetch_fed_calendar. "What is CPI?" → fetch_economic_data(cpi).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          days_forward: { type: 'number', description: 'Days to look ahead (default: 30)' },
          days_back: { type: 'number', description: 'Days to look back (default: 7)' },
          category: {
            type: 'string',
            description: 'Filter by category (e.g., Employment, Inflation, Growth)',
          },
        },
        required: [],
      },
      handler: handlers.fetchFedCalendar,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 60,
    },
    {
      name: 'fetch_crypto_data',
      description:
        'Get cryptocurrency prices, market caps, 24h changes, and ranking context from CoinGecko. Covers top coins by market cap. ' +
        'WHEN TO USE: Crypto market overview with market cap context. Comparing crypto assets. Detailed crypto-specific data beyond simple price. ' +
        'WHEN NOT TO USE: Simple price check for 1-2 crypto assets (use fetch_market_snapshot — faster). Whale fund flow analysis (use fetch_whale_transactions). ' +
        'PARAMETER DEFAULTS: limit defaults to 20 (top coins by market cap). ' +
        'COMMON MISTAKES: CoinGecko uses lowercase coin IDs — "bitcoin" not "BTC", "ethereum" not "ETH". Confusing this with fetch_market_snapshot (this gives broader crypto context: market cap, rank, supply) or fetch_whale_transactions (this is PRICES, not flows).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          coins: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific coin IDs (e.g., ["bitcoin","ethereum"])',
          },
          limit: { type: 'number', description: 'Max results (default: 20)' },
        },
        required: [],
      },
      handler: handlers.fetchCryptoData,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'fetch_chart_data',
      description:
        'Get historical OHLCV (Open/High/Low/Close/Volume) time-series data for a single symbol. For charting and technical analysis. ' +
        'WHEN TO USE: Historical price trends. Technical analysis (support/resistance, patterns). Comparing price action over a timeframe. ' +
        'WHEN NOT TO USE: Current prices or daily snapshot (use fetch_market_snapshot — faster, supports multiple symbols). ' +
        'PARAMETER DEFAULTS: timeframe defaults to 1M. interval defaults to 1day. ' +
        'COMMON MISTAKES: Using this for current prices (use fetch_market_snapshot). Not matching interval to timeframe — use 5min for 1D, 1hour for 1W, 1day for 1M/3M/1Y. Only supports one symbol per call.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          symbol: { type: 'string', description: 'Ticker symbol (e.g., "SPY", "AAPL")' },
          timeframe: {
            type: 'string',
            enum: ['1D', '1W', '1M', '3M', '1Y'],
            description: 'Time range (default: 1M)',
          },
          interval: {
            type: 'string',
            enum: ['1min', '5min', '1hour', '1day'],
            description: 'Candle interval (default: 1day)',
          },
        },
        required: ['symbol'],
      },
      handler: handlers.fetchChartData,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },

    {
      name: 'fetch_tv_context',
      description:
        'Get ADDITIONAL metadata about a livestream channel — video title, tags, and recent headlines from that network. ' +
        "WHEN TO USE: When the user asks about specific program details, segments, or topics and the system prompt's ACTIVE LIVESTREAM section doesn't have enough detail. " +
        "WHEN NOT TO USE: When the user simply asks what channel they're watching or what's on — the system prompt already contains this. Do NOT call this tool just to identify the active channel. " +
        'PARAMETER DEFAULTS: channel_id is required. Read it from the ACTIVE LIVESTREAM section in your system prompt. ' +
        'COMMON MISTAKES: Calling this tool to find out what channel the user is watching (already in system prompt). Calling without a channel_id expecting auto-detection (it will fail).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          channel_id: {
            type: 'string',
            description:
              'Channel ID (e.g., "cnbc", "bloomberg"). If omitted, uses the channel from the current TV context.',
          },
        },
        required: [],
      },
      handler: handlers.fetchTvContext,
      tokenBudget: 3000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },

    // ═══════════════════════════════════════════════
    // AEGIS INTELLIGENCE TOOLS (7) — cybersecurity deep-intel layer
    // ═══════════════════════════════════════════════

    {
      name: 'aegis_search_cves',
      description:
        'Search and filter AEGIS CVEs by severity, KEV status, EPSS percentile, vendor, product, exploitation status, and date range. Returns matched CVEs with summary stats and severity breakdown. ' +
        'WHEN TO USE: CVE discovery, "what new criticals dropped this week", filtering by exploitation status. ' +
        'WHEN NOT TO USE: Full CVE detail with affected products and patches (use aegis_cve_detail). Threat actor lookups (use aegis_score_threat_actor).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          search: { type: 'string', description: 'Search CVE summary text (fuzzy match)' },
          severity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
            description: 'Severity filter',
          },
          is_kev: { type: 'boolean', description: 'Filter to KEV-listed CVEs only' },
          exploited_in_wild: { type: 'boolean', description: 'Filter to actively exploited CVEs' },
          min_cvss: { type: 'number', description: 'Minimum CVSS v3 score' },
          min_epss_percentile: {
            type: 'number',
            description: 'Minimum EPSS percentile (0-100) — exploit prediction',
          },
          vendor: { type: 'string', description: 'Vendor name (e.g., "Microsoft", "Apache")' },
          product: { type: 'string', description: 'Product name (e.g., "Confluence", "Exchange")' },
          published_since: { type: 'string', description: 'ISO date — earliest publication' },
          limit: { type: 'number', description: 'Max results (default 25, max 50)' },
        },
        required: [],
      },
      handler: handlers.aegisSearchCves,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },

    {
      name: 'aegis_cve_detail',
      description:
        'Get the full AEGIS CVE package: CVE record, CVSS/EPSS history, affected products, available remediations with patch versions, related IOCs, and KEV metadata. ' +
        'WHEN TO USE: Deep dive on a specific CVE for the fix-architect mode. "Give me the full picture on CVE-2024-XXXXX." ' +
        'WHEN NOT TO USE: Searching across multiple CVEs (use aegis_search_cves).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cve_id: {
            type: 'string',
            description: 'CVE identifier (e.g., "CVE-2024-12345")',
          },
        },
        required: ['cve_id'],
      },
      handler: handlers.aegisCveDetail,
      tokenBudget: 12000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 3,
    },

    {
      name: 'aegis_score_threat_actor',
      description:
        'Get the AEGIS threat actor score with 5-dimension breakdown: capability, reach, recency, velocity, attribution confidence. Includes actor profile, MITRE group mapping, recent campaigns, and TTP coverage. ' +
        'WHEN TO USE: Threat actor analysis, "how dangerous is LockBit right now", attribution research. ' +
        'WHEN NOT TO USE: CVE-level analysis (use aegis_cve_detail). Incident lookup (use aegis_find_incident_comps).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          actor: {
            type: 'string',
            description: 'Actor ID (e.g., "APT29") or alias (e.g., "Cozy Bear")',
          },
        },
        required: ['actor'],
      },
      handler: handlers.aegisScoreThreatActor,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },

    {
      name: 'aegis_find_incident_comps',
      description:
        'Search AEGIS historical incidents by industry, geography, attack vector, blast radius, dwell time. Returns matched incidents with summary statistics — useful for "what does the typical X-industry ransomware look like" comp analysis. ' +
        'WHEN TO USE: Incident comp analysis, sector risk benchmarking, post-incident retrospective context. ' +
        'WHEN NOT TO USE: Active CVE search (use aegis_search_cves). Threat actor profile (use aegis_score_threat_actor).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          industry: {
            type: 'string',
            description: 'Industry filter (e.g., "healthcare", "fintech")',
          },
          country: { type: 'string', description: 'Country filter' },
          incident_type: {
            type: 'string',
            enum: [
              'ransomware',
              'data_breach',
              'credential_stuffing',
              'supply_chain',
              'ddos',
              'wiper',
              'zero_day',
              'phishing',
            ],
            description: 'Incident type filter',
          },
          initial_access_vector: {
            type: 'string',
            description:
              'Initial access vector (e.g., "phishing", "exposed_rdp", "vulnerable_vpn")',
          },
          actor_id: { type: 'string', description: 'Threat actor ID filter' },
          min_records: { type: 'number', description: 'Minimum records compromised' },
          since: { type: 'string', description: 'ISO date — earliest disclosure' },
          limit: { type: 'number', description: 'Max results (default 15, max 30)' },
        },
        required: [],
      },
      handler: handlers.aegisFindIncidentComps,
      tokenBudget: 10000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },

    {
      name: 'aegis_run_risk_simulation',
      description:
        "Run a Monte Carlo risk simulation using AEGIS incident loss distributions and the user's declared exposure profile. Returns loss distributions (P5–P95), probability of breach within X days, and 6 stress scenarios (zero-day spike, supply-chain wave, ransomware surge, insider event, regulatory fine, third-party breach). " +
        'WHEN TO USE: Quantitative risk modeling, board-level loss exposure analysis, scenario planning. ' +
        'WHEN NOT TO USE: Single-CVE lookup (use aegis_cve_detail). Real-time alerts (use aegis_search_cves). ' +
        'NOTE: Takes 200–500ms for 1000 runs. Max 5000 runs.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          industry: { type: 'string', description: 'Industry profile for loss distribution' },
          annual_revenue_usd: {
            type: 'number',
            description: 'Org annual revenue for loss scaling',
          },
          headcount: { type: 'number', description: 'Org headcount' },
          security_maturity_grade: {
            type: 'string',
            enum: ['A', 'B', 'C', 'D'],
            description: 'Security posture grade (A=mature, D=nascent — controls volatility)',
          },
          runs: {
            type: 'number',
            description: 'Number of simulation runs (default 1000, max 5000)',
          },
          horizon_years: {
            type: 'number',
            description: 'Risk horizon in years (default 1, max 5)',
          },
          seed: { type: 'number', description: 'Random seed for reproducibility' },
        },
        required: [],
      },
      handler: handlers.aegisRunRiskSimulation,
      tokenBudget: 15000,
      category: ToolCategory.ANALYSIS,
      requiresApproval: false,
      cooldownSeconds: 30,
    },

    {
      name: 'aegis_match_defenses',
      description:
        'Match AEGIS defensive controls to a CVE, MITRE technique, or framework requirement. Returns ranked defenses with efficacy scores, deployment targets, vendors, cost/complexity tiers, and reference URLs. ' +
        'WHEN TO USE: Fix-architect mode — "what controls mitigate CVE-2024-XXX", "what defends against T1566 phishing". ' +
        'WHEN NOT TO USE: CVE lookup (use aegis_cve_detail). Incident analysis (use aegis_find_incident_comps).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cve_id: { type: 'string', description: 'CVE to find mitigations for' },
          mitre_technique_id: {
            type: 'string',
            description: 'MITRE technique ID (e.g., "T1566.001")',
          },
          framework_control: {
            type: 'string',
            description:
              'Framework control to satisfy (e.g., "NIST CSF: PR.AC-1", "CIS Control 6")',
          },
          defense_type: {
            type: 'string',
            enum: [
              'edr',
              'siem',
              'waf',
              'mfa',
              'network_segmentation',
              'patch_mgmt',
              'awareness_training',
              'backup',
              'iam',
              'dlp',
            ],
            description: 'Filter by defense category',
          },
          cost_tier: {
            type: 'string',
            enum: ['free', 'low', 'mid', 'high'],
            description: 'Maximum acceptable cost tier',
          },
          limit: { type: 'number', description: 'Max results (default 15, max 30)' },
        },
        required: [],
      },
      handler: handlers.aegisMatchDefenses,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },

    {
      name: 'aegis_screen_compromised_orgs',
      description:
        'Screen recently compromised organizations by industry, geography, blast radius, and ransom status. Returns orgs ranked by recent disclosure activity with breach summary. ' +
        'WHEN TO USE: Sector-risk monitoring, vendor exposure check, "who in healthcare got hit this quarter". ' +
        'WHEN NOT TO USE: Threat actor profile (use aegis_score_threat_actor). Active CVE search (use aegis_search_cves).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          industry: { type: 'string', description: 'Industry filter' },
          country: { type: 'string', description: 'Country filter' },
          state_region: { type: 'string', description: 'State or region filter' },
          has_active_ransom: { type: 'boolean', description: 'Filter to orgs with active ransom' },
          min_records_compromised: { type: 'number', description: 'Min total records compromised' },
          since: { type: 'string', description: 'ISO date — earliest last_breach_at' },
          limit: { type: 'number', description: 'Max results (default 20, max 50)' },
        },
        required: [],
      },
      handler: handlers.aegisScreenCompromisedOrgs,
      tokenBudget: 8000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 10,
    },

    {
      name: 'aegis_recent_alerts',
      description:
        'Read the live alert board — the alerts this deck has fired (KEV additions, breach disclosures, vendor patches, breaking stories) with severity, status, and a source link per alert. ' +
        'WHEN TO USE: "what\'s alerting right now", "what did I miss", "anything critical today", "what triggered that red banner", or any question about the deck\'s own alert stream. ' +
        'WHEN NOT TO USE: Searching the whole CVE catalogue (use aegis_search_cves) — this returns only what actually alerted. Full detail on one CVE (use aegis_cve_detail on the returned entityId).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          severity: {
            type: 'array',
            items: { type: 'string' },
            description: 'Severity filter, e.g. ["critical","high"]',
          },
          since_hours: { type: 'number', description: 'Look-back window in hours' },
          include_handled: {
            type: 'boolean',
            description: 'Include acknowledged/resolved alerts (default false — active board only)',
          },
          limit: { type: 'number', description: 'Max results (default 20, max 50)' },
        },
        required: [],
      },
      handler: handlers.aegisRecentAlerts,
      tokenBudget: 6000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },

    // ═══════════════════════════════════════════════
    // PHASE 11.D.13 — FORECAST-AWARE TOOLS (4)
    // ═══════════════════════════════════════════════

    {
      name: 'aegis_exploit_forecast',
      description:
        'Get the per-CVE exploitation forecast: logistic regression P(exploited 30/60/90d) with 95% CI + HMM lifecycle state distribution (Discovered / POC_Available / Weaponized / Mass_Exploitation / Patched_Saturated) + expected days to Mass_Exploitation. ' +
        'WHEN TO USE: User asks "how likely is CVE-X to be exploited", "where is CVE-X in its lifecycle", "how long until it gets weaponized". Pairs with aegis_cve_detail when the user wants both descriptive + predictive context. ' +
        'WHEN NOT TO USE: User wants the full CVE record (use aegis_cve_detail). User wants to rank MANY CVEs by exploit likelihood (use aegis_search_cves first to pick candidates, then this for top ones).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          cve_id: {
            type: 'string',
            description: 'CVE identifier (e.g., "CVE-2024-3094")',
          },
        },
        required: ['cve_id'],
      },
      handler: handlers.aegisExploitForecast,
      tokenBudget: 4000,
      category: ToolCategory.ANALYSIS,
      requiresApproval: false,
      cooldownSeconds: 3,
    },

    {
      name: 'aegis_actor_forecast',
      description:
        'Get the per-actor next-target Bayesian Dirichlet-Categorical posterior over sectors AND countries, with 95% credible intervals. Includes recency weighting (90d) so trajectory shifts are visible. ' +
        'WHEN TO USE: User asks "who will LockBit target next", "what sectors is APT29 likely to hit", "where is FIN7 expanding". ' +
        'WHEN NOT TO USE: User wants the actor profile (use aegis_score_threat_actor). User wants known historical victims (use aegis_screen_compromised_orgs with actor filter).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          actor: {
            type: 'string',
            description: 'Actor ID (e.g., "LockBit") or alias (e.g., "Cozy Bear")',
          },
        },
        required: ['actor'],
      },
      handler: handlers.aegisActorForecast,
      tokenBudget: 4000,
      category: ToolCategory.ANALYSIS,
      requiresApproval: false,
      cooldownSeconds: 3,
    },

    {
      name: 'aegis_timeseries',
      description:
        'Project a daily-count metric (kev_adds, incidents, breaches, advisories, geo_events) N days into the future using a state-space Kalman filter. Returns per-day median + 95% predictive band + a trend label (rising/flat/falling). ' +
        'WHEN TO USE: User asks "is KEV-add rate accelerating", "what does the breach disclosure trend look like", "how many new advisories will land next week". ' +
        'WHEN NOT TO USE: User wants a specific CVE forecast (use aegis_exploit_forecast). User wants the actual historical counts (use aegis_search_cves or aegis_screen_compromised_orgs).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          metric: {
            type: 'string',
            enum: ['kev_adds', 'incidents', 'breaches', 'advisories', 'geo_events'],
            description: 'Which daily metric to forecast',
          },
          horizon_days: {
            type: 'number',
            enum: [7, 30, 90],
            description: 'Forecast horizon — 7, 30, or 90 days',
          },
        },
        required: ['metric'],
      },
      handler: handlers.aegisTimeseries,
      tokenBudget: 4000,
      category: ToolCategory.ANALYSIS,
      requiresApproval: false,
      cooldownSeconds: 3,
    },

    {
      name: 'aegis_counterfactual',
      description:
        'Run a do-calculus counterfactual on the v0.1 causal DAG. Answers "what if we INTERVENED on variable X" — distinct from conditioning, which would respect causal pre-X dependencies. Returns baseline + intervention distributions for the target variable plus the delta. ' +
        'WHEN TO USE: User asks "what if we patched faster", "how much would breach risk drop if VendorPatchLag was fast instead of severe", policy-lever questions. ' +
        'WHEN NOT TO USE: User wants to observe a current correlation (use aegis_actor_forecast or aegis_search_cves). User wants a single-CVE prediction (use aegis_exploit_forecast). ' +
        'VARIABLES: Actor, VictimSector, VictimCountry, TTPSet, VendorPatchLag, CVEChoice, InitialAccess, IncidentOutcome, BreachDisclosure. ' +
        'EXAMPLE: { intervention: {variable: "VendorPatchLag", value: "fast"}, target: "BreachDisclosure", evidence: {Actor: "LockBit"} }',
      inputSchema: {
        type: 'object' as const,
        properties: {
          intervention: {
            type: 'object',
            description: 'The variable to set + the value to set it to',
            properties: {
              variable: { type: 'string', description: 'Variable name to intervene on' },
              value: { type: 'string', description: 'Value to set the intervened variable to' },
            },
            required: ['variable', 'value'],
          },
          target: {
            type: 'string',
            description: 'Variable whose distribution we want to compare baseline vs intervention',
          },
          evidence: {
            type: 'object',
            description: 'Optional observed values to condition on (variable → value)',
          },
        },
        required: ['intervention', 'target'],
      },
      handler: handlers.aegisCounterfactual,
      tokenBudget: 4000,
      category: ToolCategory.ANALYSIS,
      requiresApproval: false,
      cooldownSeconds: 3,
    },

    {
      name: 'email_conversation',
      description:
        'Compose and email content derived from the current conversation to the operator (or a custom recipient list). ' +
        'WHEN TO USE: User explicitly asks to email, send, share, or forward something based on what was discussed — phrases like "email me a summary", "send me the transcript", "make a report and email it to my team". Compose the full content as Markdown in the `content` parameter; the email body is what you write here verbatim. Pick `kind` based on what was asked: summary (condensed BLUF + key findings), transcript (full Markdown rendering of the exchange), report (structured analytical document on a subset), other (anything else). ' +
        'WHEN NOT TO USE: User is just continuing the analytical conversation with no email intent. Saving notes to long-term memory (use write_memory). Posting publicly (the per-response POST TO X button covers that). ' +
        'RECIPIENT RULES: `recipients` is the To list, `cc` is the Cc list, `bcc` is the Bcc list — all merged into ONE email (true CC; everyone on To+Cc sees each other). Default to omitting `recipients` — the handler routes To to the operator inbox automatically, so "email me and CC Mike" = omit recipients + cc:["mike@..."]. Only populate a list with addresses or team aliases the user literally named in their current message ("send to brian@example.org", "cc my team"). Never infer recipients from earlier context. Team aliases use the prefix "team:" (e.g., "team:cocoa") and resolve via EMAIL_TEAM_<NAME> env vars. Recipients must be on the org-domain allowlist (the operator inbox + EMAIL_DOMAIN_ALLOWLIST); a blocked address comes back as an error in the result — relay it, do not claim it was sent. ' +
        'ATTACHMENTS: to file-attach a generated image or video, pass its generatedMediaId(s) (returned by generate_image / generate_video this conversation) in `attachMediaIds`. ' +
        'AFTER THE TOOL RETURNS: Relay the result `summary` field verbatim — it is the ground truth. If `delivered` is false or `sandbox` is true, lead with the failure and the fix; never claim an inbox was reached unless that address shows status "sent". Do NOT restate the full email body.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string',
            description:
              'The email body as Markdown. You compose this from conversation context. Lead with the BLUF observation per Voice Register. Preserve CVE IDs, actor names, MITRE TTPs, severity tags like **[CRITICAL]**, and source links from the discussion. The renderer faithfully maps headers, bold, italic, inline code, links, lists, and fenced code blocks.',
          },
          subject: {
            type: 'string',
            description:
              'Optional subject line (without the "[Cocoa AI]" prefix — that\'s added by the handler). If omitted, derived from kind + date or primaryEntity.',
          },
          recipients: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The "To" list. Optional — defaults to the operator inbox when omitted. Each entry is an email address ("brian@example.org") or a team alias ("team:cocoa" resolves via EMAIL_TEAM_COCOA env). ONLY include addresses or aliases the operator literally named in their current message.',
          },
          cc: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The "Cc" list — visible to all recipients. Use this when the user says "CC <someone>". Same address / "team:" vocabulary as recipients. Include ONLY addresses the operator named this turn.',
          },
          bcc: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The "Bcc" list — hidden from other recipients. Use only when the user explicitly asks to blind-copy someone. Same vocabulary as recipients.',
          },
          kind: {
            type: 'string',
            enum: ['summary', 'transcript', 'report', 'other'],
            description:
              'Categorization for audit + subject prefix. summary = condensed; transcript = verbatim exchange (compose with ### User / ### Max headers); report = structured analytical document on a subset; other = ad-hoc.',
          },
          primaryEntity: {
            type: 'object',
            description:
              'Optional. When the conversation centered on a specific entity (CVE, threat actor, incident), pass it here for subject + dashboard back-link.',
            properties: {
              kind: { type: 'string', enum: ['cve', 'kev', 'threat_actor', 'incident'] },
              id: { type: 'string' },
            },
          },
          severity: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
            description:
              'Optional. Colors the email severity stripe. Pick the highest severity that appears in your composed content. If omitted, extracted from the first **[SEVERITY]** tag in the body.',
          },
          forceResend: {
            type: 'boolean',
            description:
              'Bypass dedup when the user explicitly asks to re-send the same content. Default false.',
          },
          attachMediaIds: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional generatedMediaId(s) from generate_image / generate_video earlier this conversation to file-attach to the email. Only ready media attaches; pending/failed/missing ids are skipped.',
          },
        },
        required: ['content'],
      },
      handler: handlers.emailConversation,
      tokenBudget: 1500,
      category: ToolCategory.ACTION,
      requiresApproval: false,
      cooldownSeconds: 3,
    },
    {
      name: 'post_to_x',
      description:
        'Compose + STAGE an X (Twitter) post for the Cocoa AI the configured X account account. ' +
        'The shared Cyber Wire composer rewrites your content into the house voice (dry, wry, technically precise) and lands it in the approval queue as an editable preview — the operator reviews / edits / approves before anything goes live. ' +
        'WHEN TO USE: the operator asks to tweet / post to X / publish based on the conversation ("post the day as a thread", "tweet this CVE"). ' +
        'SHAPE — match the ask: a day summary or "post the brief" => shape="thread" (optionally tweetCount 2-7, e.g. "make it a 5-tweet thread"); a single CVE/finding => shape="single". A thread is (N-1) prose tweets + a final tweet carrying the source links; an infographic (attachMediaId) rides that final tweet. ' +
        'Pass the raw intel / conversation content in `content` — do NOT pre-format it as a tweet; the composer voices it and leads cyber with a brief nod to the broader board. ' +
        'WHEN NOT TO USE: emailing (use email_conversation); saving notes (use write_memory); analysis with no posting intent. ' +
        'AFTER THE TOOL RETURNS: relay the result `summary` verbatim. It STAGES a draft for review — never claim a tweet is live.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string',
            description:
              "The intel / finding / day's summary to post, as raw conversation content. The composer rewrites it into the house voice — do not pre-write it as a tweet.",
          },
          shape: {
            type: 'string',
            enum: ['thread', 'single'],
            description:
              'thread = a multi-tweet thread (default for a day summary / brief); single = one voiced post (for a single CVE/finding). Pick from the ask.',
          },
          tweetCount: {
            type: 'integer',
            description:
              'For shape="thread": total tweets including the final image+sources tweet (5 => 4 prose + 1 closing), 2-7. Omit to let the composer size it from the stories.',
          },
          mode: {
            type: 'string',
            enum: ['anchor', 'analyst', 'fix_architect'],
            description:
              'Voice/structure: anchor (news brief — default), analyst (deep SITREP thread), fix_architect (remediation playbook). Match your current posture.',
          },
          attachMediaId: {
            type: 'string',
            description:
              'Optional generatedMediaId (image or video from generate_image / generate_video) to attach to the FINAL tweet.',
          },
        },
        required: ['content'],
      },
      handler: handlers.postToX,
      tokenBudget: 1000,
      category: ToolCategory.ACTION,
      // requiresApproval:false is intentional and does NOT bypass Rule #6: the
      // handler only STAGES a draft into the approval queue (it never posts).
      // The human gate is the queue (review/edit/approve → publishTwitter), so
      // no unapproved content reaches the public account.
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'x_check_replies',
      description:
        'Check for replies to our recently posted X (Twitter) threads on the configured X account. ' +
        'WHEN TO USE: the operator asks "any replies to our last post/thread?", "did anyone respond on X?", or wants to see conversation activity on what we posted. ' +
        'Reads the most recent posts from our registry and fetches their replies (excluding our own tweets). ' +
        'FAIL-SOFT: if X reads are unavailable on the current API tier, it returns no replies instead of erroring — say so plainly. ' +
        'AFTER THE TOOL RETURNS: summarize any replies; to respond to one, use x_reply_to_tweet with its tweet id + your reply wording (it stages a draft for approval).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          rootTweetId: {
            type: 'string',
            description:
              'Optional: check replies for one specific posted thread root id. Omit to scan the most recent posts.',
          },
          limit: {
            type: 'integer',
            description: 'How many recent posts to check (1-10, default 5).',
          },
        },
      },
      handler: handlers.checkXReplies,
      tokenBudget: 800,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },
    {
      name: 'x_reply_to_tweet',
      description:
        'STAGE an in-thread reply to a specific X (Twitter) tweet for the the configured X account account. ' +
        'WHEN TO USE: after x_check_replies surfaces a reply and the operator says to respond ("reply to that with…", "answer them"). ' +
        'Pass the target tweet id (from x_check_replies) in `targetTweetId` and the reply wording in `replyText`. ' +
        'Like post_to_x, this STAGES a draft in the approval queue — the operator reviews/edits/approves before it posts in-thread; nothing goes live automatically. ' +
        'AFTER THE TOOL RETURNS: relay the result summary verbatim — never claim the reply is live (it awaits approval).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          targetTweetId: {
            type: 'string',
            description:
              'The id of the tweet to reply to (e.g. a reply surfaced by x_check_replies).',
          },
          replyText: {
            type: 'string',
            description:
              'The reply wording, in the house voice. Staged as-is for operator review (not rewritten).',
          },
          mode: {
            type: 'string',
            enum: ['anchor', 'analyst', 'fix_architect'],
            description: 'Optional voice tag for the draft (default anchor).',
          },
        },
        required: ['targetTweetId', 'replyText'],
      },
      handler: handlers.replyToTweet,
      tokenBudget: 600,
      category: ToolCategory.ACTION,
      // requiresApproval:false — same as post_to_x: the handler only STAGES a
      // draft; the approval queue is the human gate (Rule #6 honored).
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'check_email_replies',
      description:
        'Check for replies to emails WE sent (digests, alerts, agent emails) from the reply-sink Workspace mailbox. ' +
        'WHEN TO USE: the operator asks "any replies to our emails?", "did anyone respond to the digest?", or wants inbox activity on what we sent. ' +
        'Reads the most recent sent emails from our registry and fetches their replies via the Gmail API (excluding our own messages). ' +
        'FAIL-SOFT: if the Gmail service account has not been granted the read scope yet, it returns no replies instead of erroring — say so plainly. ' +
        'AFTER THE TOOL RETURNS: summarize any replies; to respond to one, use reply_to_email with the sent email message id + recipient + your reply wording (it stages a draft for approval).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          messageId: {
            type: 'string',
            description:
              'Optional: check replies for one specific sent email (its registry message id). Omit to scan the most recent sent emails.',
          },
          limit: {
            type: 'integer',
            description: 'How many recent sent emails to check (1-10, default 5).',
          },
        },
      },
      handler: handlers.checkEmailReplies,
      tokenBudget: 800,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },
    {
      name: 'reply_to_email',
      description:
        'STAGE an in-thread email reply for operator review. ' +
        'WHEN TO USE: after check_email_replies surfaces a reply and the operator says to respond ("reply to that with…", "answer them"). ' +
        'Pass `inReplyToMessageId` (the sent email id from check_email_replies, which recovers the thread + recipient), the recipient in `to` or `from`, and the reply wording in `replyText`. ' +
        'Like post_to_x, this STAGES a draft in the approval queue — the operator reviews/edits/approves before it sends in-thread; nothing is emailed automatically. ' +
        'AFTER THE TOOL RETURNS: relay the result summary verbatim — never claim the reply was sent (it awaits approval).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          inReplyToMessageId: {
            type: 'string',
            description:
              'The registry message id of the sent email being replied to (from check_email_replies). Recovers the thread id, subject, and recipient.',
          },
          to: {
            type: 'string',
            description:
              'Optional explicit recipient address. If omitted, resolved from `from` or the original email recipients.',
          },
          from: {
            type: 'string',
            description: "Optional: the replier's address (from check_email_replies) to reply to.",
          },
          subject: {
            type: 'string',
            description:
              'Optional subject. Defaults to "Re: <original subject>" recovered from the registry.',
          },
          replyText: {
            type: 'string',
            description:
              'The reply body in the house voice (Markdown). Staged as-is for operator review (not rewritten).',
          },
          mode: {
            type: 'string',
            enum: ['anchor', 'analyst', 'fix_architect'],
            description: 'Optional voice tag for the draft (default anchor).',
          },
        },
        required: ['replyText'],
      },
      handler: handlers.replyToEmail,
      tokenBudget: 600,
      category: ToolCategory.ACTION,
      // requiresApproval:false — same as reply_to_tweet: the handler only STAGES
      // a draft; the approval queue is the human gate (Rule #6 honored).
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'generate_image',
      description:
        'Generate a Cocoa AI visual infographic from Max response content or an explicitly supplied brief. ' +
        'WHEN TO USE: Only when the user explicitly asks to create/generate/make/render an image, graphic, infographic, visual, poster, or shareable visual summary. Use the current/previous report content as `content` when the user says "make an infographic from that". ' +
        'WHEN NOT TO USE: Do not call proactively, speculatively, or for normal analysis. Do not use for video requests (use generate_video). ' +
        'OUTPUT: Starts an async image job, returns a generated media id and poll URL. The UI attaches the image to your response when ready. ' +
        'AFTER THE TOOL RETURNS: Briefly say the image job is running or attached. Do not claim final visual quality until status is ready.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string',
            description:
              'The report, SITREP, or response text to convert into a 1200x2400 visual infographic. Include BLUF, data points, and source links when available.',
          },
          styleTag: {
            type: 'string',
            enum: [
              'kev_pressure',
              'identity_intrusion',
              'supply_chain_map',
              'research_gap_card',
              'exposure_ledger',
              'market_signal_board',
              'crt_terminal',
            ],
            description:
              'Optional style override. Omit for auto. Use kev_pressure for CVE/KEV/exploitation, identity_intrusion for APT/OAuth/account abuse, supply_chain_map for package ecosystems/botnets, research_gap_card for policy/research/survey stories, exposure_ledger for breaches, market_signal_board for forecasts/market impact, crt_terminal only for ambiguous general briefs.',
          },
          entityKind: {
            type: 'string',
            description: 'Optional entity kind, e.g. cve, kev, threat_actor, incident, forecast.',
          },
          entityId: { type: 'string', description: 'Optional entity id, e.g. CVE-2026-12345.' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          dataTiles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label', 'value'],
            },
          },
          sourceContext: {
            type: 'object',
            description: 'Optional panel/source context from the current interaction.',
          },
        },
        required: ['content'],
      },
      handler: handlers.generateImage,
      tokenBudget: 1500,
      category: ToolCategory.ACTION,
      requiresApproval: false,
      cooldownSeconds: 5,
    },
    {
      name: 'generate_video',
      description:
        'Generate a short Cocoa AI Seedance video clip using the Higgsfield CLI backend. ' +
        'WHEN TO USE: Only when the user explicitly asks to create/generate/make/render a video, clip, Seedance video, motion graphic, or cinematic recap. Use the current/previous report content as `content` when the user says "make a video from that". ' +
        'WHEN NOT TO USE: Do not call proactively, speculatively, or for normal analysis. Do not use for image/infographic requests (use generate_image). ' +
        'DEFAULTS: Seedance 2.0 vertical 9:16, 720p, 8 seconds, mode fast, genre noir. Duration accepts 5-15s. ' +
        'FICTIONAL PRESENTERS: Benign appearance descriptors for fictional adult presenters are allowed creative direction; do not refuse just because the user names hair color, eye color, wardrobe, or broad identity/style traits. ' +
        'AFTER THE TOOL RETURNS: Briefly say the Seedance clip is generating or attached. If disabled/auth fails, surface the setup message exactly.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string',
            description:
              'The report, SITREP, or response text to translate into a cinematic short clip. Include the core story, entities, desired mood, and any benign fictional presenter direction the user requested.',
          },
          durationSeconds: {
            type: 'number',
            description: 'Optional duration in seconds, clamped to 5-15. Default 8.',
          },
          aspectRatio: {
            type: 'string',
            enum: ['9:16', '16:9', '1:1'],
            description: 'Optional aspect ratio. Default 9:16 (vertical).',
          },
          resolution: {
            type: 'string',
            enum: ['480p', '720p', '1080p', '4k'],
            description:
              'Optional resolution. Default 720p — keep it unless the operator explicitly asks for higher. COST: credits scale steeply with resolution, not just length — per second, 720p is 3.5, 1080p is 9, and 4k is 22. A 15s 4k clip costs ~6x a 15s 720p one and can exhaust the daily visual spend cap on its own. 1080p/4k also force mode `std` automatically.',
          },
          mode: {
            type: 'string',
            enum: ['fast', 'std'],
            description:
              'Optional render mode. Default fast (cheaper). Leave unset — it is promoted to `std` automatically when resolution is 1080p/4k, which the API requires.',
          },
          genre: {
            type: 'string',
            enum: ['auto', 'action', 'horror', 'comedy', 'noir', 'drama', 'epic'],
            description: 'Optional Higgsfield genre. Default noir.',
          },
          entityKind: {
            type: 'string',
            description: 'Optional entity kind, e.g. cve, incident, geopolitical.',
          },
          entityId: { type: 'string', description: 'Optional entity id.' },
          sourceContext: {
            type: 'object',
            description: 'Optional panel/source context from the current interaction.',
          },
        },
        required: ['content'],
      },
      handler: handlers.generateVideo,
      tokenBudget: 1200,
      category: ToolCategory.ACTION,
      requiresApproval: false,
      cooldownSeconds: 10,
    },
    {
      name: 'get_generated_media_status',
      description:
        'Check the status of a generated image or video by generatedMediaId. ' +
        'WHEN TO USE: User asks whether a previously started image/video is ready, failed, or still running. ' +
        'WHEN NOT TO USE: Starting a new image/video job.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          generatedMediaId: {
            type: 'string',
            description: 'Generated media id returned by generate_image or generate_video.',
          },
        },
        required: ['generatedMediaId'],
      },
      handler: handlers.getGeneratedMediaStatus,
      tokenBudget: 800,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 2,
    },

    // ═══════════════════════════════════════════════
    // ANALYSIS TOOLS (1)
    // ═══════════════════════════════════════════════

    {
      name: 'generate_brief',
      description:
        'Generate a structured intelligence brief with headline, confidence, situation summary, key developments, market impact, risk assessment, and recommended actions. ' +
        'WHEN TO USE: When the user requests an intelligence brief, SITREP, or situation analysis. After gathering sufficient data from other tools. ' +
        'WHEN NOT TO USE: Simple questions that need 1-3 sentences. Quick price checks or lookups. ' +
        'PARAMETER DEFAULTS: audience defaults to "general". ' +
        'COMMON MISTAKES: Calling this BEFORE gathering data — ALWAYS use data tools FIRST, then call generate_brief LAST. Workflow: gather data → generate_brief → write the brief in your response. Using this for simple questions that do not warrant a full brief.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string' },
          format: { type: 'string', enum: ['flash', 'standard', 'extended'] },
          audience: {
            type: 'string',
            enum: ['trader', 'risk_manager', 'portfolio_manager', 'general'],
          },
        },
        required: ['topic', 'format'],
      },
      handler: handlers.generateBrief,
      tokenBudget: 15000,
      category: ToolCategory.ANALYSIS,
      requiresApproval: false,
      cooldownSeconds: 0,
    },

    // ═══════════════════════════════════════════════
    // WATCHLIST TOOLS
    // ═══════════════════════════════════════════════
    //
    // These replace `create_alert_rule` / `publish_brief` / `escalate_to_human`,
    // which were removed: all three returned `{ created/published/escalated:
    // true }` echoing the agent's own input and performed no I/O whatsoever, so
    // Max reported success for work that never happened. `publish_brief` is
    // covered by the real `email_conversation` / `post_to_x` tools;
    // `escalate_to_human` was meaningless in a single-tenant deck where the
    // human is the person in the conversation.

    {
      name: 'create_monitor',
      description:
        'Create a persistent keyword watchlist monitor. Real: it writes to the monitors table, the scan cron checks it every 5 minutes across the chosen feeds, and the operator manages it in the MY MONITORS panel. ' +
        'WHEN TO USE: the operator wants ongoing standing surveillance of a term — a vendor, a product, a threat actor, a CVE family ("watch for anything about Fortinet", "tell me when Scattered Spider comes up"). ' +
        'WHEN NOT TO USE: a one-time lookup — just answer the question (use aegis_search_cves / fetch_news_feed). Reading what is already being watched (use list_monitors). ' +
        'AFTER THE TOOL RETURNS: relay the `summary` verbatim. If `created` is false, say plainly that nothing was saved and why — never imply a watch exists when it does not.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Short human label, e.g. "Fortinet exposure"' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Terms to match, case-insensitive. At least one required.',
          },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            description: 'How loudly a match should register. Defaults to medium.',
          },
          sources: {
            type: 'array',
            items: { type: 'string', enum: ['cve', 'kev', 'breach', 'news', 'tweet'] },
            description: 'Feeds to scan. Defaults to all five.',
          },
          notifyOnMatch: { type: 'boolean' },
        },
        required: ['name', 'keywords'],
      },
      handler: handlers.createMonitorTool,
      tokenBudget: 2000,
      category: ToolCategory.ACTION,
      // requiresApproval:false is deliberate. A monitor is a private,
      // owner-scoped, fully reversible row — nothing leaves the system and the
      // operator can delete it in one click in MY MONITORS. Setting this true
      // would make the tool INERT, not safe: the `requiresApproval` gate has no
      // queue behind it (see ToolRegistry.execute), which is precisely how the
      // predecessor tool came to lie for so long.
      requiresApproval: false,
      cooldownSeconds: 5,
    },
    {
      name: 'list_monitors',
      description:
        "List the operator's keyword watchlist monitors — name, keywords, severity, feeds, enabled state, last scan time. " +
        'WHEN TO USE: "what am I watching?", before proposing a new monitor (to avoid duplicates), or when the operator asks why something did or did not alert. ' +
        'WHEN NOT TO USE: reading fired alerts (use aegis_recent_alerts) — this lists the watch rules, not their hits.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
      handler: handlers.listMonitorsTool,
      tokenBudget: 2000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 0,
    },
    {
      name: 'get_monitor_matches',
      description:
        "Read what the operator's keyword watchlists have actually CAUGHT — the recorded hits, with the matched keyword, the feed it came from, when it fired, and a link to the item. " +
        'WHEN TO USE: "what has my Fortinet watch caught?", "did anything hit my watchlist this week?", "why did I get an alert about X?", or any follow-up after the MONITORS panel. Omit `monitor` for hits across every watchlist. ' +
        'WHEN NOT TO USE: listing the watch RULES themselves (use list_monitors). Searching the whole CVE/news catalogue (use aegis_search_cves / fetch_news_feed) — this returns only what genuinely matched, which is the point. ' +
        'AFTER THE TOOL RETURNS: relay the `summary` and cite items by their sourceUrl. If `total` is 0, say plainly that nothing matched rather than substituting catalogue results.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          monitor: {
            type: 'string',
            description:
              "Watchlist name or id. Partial names match. Omit for hits across all of the operator's watchlists.",
          },
          limit: { type: 'number', description: 'Max hits to return (default 20, max 50)' },
        },
        required: [],
      },
      handler: handlers.getMonitorMatchesTool,
      tokenBudget: 4000,
      category: ToolCategory.DATA_RETRIEVAL,
      requiresApproval: false,
      cooldownSeconds: 0,
    },

    // ═══════════════════════════════════════════════
    // MAP CONTROL TOOLS (7)
    // ═══════════════════════════════════════════════

    {
      name: 'map_fly_to',
      description:
        'Fly the map camera to a location. ALWAYS pass the place name in the `location` parameter — ' +
        'the resolver handles precise geocoding via a static lookup table + Mapbox API. ' +
        'Only use `lat`/`lon` when the user provides specific numeric coordinates. Never estimate or guess coordinates. ' +
        'CRITICAL: When the user asks about a geographic location (e.g., "What\'s happening in Chicago?", "Any news from Ukraine?"), you MUST call this tool to navigate the map there. The map does NOT update unless you call this tool. ' +
        "WHEN TO USE: When a specific location is mentioned in the user's question or is the focus of your analysis. Geopolitical briefings. Regional news queries. Any question containing a city, country, or region name. " +
        'WHEN NOT TO USE: Abstract questions with no geographic component. ' +
        'PARAMETER DEFAULTS: zoom defaults to 6 (country level). Use 8-10 for cities. ' +
        'COMMON MISTAKES: Not calling this tool when the user asks about a location. Using lat/lon instead of location name — always prefer the location parameter.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          location: {
            type: 'string',
            description:
              'Location name — ALWAYS use this (e.g., "Times Square", "Wicker Park, Chicago")',
          },
          lat: {
            type: 'number',
            description: 'Latitude — only when user provides numeric coordinates',
          },
          lon: {
            type: 'number',
            description: 'Longitude — only when user provides numeric coordinates',
          },
          zoom: { type: 'number', description: 'Zoom level (default: 6)' },
        },
        required: [],
      },
      handler: handlers.mapFlyTo,
      tokenBudget: 500,
      category: ToolCategory.MAP_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 1,
    },
    {
      name: 'map_highlight_markers',
      description:
        'Filter or highlight markers on the map by category (e.g., "conflict", "economic") or by specific marker IDs. ' +
        'WHEN TO USE: CATEGORY-level filtering to focus the map on a domain (e.g., show only conflict markers during geopolitical analysis). Highlighting specific markers relevant to discussion. ' +
        'WHEN NOT TO USE: Placing new markers (use map_place_markers). Flying to a specific location (use map_fly_to). ' +
        'COMMON MISTAKES: Using this to place markers — this only FILTERS existing markers.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category: {
            type: 'string',
            enum: [
              'conflict',
              'economic',
              'technology',
              'policy',
              'proliferation',
              'instability',
              'strategic',
              'market',
              'alternative',
            ],
            description: 'Show only markers of this category',
          },
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific marker IDs to highlight',
          },
        },
        required: [],
      },
      handler: handlers.mapHighlightMarkers,
      tokenBudget: 500,
      category: ToolCategory.MAP_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 1,
    },
    {
      name: 'map_toggle_layer',
      description:
        'Toggle map layer visibility. Layers: markers, threatRings, heatmap, arcs, dayNight, conflictZones, militaryBases, infrastructure. ' +
        'WHEN TO USE: When enabling/disabling a layer has analytical purpose — e.g., showing conflict zones during geopolitical analysis, enabling military bases layer when discussing defense posture. ' +
        'WHEN NOT TO USE: Toggling layers without analytical justification. ' +
        'COMMON MISTAKES: Toggling layers as decoration rather than analytical enhancement.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          layer: {
            type: 'string',
            enum: [
              'markers',
              'threatRings',
              'heatmap',
              'arcs',
              'dayNight',
              'conflictZones',
              'militaryBases',
              'infrastructure',
            ],
          },
          visible: { type: 'boolean', description: 'Set explicit visibility (omit to toggle)' },
        },
        required: ['layer'],
      },
      handler: handlers.mapToggleLayer,
      tokenBudget: 200,
      category: ToolCategory.MAP_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 0,
    },
    {
      name: 'map_draw_attention',
      description:
        'Draw a temporary pulsing attention marker at a location with a label. Creates an urgent visual signal on the map. ' +
        'WHEN TO USE: URGENT or EMERGING situations only — breaking events, threshold breaches, developing crises. Directing immediate user attention to a specific location. ' +
        'WHEN NOT TO USE: Routine analysis (use map_place_markers instead). Non-urgent location references. ' +
        'PARAMETER DEFAULTS: duration defaults to 5 seconds. ' +
        'COMMON MISTAKES: Overusing this for non-urgent situations — this creates a temporary pulsing red marker meant for breaking/urgent events only.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          location: { type: 'string', description: 'Location name' },
          lat: { type: 'number' },
          lon: { type: 'number' },
          label: { type: 'string', description: 'Label text for the attention area' },
          duration: { type: 'number', description: 'Duration in seconds (default: 5)' },
        },
        required: [],
      },
      handler: handlers.mapDrawAttention,
      tokenBudget: 500,
      category: ToolCategory.MAP_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 2,
    },
    {
      name: 'map_place_markers',
      description:
        'Place one or more persistent intelligence markers on the map from your analysis. Markers glow and fade over time (TTL-based). ' +
        'WHEN TO USE: When you identify 2+ specific locations with intelligence significance — entities, events, supply chain nodes, threat vectors, financial centers. Visualizing spatial relationships in your analysis. ' +
        'WHEN NOT TO USE: Single urgent event (use map_draw_attention). Filtering existing markers (use map_highlight_markers). ' +
        'PARAMETER DEFAULTS: ttl defaults to 60 seconds. severity defaults to "medium". category defaults to "strategic". ' +
        'COMMON MISTAKES: Not including a description explaining WHY each location matters in context. Using default TTL for critical findings (use 120s for important markers).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          markers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'Location name (will be geocoded)' },
                lat: { type: 'number', description: 'Latitude (optional if location provided)' },
                lon: { type: 'number', description: 'Longitude (optional if location provided)' },
                label: { type: 'string', description: 'Short label for the marker' },
                description: { type: 'string', description: '1-2 sentence intelligence summary' },
                severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
                category: {
                  type: 'string',
                  enum: [
                    'conflict',
                    'economic',
                    'technology',
                    'policy',
                    'proliferation',
                    'instability',
                    'strategic',
                    'market',
                    'alternative',
                  ],
                },
              },
              required: ['label'],
            },
            description: 'Array of intelligence markers to place on the map',
          },
          ttl: {
            type: 'number',
            description: 'Time to live in seconds (default 60, use 120 for important findings)',
          },
        },
        required: ['markers'],
      },
      handler: handlers.mapPlaceMarkers,
      tokenBudget: 1000,
      category: ToolCategory.MAP_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 2,
    },

    {
      name: 'map_query_viewport',
      description:
        "Read the current map viewport — returns visible POIs, buildings, landmarks, and Max intel markers in the user's current view. The data is a snapshot captured at the time of the user's query. " +
        "WHEN TO USE: The user asks 'what am I looking at?', 'what's in this area?', 'analyze this location', or any spatial awareness question. Also use when you need to understand the geographic context of the user's current focus. " +
        'WHEN NOT TO USE: The user is asking about a different location (fly there first with map_fly_to, then query). Abstract non-geographic questions. ' +
        "COMMON MISTAKES: Calling this without first checking if the user is zoomed to a relevant area. Ignoring the zoomTier — at 'global' or 'country' level, POI features won't be available.",
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
      handler: handlers.mapQueryViewport,
      tokenBudget: 2000,
      category: ToolCategory.MAP_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 2,
    },
    {
      name: 'map_search_features',
      description:
        'Search for places, landmarks, buildings, or points of interest by name or type near the current viewport or a specific location. Uses Mapbox geocoding to find features that may not be visible in the current view. Results auto-navigate the map to show found locations. ' +
        "WHEN TO USE: Finding specific types of places ('find embassies near here', 'where are government buildings in this area', 'locate financial institutions within 5km'). Discovering features beyond the current viewport. " +
        "WHEN NOT TO USE: Reading what's already visible (use map_query_viewport). Flying to a known location (use map_fly_to). " +
        'COMMON MISTAKES: Searching for a specific address when map_fly_to would be simpler.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description:
              "Search query (e.g., 'embassies', 'financial district', 'port facilities')",
          },
          types: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'poi',
                'address',
                'place',
                'neighborhood',
                'locality',
                'district',
                'region',
                'country',
              ],
            },
            description: 'Filter by feature type (default: all)',
          },
          near: {
            type: 'object',
            properties: {
              lat: { type: 'number' },
              lon: { type: 'number' },
            },
            description: 'Search near these coordinates (defaults to current viewport center)',
          },
          limit: {
            type: 'number',
            description: 'Max results (1-10, default 5)',
          },
        },
        required: ['query'],
      },
      handler: handlers.mapSearchFeatures,
      tokenBudget: 1500,
      category: ToolCategory.MAP_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 2,
    },

    // ═══════════════════════════════════════════════
    // TV CONTROL TOOLS (5)
    // ═══════════════════════════════════════════════

    {
      name: 'tv_switch_channel',
      description:
        'Switch the livestream panel to a different channel. ' +
        'CRITICAL: You MUST call this tool to switch channels. Writing "Switching to X" in your text response does NOT change the channel on the user\'s screen. Only calling this tool triggers the actual switch. ' +
        'WHEN TO USE: When the user EXPLICITLY asks to switch, change, or tune to a specific channel (e.g., "switch to Bloomberg", "put on CNBC", "tune to Al Jazeera"). ' +
        'WHEN NOT TO USE: NEVER switch channels proactively or as part of analysis. Only when the user explicitly requests a channel change. ' +
        'ALIASES: bloomberg/bb, cnbc, yahoo, fox/fox business/fox biz, aj/al jazeera/aljazeera, sky/sky news, france 24/france24, dw/dw news/deutsche welle, ndtv, nhk/nhk world, nasa/nasa tv, cbs/cbs news, reuters, euronews, wion, cna, cheddar, coindesk. ' +
        'COMMON MISTAKES: Switching channels without being asked. Using this when the user just mentions a channel name in conversation.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          channel: {
            type: 'string',
            description: 'Channel name or alias (e.g., "bloomberg", "bb", "al jazeera", "cnbc")',
          },
          panel: {
            type: 'string',
            enum: ['primary', 'secondary', 'auto'],
            description:
              'Which livestream panel to switch. "auto" detects the fullscreen panel or defaults to primary. Use "secondary" only when user says "livestream 2".',
          },
        },
        required: ['channel'],
      },
      handler: handlers.tvSwitchChannel,
      tokenBudget: 1000,
      category: ToolCategory.TV_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 1,
    },
    {
      name: 'tv_list_channels',
      description:
        'List available livestream channels with live status. ' +
        'WHEN TO USE: When the user asks what channels are available, wants recommendations, or asks "what should I watch?". ' +
        'WHEN NOT TO USE: When the user asks what channel they are currently watching (already in system prompt). ' +
        "RECOMMENDATION STRATEGY: Consider the user's context (market analysis → finance channels, geopolitics discussion → geopolitical channels). Prefer channels that are currently live. HLS channels are always live. " +
        'COMMON MISTAKES: Calling this just to identify the active channel (already in system prompt under ACTIVE LIVESTREAM).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          category: {
            type: 'string',
            enum: ['finance', 'crypto', 'geopolitical'],
            description: 'Filter by channel category',
          },
        },
        required: [],
      },
      handler: handlers.tvListChannels,
      tokenBudget: 2000,
      category: ToolCategory.TV_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 5,
    },

    // ═══════════════════════════════════════════════
    // YOUTUBE TOOLS (3)
    // ═══════════════════════════════════════════════

    {
      name: 'youtube_search',
      description:
        'Search YouTube for videos by topic. Smart NLP filtering parses duration, recency, and sort preferences from natural language queries. ' +
        'WHEN TO USE: User asks to find, search, or watch a video on a topic. ' +
        'WHEN NOT TO USE: User wants to switch to a preconfigured livestream channel (use tv_switch_channel). ' +
        'COMMON MISTAKES: Using this for live channel switching.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query (e.g., "latest SpaceX launch", "short python tutorial")',
          },
          filters: {
            type: 'object',
            properties: {
              publishedAfter: { type: 'string', description: 'ISO date for recency filter' },
              videoDuration: {
                type: 'string',
                enum: ['short', 'medium', 'long'],
                description: 'Duration filter',
              },
              channelId: { type: 'string', description: 'Restrict to a YouTube channel' },
              order: {
                type: 'string',
                enum: ['relevance', 'date', 'viewCount'],
                description: 'Sort order',
              },
              maxResults: { type: 'number', description: 'Max results (default: 5)' },
            },
            description: 'Optional search filters',
          },
        },
        required: ['query'],
      },
      handler: handlers.youtubeSearch,
      tokenBudget: 5000,
      category: ToolCategory.TV_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 3,
    },
    {
      name: 'youtube_play',
      description:
        'Play a specific YouTube video by ID. ' +
        'WHEN TO USE: User says "play #3" or provides a YouTube URL/ID. ' +
        'WHEN NOT TO USE: Searching for videos (use youtube_search first).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          videoId: {
            type: 'string',
            description: 'YouTube video ID (e.g., "dQw4w9WgXcQ")',
          },
          title: {
            type: 'string',
            description: 'Video title for display confirmation',
          },
        },
        required: ['videoId'],
      },
      handler: handlers.youtubePlay,
      tokenBudget: 500,
      category: ToolCategory.TV_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 1,
    },
    {
      name: 'youtube_queue',
      description:
        'Queue multiple YouTube videos for sequential playback. ' +
        'WHEN TO USE: User asks for multiple videos on a topic ("find me 3 videos about..."). ' +
        'WHEN NOT TO USE: Single video playback (use youtube_search with auto-play).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          videos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                videoId: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['videoId'],
            },
            description: 'Array of videos to queue',
          },
        },
        required: ['videos'],
      },
      handler: handlers.youtubeQueue,
      tokenBudget: 1000,
      category: ToolCategory.TV_CONTROL,
      requiresApproval: false,
      cooldownSeconds: 3,
    },

    // ═══════════════════════════════════════════════
    // MEMORY TOOLS (2)
    // ═══════════════════════════════════════════════

    {
      name: 'read_memory',
      description:
        'Read from persistent Max memory. Contains past analyses, learned patterns, and historical context.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string' },
          recency: { type: 'string', enum: ['recent', 'all'] },
        },
        required: ['topic'],
      },
      handler: handlers.readMemory,
      tokenBudget: 5000,
      category: ToolCategory.MEMORY,
      requiresApproval: false,
      cooldownSeconds: 0,
    },
    {
      name: 'write_memory',
      description:
        'Persist a learning or insight for future reference. Use after completing significant analysis.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          topic: { type: 'string' },
          content: { type: 'string' },
          importance: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['topic', 'content'],
      },
      handler: handlers.writeMemory,
      tokenBudget: 1000,
      category: ToolCategory.MEMORY,
      requiresApproval: false,
      cooldownSeconds: 0,
    },
  ]);
}
