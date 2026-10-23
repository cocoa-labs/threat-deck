// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Core Type Definitions
// ═══════════════════════════════════════════════

// ─── Intelligence ───

export type IntelligenceSource =
  | 'news'
  | 'osint'
  | 'congress'
  | 'markets'
  | 'predictions'
  | 'contracts'
  | 'whales'
  | 'fed'
  | 'crypto'
  | 'monitor';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type IntelligenceCategory =
  | 'conflict'
  | 'economic'
  | 'technology'
  | 'policy'
  | 'proliferation'
  | 'instability'
  | 'strategic'
  | 'market'
  | 'alternative'
  // ─── Cyber / AI categories (CyberGlobeMarker domain) ───
  | 'cve_critical'
  | 'cve_high'
  | 'cve_medium'
  | 'ai_incident'
  | 'data_breach'
  | 'ransomware'
  | 'apt_activity'
  | 'zero_day'
  | 'ai_safety'
  | 'model_release';

export interface GeoLocation {
  lat: number;
  lon: number;
  name?: string;
}

export interface IntelligenceItem {
  id: string;
  source: IntelligenceSource;
  sourceId?: string;
  category?: IntelligenceCategory;
  severity: Severity;
  title: string;
  summary?: string;
  url?: string;
  publishedAt?: string;
  geo?: GeoLocation;
  entities: string[];
  tags: string[];
  rawData?: unknown;
  createdAt: string;
}

// ─── Zoom Tiers ───

export type ZoomTier = 'global' | 'country' | 'city' | 'street';

export interface EnrichedGeoLocation {
  lat: number;
  lon: number;
  name: string;
  country?: string;
  region?: string;
  city?: string;
  confidence: number; // 0-1 geocoding confidence
  source: 'static' | 'mapbox' | 'mapbox-reverse' | 'manual';
}

export interface ViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// ─── Hotspots ───

export interface Hotspot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  severity: Severity;
  category: IntelligenceCategory;
  description: string;
  url?: string;
}

// ─── Markets ───

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume?: number;
  previousClose?: number;
  timestamp: string;
}

export interface SectorData {
  symbol: string;
  name: string;
  changePct: number;
}

// ─── Agent ───

export type AgentStatus = 'idle' | 'thinking' | 'acting' | 'error';

export type BriefFormat = 'flash' | 'standard' | 'deep_dive' | 'extended';

export type TriggerType = 'event' | 'schedule' | 'user';

/**
 * A piece of media (image/video) generated earlier in the current conversation,
 * surfaced to the agent so it is AWARE the media exists and can reference it by id.
 * Sourced from the client store, which is the only place that ties media to "this
 * session" — it captures BOTH agent-tool-created and IMG/VID-operator-button-created
 * media. (How the agent acts on a referenced item lives in the tool layer.)
 */
export interface SessionMediaItem {
  generatedMediaId: string;
  kind: 'image' | 'video';
  styleTag?: string;
  /** 'pending' | 'ready' | 'failed' — clamped at the route boundary. */
  status?: string;
  /** Epoch ms; drives newest-first ordering + relative-time rendering in the prompt. */
  createdAt?: number;
}

export interface AgentContext {
  marketStatus: string;
  activeAlerts: AlertHistoryItem[];
  pendingApprovals: ApprovalRequest[];
  recentBriefs: BriefSummary[];
  user: {
    id: string;
    focusAreas: string[];
    preferences: Record<string, unknown>;
  };
  tvContext?: {
    channelId: string;
    channelLabel: string;
    category: string;
    description: string | null;
    videoMeta: { title: string; description: string; tags: string[] } | null;
    recentHeadlines: Array<{ title: string; source: string; publishedAt: string }>;
    isLive: boolean;
    // Enriched context from Phase 1A collectors
    channelHeadlines?: Array<{
      title: string;
      source: string;
      publishedAt: string;
      url: string;
    }>;
    livePage?: {
      headlines: Array<{ title: string; url?: string }>;
      liveUpdates: string[];
      scrapedAt: string;
    } | null;
    videoMetaChange?: {
      titleChanged: boolean;
      previousTitle: string | null;
      significantChange: boolean;
    } | null;
    ccSummary?: {
      text: string;
      windowStart: string;
      windowEnd: string;
      captionCount: number;
    } | null;
    previousChannelSummary?: string | null;
    rawCaptionTail?: string | null;
  };
  /** Media generated earlier this conversation (newest-first), so the agent can attach it. */
  sessionMedia?: SessionMediaItem[];
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  timestamp: number;
}

