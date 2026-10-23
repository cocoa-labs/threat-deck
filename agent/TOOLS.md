# TOOLS -- Cocoa AI Threat Deck / Max API Configuration

## Data Source APIs

### Markets (Massive API, formerly Polygon.io)
- **Base**: `https://api.massive.com/v2`
- **Auth**: `MASSIVE_API_KEY` as query param `apiKey=`
- **Rate**: 5 requests/minute (free tier)
- **Endpoints**:
  - `/v2/aggs/ticker/{ticker}/prev` -- Previous day OHLCV
  - `/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}` -- Historical bars
  - `/v2/snapshot/locale/us/markets/stocks/tickers` -- All tickers snapshot
  - `/v3/reference/tickers/{ticker}` -- Ticker details
- **Symbols**: SPY, QQQ, DIA, IWM, VIX, XLK, XLF, XLE, XLV, XLY, XLI, XLP, XLU, XLB, XLRE, XLC, SMH, GLD, SLV, USO, UNG

### News (RSS + NewsAPI)
- **NewsAPI Base**: `https://newsapi.org/v2`
- **Auth**: `NEWS_API_KEY` as header `X-Api-Key`
- **Rate**: 100 requests/day (free tier)
- **Endpoints**:
  - `/v2/top-headlines` -- Breaking news by category/country
  - `/v2/everything` -- Historical search with keywords
- **RSS Feeds**: 40+ across categories (geopolitical, tech, finance, defense, think tanks)
- **Note**: NewsAPI free tier only returns headlines, not full articles

### Crypto (CoinGecko Pro)
- **Base**: `https://pro-api.coingecko.com/api/v3`
- **Auth**: `COINGECKO_API_KEY` as header `x-cg-pro-api-key`
- **Rate**: 500 requests/minute (pro tier)
- **Endpoints**:
  - `/simple/price` -- Current prices with market data
  - `/coins/{id}/market_chart` -- Historical price data
  - `/coins/markets` -- Market data for top coins

### Federal Reserve (FRED)
- **Base**: `https://api.stlouisfed.org/fred`
- **Auth**: `FRED_API_KEY` as query param `api_key=`
- **Rate**: 120 requests/minute
- **Key Series**:
  - `WALCL` -- Fed balance sheet (weekly)
  - `M2SL` -- M2 money supply (monthly)
  - `FEDFUNDS` -- Federal funds rate (monthly)
  - `UNRATE` -- Unemployment rate (monthly)
  - `GDP` -- Gross domestic product (quarterly)
  - `CPIAUCSL` -- Consumer price index (monthly)
  - `DGS10` -- 10-Year Treasury rate (daily)
  - `T10Y2Y` -- 10Y-2Y spread (daily)
  - `PCEPI` -- PCE price index (monthly)

### Congress Trades (Quiver Quantitative)
- **Base**: `https://api.quiverquant.com/beta`
- **Auth**: `QUIVER_API_KEY` as header `Authorization: Bearer`
- **Rate**: ~60 requests/minute
- **Endpoints**:
  - `/historical/congresstrading` -- All Congress trades
  - `/live/congresstrading` -- Recent trades

### Whale Alerts (Whale Alert)
- **Base**: `https://api.whale-alert.io/v1`
- **Auth**: `WHALE_ALERT_API_KEY` as query param `api_key=`
- **Rate**: 10 requests/minute (free tier)
- **Endpoints**:
  - `/transactions` -- Recent large transactions
- **Params**: `min_value=500000` for institutional-relevant transactions

### Government Contracts (USASpending)
- **Base**: `https://api.usaspending.gov/api/v2`
- **Auth**: None required
- **Rate**: ~100 requests/minute
- **Endpoints**:
  - `/search/spending_by_award/` -- Search contract awards
  - `/awards/{id}/` -- Award details

### Prediction Markets (Polymarket)
- **Base**: `https://clob.polymarket.com`
- **Auth**: None required
- **Rate**: ~100 requests/hour
- **Endpoints**:
  - `/markets` -- Active prediction markets
  - `/prices` -- Current market prices/probabilities

### OSINT Feeds (RSS)
- **Think Tanks**: CSIS, Brookings, CFR, RAND, Carnegie, Chatham House
- **Defense**: DefenseOne, Breaking Defense, War on the Rocks
- **Cyber**: CISA alerts, Recorded Future (free)
- **Conflict**: ACLED, SIPRI, IISS
- **Investigative**: Bellingcat
- **Rate**: Self-limited via `rate-limiter.ts` (10 requests/minute aggregate)

## Tool Categories

### DATA_RETRIEVAL
Tools that fetch data from external sources. No side effects.
- `fetch_market_snapshot` -- Prices, changes, volume for symbols
- `search_intelligence` -- Semantic search across all ingested data
- `fetch_news_feed` -- Categorized news from RSS + NewsAPI
- `fetch_congress_trades` -- Congress member stock transactions
- `fetch_whale_transactions` -- Large crypto transactions
- `fetch_prediction_markets` -- Polymarket odds
- `fetch_economic_data` -- FRED economic indicators

### ANALYSIS
Tools that synthesize data into assessments. No side effects.
- `generate_brief` -- Structured intelligence brief (flash/standard/extended)

Note: Situation assessment and correlation analysis are handled via analytical
playbooks in the system prompt, not dedicated tools.

### ACTION (modify state)
Tools that do real work. The human gate is the **outbound drafts queue**
(`aegis_outbound_drafts` -> `/api/outbound/drafts` -> ApprovalQueueSection in
the AgentDrawer), not the `requiresApproval` flag -- that flag has no queue
behind it and now returns a loud configuration error. `post_to_x` is the
reference implementation: the handler stages a draft, the operator reviews and
approves, only then does anything publish.
- `create_monitor` -- Create a keyword watchlist monitor (writes `monitors`;
  scanned every 5 min; managed in MY MONITORS)
- `post_to_x` / `x_reply_to_tweet` -- Stage an X post / reply for approval
- `email_conversation` / `reply_to_email` -- Stage an email for approval
- `generate_image` / `generate_video` -- Produce media

Removed: `create_alert_rule`, `publish_brief`, `escalate_to_human`. All three
returned `{ created/published/escalated: true }` echoing their own input and
performed no I/O, so Max reported success for work that never happened.
Publishing is covered by `email_conversation` / `post_to_x`; escalation is
meaningless in a single-tenant deck where the human is already in the chat.

### MEMORY
Tools for persistent Max memory. Internal use.
- `read_memory` -- Recall past analyses and learned patterns
- `write_memory` -- Persist new learnings and insights

## Rate Limiting Strategy

All external API calls go through `src/lib/data/rate-limiter.ts`:
- Token bucket algorithm with per-source configuration
- Automatic retry with exponential backoff on 429 responses
- Redis-backed counters for distributed rate limiting
- Graceful degradation: return cached data when rate limited