export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  model: string;
}

export interface Conversation {
  id: string;
  query: string;
  toolCalls: ToolCall[];
  response: string | null;
  status: 'active' | 'completed' | 'error';
  startedAt: number;
  completedAt: number | null;
}

export interface BriefSummary {
  id: string;
  headline: string;
  confidence?: string;
  format: BriefFormat;
  timestamp: string;
  content?: string;
  conversationId?: string;
}

export interface ApprovalRequest {
  id: string;
  agentEventId: string;
  actionType: string;
  actionInput: unknown;
  agentReasoning?: string;
  urgency: Severity;
  createdAt: string;
  expiresAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

/** Where an alert points — mirrors `aegis_pipeline_alerts.entity_kind`. */
export type AlertEntityKind =
  | 'cve'
  | 'incident'
  | 'advisory'
  | 'ioc'
  | 'news'
  | 'monitor'
  | 'threat_actor'
  | 'breach';

/** Lifecycle — mirrors `aegis_pipeline_alerts.status`. */
export type AlertStatus = 'new' | 'triaging' | 'escalated' | 'resolved' | 'dismissed';

/**
 * How loud the hero breaking-alert overlay is allowed to be. Operator-set in
 * SettingsDialog; `critical` is the default because the red box means "stop
 * what you're doing".
 */
export type BreakingAlertThreshold = 'off' | 'critical' | 'critical_high';

/**
 * One alert as the client sees it. Backed by `aegis_pipeline_alerts` (served by
 * `/api/data/alerts`), not the retired `alert_history` table.
 *
 * `acknowledged` is derived from `status !== 'new'` so existing consumers
 * (AlertsPanel, session-delta, the ticker) keep working unchanged.
 */
export interface AlertHistoryItem {
  id: string;
  ruleId?: string;
  severity: Severity;
  title?: string;
  summary?: string;
  triggerData: unknown;
  acknowledged: boolean;
  createdAt: string;
  /** `new_kev` / `new_breach` / `new_patch` / `advisory` — renders as the kicker. */
  alertType?: string;
  entityKind?: AlertEntityKind;
  entityId?: string;
  /** AEGIS viewer path for the underlying record (rule #21). Relative. */
  sourceUrl?: string;
  status?: AlertStatus;
  aiRelevance?: number | null;
  /** Present only when the alert resolved to coordinates — gates the hero overlay. */
  location?: { lat: number; lon: number; name?: string } | null;
}

// ─── View Mode ───

export type ViewMode = 'map' | 'globe' | 'command';

// ─── Command View ───

export interface CommandPopupData {
  markerId: string;
  label: string;
  severity: Severity;
  category: IntelligenceCategory;
  description: string;
  lat: number;
  lon: number;
  source: IntelligenceSource;
}

// ─── Map ───

export type MapLayer = GlobeLayer | 'clusters' | 'newsFeed';

/**
 * Payload for the hero breaking-alert overlay. Carries enough to say WHAT the
 * alert is and link to its evidence — the previous shape held only an id and
 * coordinates, so the banner could render nothing but a place name.
 *
 * `location` is required to fire: the overlay is geo-gated by design. Alerts
 * that don't resolve to coordinates surface on the toast + ALERTS panel instead.
 */
export interface BreakingAlertPayload {
  alertId: string;
  location: { lat: number; lon: number; name?: string };
  headline: string;
  severity: Severity;
  /** `new_kev` / `new_breach` / … — rendered as the banner kicker. */
  alertType?: string;
  /** AEGIS viewer path for the underlying record (rule #21). */
  sourceUrl?: string;
  /** ISO timestamp of the originating alert, for the relative-age readout. */
  timestamp?: string;
}

export interface BreakingAlertState
  extends Partial<Omit<BreakingAlertPayload, 'alertId' | 'location'>> {
  active: boolean;
  alertId: string | null;
  location: { lat: number; lon: number; name?: string } | null;
}

export interface MapPopupData {
  markerId: string;
  headline: string;
  source: string;
  timestamp: string;
  thumbnailUrl?: string;
  category: IntelligenceCategory;
  severity: Severity;
  url?: string;
  lat: number;
  lon: number;
}

// ─── Globe ───

export type GlobeLayer =
  | 'markers'
  | 'threatRings'
  | 'heatmap'
  | 'arcs'
  | 'conflictZones'
  | 'militaryBases'
  | 'infrastructure'
  | 'agentActivity'
  | 'dayNight'
  | 'atlasMarkets'
  // ─── Cyber layers (toggleable in sidebar) ───
  | 'cyberCVEs'
  | 'cyberBreaches'
  | 'cyberThreatActors'
  | 'cyberAIIncidents'
  | 'cyberCriticalInfra'
  | 'cyberIOCs'
  | 'cyberAISafety';

export interface GlobeMarker {
  id: string;
  lat: number;
  lon: number;
  severity: Severity;
  category: IntelligenceCategory;
  label: string;
  count: number;
  source: IntelligenceSource;
  description?: string;
  timestamp?: string;
  url?: string;
  zoomTier?: ZoomTier;
  enrichedGeo?: EnrichedGeoLocation;
  rawData?: {
    // Congress
    member?: string;
    party?: string;
    chamber?: string;
    tradeSymbol?: string;
    tradeAmount?: string;
    transactionType?: string;
    // Contracts
    contractor?: string;
    agency?: string;
    contractAmount?: number;
    // Whales
    blockchain?: string;
    txSymbol?: string;
    amountUsd?: number;
    fromAddress?: string;
    toAddress?: string;
    txHash?: string;
    // News
    publishedAt?: string;
    newsSource?: string;
    imageUrl?: string;
  };
}

export interface AgentIntelMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  description: string;
  severity: Severity;
  category: IntelligenceCategory;
  source: 'agent';
  confidence: number;
  ttl: number;
  createdAt: number;
  agentResponseId?: string;
  glowColor: string;
}

// ─── Cyber Globe Markers ───
//
// CyberGlobeMarker extends GlobeMarker with cyber/AI-specific identifiers and
// metadata. The three-stream cyber-geo pipeline (AEGIS DB, live RSS, static
// seed) emits these markers; `cyberCategory` is the discriminator between
// geopolitical markers (which use the bare GlobeMarker shape) and cyber ones.
//
// `streamSource` lets layer toggles filter by the three pipeline streams
// without conflating with the existing `source: IntelligenceSource` field.

export type CyberCategory =
  | 'cve'
  | 'breach'
  | 'threat_actor'
  | 'ai_incident'
  | 'ioc'
  | 'critical_infra'
  | 'ai_safety';

export type CyberStreamSource = 'aegis_db' | 'rss' | 'seed' | 'agent' | 'store';
export type CyberLocationPrecision = 'global' | 'country' | 'city' | 'facility';

export type KevStatus = 'kev_listed' | 'kev_due' | 'kev_overdue' | 'not_kev';

export interface CyberGlobeMarker extends GlobeMarker {
  cyberCategory: CyberCategory;
  streamSource: CyberStreamSource;
  locationPrecision?: CyberLocationPrecision;
  locationConfidence?: number;
  // ─── Per-category identifiers (one or more populated based on cyberCategory) ───
  cveId?: string;
  threatActorId?: string;
  breachId?: string;
  incidentId?: string;
  iocValue?: string;
  iocType?: IocType;
  // ─── Scoring + classification ───
  cvssScore?: number; // 0.0 – 10.0
  epssScore?: number; // 0.0 – 1.0
  epssPercentile?: number; // 0 – 100
  kevStatus?: KevStatus;
  // ─── Threat actor attribution ───
  actorAliases?: string[];
  techniques?: string[]; // MITRE ATT&CK T-codes (e.g. ['T1566.001', 'T1078'])
  // ─── Affected entities ───
  affectedVendors?: string[];
  affectedProducts?: string[];
  victimOrg?: string;
  victimIndustry?: string;
  recordsCompromised?: number;
  // ─── Reference links (rendered in hover card) ───
  referenceUrl?: string; // primary citation
  mitreUrl?: string;
  nvdUrl?: string;
  // ─── Timing ───
  lastActiveAt?: string;
  disclosedAt?: string;
  ttl?: number; // for ephemeral RSS / agent markers; absent = persistent
}

export interface GlobeArc {
  id: string;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  color: string;
  label?: string;
}

// ─── Panels ───

export type SlotId =
  | 'left-1'
  | 'right-1'
  | 'right-2'
  | 'bottom-1'
  | 'bottom-2'
  | 'grid-1'
  | 'grid-2'
  | 'grid-3'
  | 'grid-4'
  | 'grid-5'
  | 'grid-6'
  | 'grid-7'
  | 'grid-8'
  | 'grid-9'
  | 'grid-10'
  | 'grid-11'
  | 'grid-12';

export type PanelId =
  | 'markets'
  | 'news'
  | 'heatmap'
  | 'crypto'
  | 'polymarket'
  | 'congress'
  | 'whales'
  | 'fed'
  | 'contracts'
  | 'agentBrief'
  | 'agentActivity'
  | 'alerts'
  | 'monitors'
  | 'chart'
  | 'livestream'
  | 'livestream2'
  | 'newsFeed'
  | 'earnings'
  | 'twitter'
  | 'youtubeSearch'
  // AEGIS deep-intel panels (Phase 4)
  | 'cvePipeline'
  | 'threatActorScores'
  | 'incidentAssessment'
  | 'riskSimulation'
  // Cyber feed panels (Phase 4)
  | 'kevAlerts'
  | 'iocFeed'
  | 'patchTracker'
  // Forecast (Phase 11.D)
  | 'predictions'
  | 'breachDisclosure'
  | 'xReplies'
  | 'emailReplies';

export interface PanelConfig {
  id: PanelId;
  title: string;
  defaultVisible: boolean;
  span: 1 | 2 | 3 | 4;
  priority: 1 | 2 | 3;
}

// ─── News ───

export interface NewsItem {
  id: string;
  title: string;
  summary?: string;
  url: string;
  source: string;
  category: string;
  publishedAt: string;
  imageUrl?: string;
  /**
   * AI-cyber relevance score in [0, 1]. Populated by the Phase 9.2 scoring
   * pipeline for items in the `cyber` and `ai` categories. Absent for other
   * categories and for items the scorer hasn't reached yet.
   */
  aiRelevance?: number;
  /**
   * AI-cyber subcategory classification when `aiRelevance` is present.
   * One of: 'vendor_incident' | 'defensive' | 'offensive' | 'agentic_safety' | 'unrelated'.
   * Kept as a string here (not the AiCategory union) to avoid pulling the
   * outbound constants module into every NewsItem consumer.
   */
  aiCategory?: string;
}

// ─── Crypto ───

export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  sparkline?: number[];
  url?: string;
}

// ─── Congress ───

export interface CongressTrade {
  id: string;
  member: string;
  party: 'D' | 'R' | 'I';
  chamber: 'House' | 'Senate';
  symbol: string;
  transactionType: 'Purchase' | 'Sale' | 'Sale (Full)' | 'Sale (Partial)';
  amount: string;
  filedDate: string;
  url?: string;
}

// ─── Whale ───

export interface WhaleTransaction {
  id: string;
  blockchain: string;
  symbol: string;
  amount: number;
  amountUsd: number;
  from: string;
  to: string;
  timestamp: string;
  hash?: string;
  url?: string;
}

// ─── Prediction Markets ───

export interface PredictionMarket {
  id: string;
  question: string;
  category: string;
  probability: number;
  volume: number;
  endDate?: string;
  url?: string;
}

// ─── Government Contracts ───

export interface GovernmentContract {
  id: string;
  agency: string;
  contractor: string;
  description: string;
  amount: number;
  awardDate: string;
  url?: string;
}

// ─── Fed ───

export interface FedData {
  balanceSheet?: { value: number; change: number; date: string };
  m2?: { value: number; change: number; date: string };
  fedFunds?: { value: number; date: string };
  unemployment?: { value: number; date: string };
  gdp?: { value: number; change: number; date: string };
  cpi?: { value: number; change: number; date: string };
  pce?: { value: number; change: number; date: string };
  treasury10Y?: { value: number; date: string };
  yieldSpread?: { value: number; date: string };
  initialClaims?: { value: number; change: number; date: string };
  industrialProduction?: { value: number; change: number; date: string };
  consumerSentiment?: { value: number; change: number; date: string };
  retailSales?: { value: number; change: number; date: string };
  housingStarts?: { value: number; change: number; date: string };
  _demoKeys?: string[];
  _forecasts?: Record<string, { forecast: string; releaseDate: string }>;
  /** True when this payload is last-known-good cached data served during a FRED outage (not live). */
  stale?: boolean;
  /** True when the payload is synthetic demo data (no live fetch and no cached snapshot available). */
  _demo?: boolean;
}

// ─── Fed Calendar ───

export interface FedCalendarEvent {
  releaseId: number;
  releaseName: string;
  date: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  isToday: boolean;
  isPast: boolean;
  category?: string;
  // Finnhub enrichment (optional — missing when FINNHUB_API_KEY unavailable or no match)
  actual?: string | null;
  previous?: string | null;
  forecast?: string | null;
  reference?: string | null;
  time?: string | null;
  unit?: string | null;
  surprise?: number | null;
  surprisePercent?: number | null;
  invertBeatMiss?: boolean;
}

// ─── Twitter/X ───

export type TweetDomain = 'markets' | 'osint' | 'policy' | 'crypto' | 'ai' | 'infosec';

export interface Tweet {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorAvatarUrl?: string;
  createdAt: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  url: string;
  domain?: TweetDomain;
  relevant?: boolean;
  entities?: {
    hashtags?: string[];
    cashtags?: string[];
    urls?: { display_url: string; expanded_url: string }[];
    mentions?: string[];
  };
}

// ─── Earnings ───

export interface EarningsEvent {
  id: string;
  symbol: string;
  name: string;
  reportDate: string;
  fiscalDateEnding: string;
  estimate: number | null;
  currency: string;
  // Finnhub enrichment fields
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
  surprise: number | null;
  surprisePercent: number | null;
  hour: string | null;
  quarter: number | null;
  year: number | null;
  // Tiering + classification
  isMajor: boolean;
  isPast: boolean;
}

// ─── Monte Carlo (shared with AEGIS risk simulation) ───

export interface MonteCarloConfig {
  runs: number;
  holdYears: number;
  seed?: number;
}

export interface MonteCarloPercentile {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface MonteCarloResult {
  irr: MonteCarloPercentile;
  moic: MonteCarloPercentile;
  dscr: MonteCarloPercentile;
  probabilities: {
    irrAbove12: number;
    irrAbove15: number;
    loss: number;
    dscrBelow125: number;
  };
  stressResults: Array<{
    scenario: string;
    description: string;
    irrP50: number;
    moicP50: number;
    probLoss: number;
  }>;
  sensitivity: Array<{
    variable: string;
    impact: number;
  }>;
  config: MonteCarloConfig;
  runTimeMs: number;
}

// ═══════════════════════════════════════════════
// AEGIS — Cybersecurity domain types
// ═══════════════════════════════════════════════

export type CveSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CVE {
  cveId: string;
  publishedAt: string;
  lastModifiedAt?: string;
  summary: string;
  cweId?: string;
  cvssV3Score?: number;
  cvssV3Vector?: string;
  cvssV4Score?: number;
  cvssV4Vector?: string;
  epssScore?: number;
  epssPercentile?: number;
  severity: CveSeverity;
  isKev: boolean;
  kevAddedDate?: string;
  exploitedInWild: boolean;
  pocPublic: boolean;
  nvdSourceUrl?: string;
  tags?: string[];
}

export type CveLifecycleEvent =
  | 'published'
  | 'poc_published'
  | 'exploited_in_wild'
  | 'patched'
  | 'kev_added';

export interface CveSeverityHistoryPoint {
  observedAt: string;
  cvssScore?: number;
  epssScore?: number;
  epssPercentile?: number;
  eventType?: CveLifecycleEvent;
  source?: string;
}

export type PackageEcosystem = 'npm' | 'pypi' | 'maven' | 'go' | 'cargo' | 'nuget' | 'gem' | 'apt';

export interface AffectedProduct {
  cveId: string;
  vendor?: string;
  product?: string;
  cpeUri?: string;
  versionRangeStart?: string;
  versionRangeEnd?: string;
  packageEcosystem?: PackageEcosystem;
  packageName?: string;
  isWorkaroundAvailable: boolean;
}

export interface Remediation {
  cveId: string;
  vendor?: string;
  advisoryId?: string;
  advisoryUrl?: string;
  patchVersion?: string;
  releasedAt?: string;
  severityRatingVendor?: string;
  mitreMitigationId?: string;
  notes?: string;
}

export type IocType = 'sha256' | 'md5' | 'url' | 'ip' | 'domain' | 'email';

export interface IOC {
  iocType: IocType;
  value: string;
  firstSeen?: string;
  lastSeen?: string;
  source?: string; // urlhaus / malwarebazaar / threatfox
  confidence?: number;
  tags?: string[];
  relatedCveId?: string;
  relatedActorId?: string;
}

export interface KEV {
  cveId: string;
  addedToKevAt: string;
  dueDate?: string;
  requiredAction?: string;
  vulnerabilityName?: string;
  vendorProject?: string;
  product?: string;
  shortDescription?: string;
  knownRansomwareUse?: string;
  /** True for demo/seed rows served when CISA KEV is unreachable. The
   * cve.kev_added watcher must skip these — it always fires CRITICAL. */
  isFallback?: boolean;
}

export type ThreatActorType =
  | 'apt'
  | 'ransomware'
  | 'hacktivist'
  | 'criminal'
  | 'insider'
  | 'unknown';

export type ThreatActorSophistication = 'low' | 'medium' | 'high' | 'expert';

export interface ThreatActor {
  actorId: string;
  displayName: string;
  aliases?: string[];
  actorType: ThreatActorType;
  attributionCountry?: string;
  firstObservedAt?: string;
  lastActiveAt?: string;
  motivation?: string;
  sophistication?: ThreatActorSophistication;
  summary?: string;
  mitreGroupId?: string;
  references?: string[];
}

export type ActorGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ThreatActorScore {
  actorId: string;
  capabilityScore?: number;
  reachScore?: number;
  recencyScore?: number;
  velocityScore?: number;
  attributionConfidence?: number;
  compositeScore?: number;
  actorGrade?: ActorGrade;
  actorTier?: string;
  lastUpdated?: string;
}

export interface ThreatActorCampaign {
  id: number;
  actorId: string;
  campaignName: string;
  startDate?: string;
  endDate?: string; // null = ongoing
  targetSectors?: string[];
  targetGeographies?: string[];
  summary?: string;
  cveIdsExploited?: string[];
  references?: string[];
}

export interface ThreatActorTTP {
  actorId: string;
  mitreTacticId?: string;
  mitreTechniqueId?: string;
  mitreSubtechniqueId?: string;
  confidence?: number;
  firstObservedAt?: string;
  source?: string;
}

export type IncidentType =
  | 'ransomware'
  | 'data_breach'
  | 'credential_stuffing'
  | 'supply_chain'
  | 'ddos'
  | 'wiper'
  | 'zero_day'
  | 'phishing'
  | 'unknown';

export type IncidentOutcome = 'compromised' | 'repelled' | 'partial' | 'unknown';

export interface Incident {
  id: number;
  incidentId?: string;
  organization?: string;
  orgDomain?: string;
  industry?: string;
  country?: string;
  disclosedAt?: string;
  incidentStartedAt?: string;
  incidentEndedAt?: string;
  incidentType?: IncidentType;
  initialAccessVector?: string;
  actorId?: string;
  recordsCompromised?: number;
  estimatedLossUsd?: number;
  summary?: string;
  references?: string[];
}

export interface BreachDisclosure {
  id: number;
  orgId?: number;
  /** Human-readable breached organization (HIBP Title/Name). The activation
   * headline reads this — it used to synthesize `org_${orgId}`, and since orgId
   * is never populated for HIBP breaches, every alert said "org_unknown". */
  organization?: string;
  disclosedAt: string;
  source?: string; // sec_8k / hibp / state_ag / news
  sourceUrl?: string;
  breachType?: string;
  recordsCompromised?: number;
  attestationQuality?: 'low' | 'medium' | 'high';
  relatedCveIds?: string[];
  notes?: string;
  /** True for demo/seed rows served when the live feed is down. Panels still
   * render these so the board is never blank, but activation watchers MUST NOT
   * fire alerts / invoke Max on them. See markFallback + BUG-002. */
  isFallback?: boolean;
}

export type DefenseType =
  | 'edr'
  | 'siem'
  | 'waf'
  | 'mfa'
  | 'network_segmentation'
  | 'patch_mgmt'
  | 'awareness_training'
  | 'backup'
  | 'iam'
  | 'dlp'
  | 'other';

export type DefenseDeploymentTarget = 'endpoint' | 'network' | 'cloud' | 'identity' | 'data';

export interface Defense {
  id: number;
  defenseId?: string;
  name: string;
  defenseType: DefenseType;
  vendor?: string;
  costTier?: 'free' | 'low' | 'mid' | 'high';
  complexityTier?: 'low' | 'medium' | 'high';
  deploymentTarget?: DefenseDeploymentTarget;
  frameworks?: string[];
  summary?: string;
  references?: string[];
}

export type AdvisoryIssuer =
  | 'cisa'
  | 'ncsc_uk'
  | 'enisa'
  | 'cert_eu'
  | 'jpcert'
  | 'acsc'
  | 'cccs'
  | 'vendor';

export type AdvisoryGeography = 'us' | 'uk' | 'eu' | 'jp' | 'au' | 'ca' | 'global';

export interface Advisory {
  id: number;
  advisoryId?: string;
  issuer: AdvisoryIssuer;
  issuerGeography?: AdvisoryGeography;
  publishedAt: string;
  severity?: CveSeverity;
  title?: string;
  summary?: string;
  affectedCves?: string[];
  affectedProducts?: string[];
  advisoryUrl?: string;
  /** True for demo/seed rows served on feed failure. The advisory/patch
   * watcher filters these out before firing. */
  isFallback?: boolean;
}

export interface CompromisedOrg {
  id: number;
  orgName: string;
  orgDomain?: string;
  industry?: string;
  country?: string;
  stateRegion?: string;
  breachCount?: number;
  lastBreachAt?: string;
  totalRecordsCompromised?: number;
  hasActiveRansom?: boolean;
  enrichmentStatus?: 'pending' | 'enriched' | 'failed';
  enrichmentSource?: string;
  notes?: string;
}

export type PipelineAlertStatus = 'new' | 'triaging' | 'escalated' | 'resolved' | 'dismissed';
export type PipelineAlertKind = 'cve' | 'incident' | 'advisory' | 'ioc';

export interface PipelineAlert {
  id: number;
  alertType: string; // new_cve / new_kev / new_breach / new_patch / new_ioc / advisory
  entityKind: PipelineAlertKind;
  entityId: string;
  severity: CveSeverity;
  headline?: string;
  summary?: string;
  publishedAt: string;
  triagedAt?: string;
  escalatedAt?: string;
  resolvedAt?: string;
  assignedTo?: string;
  status: PipelineAlertStatus;
}

export type GeoThreatEventType = 'attack' | 'disclosure' | 'takedown' | 'c2_observed';

export interface GeoThreatEvent {
  id: number;
  eventType: GeoThreatEventType;
  latitude: number;
  longitude: number;
  country?: string;
  region?: string;
  city?: string;
  severity?: CveSeverity;
  targetOrgId?: number;
  actorId?: string;
  cveId?: string;
  occurredAt: string;
  summary?: string;
  source?: string;
}
