import { create } from 'zustand';
import type {
  Advisory,
  AgentIntelMarker,
  BreachDisclosure,
  CongressTrade,
  CryptoPrice,
  CVE,
  EarningsEvent,
  FedCalendarEvent,
  FedData,
  GovernmentContract,
  Incident,
  IntelligenceItem,
  IOC,
  KEV,
  MarketQuote,
  MonteCarloResult,
  NewsItem,
  PredictionMarket,
  SectorData,
  ThreatActor,
  Tweet,
  WhaleTransaction,
} from '@/lib/types';

interface DataState {
  // Market data
  indices: MarketQuote[];
  sectors: SectorData[];
  commodities: MarketQuote[];

  // News
  news: Record<string, NewsItem[]>;

  // Crypto
  crypto: CryptoPrice[];

  // Alternative data
  congressTrades: CongressTrade[];
  whaleTransactions: WhaleTransaction[];
  predictionMarkets: PredictionMarket[];
  fedData: FedData | null;
  fedCalendar: FedCalendarEvent[];
  earnings: EarningsEvent[];
  governmentContracts: GovernmentContract[];

  // Twitter/X
  tweets: Tweet[];

  // Intelligence stream
  intelligenceItems: IntelligenceItem[];

  // Agent intelligence markers
  agentIntelMarkers: AgentIntelMarker[];

  // AEGIS / cyber data
  cves: CVE[];
  kev: KEV[];
  iocs: IOC[];
  breaches: BreachDisclosure[];
  /**
   * CERT / national-body advisories ONLY (CISA, NCSC-UK, JPCERT, …), written
   * solely by `useAdvisoryData`. Vendor patches live in `patches`.
   *
   * These were one slice, written wholesale by two hooks on the same cadence,
   * so it thrashed between disjoint payloads and every reader got whichever
   * poll landed last — CERT rows under the PATCH TRACKER's vendor tabs, a
   * ticker symbol reading "VENDOR", vendor-HQ pins on the globe.
   */
  advisories: Advisory[];
  /** Vendor security updates ONLY, written solely by `usePatchData`. */
  patches: Advisory[];
  threatActors: ThreatActor[];
  incidents: Incident[];
  riskSimulation: MonteCarloResult | null;

  // Timestamps
  lastUpdated: Record<string, number>;

  // Actions
  setIndices: (data: MarketQuote[]) => void;
  setSectors: (data: SectorData[]) => void;
  setCommodities: (data: MarketQuote[]) => void;
  setNews: (category: string, items: NewsItem[]) => void;
  setCrypto: (data: CryptoPrice[]) => void;
  setCongressTrades: (data: CongressTrade[]) => void;
  setWhaleTransactions: (data: WhaleTransaction[]) => void;
  setPredictionMarkets: (data: PredictionMarket[]) => void;
  setFedData: (data: FedData) => void;
  setFedCalendar: (data: FedCalendarEvent[]) => void;
  setEarnings: (data: EarningsEvent[]) => void;
  setGovernmentContracts: (data: GovernmentContract[]) => void;
  setTweets: (data: Tweet[]) => void;
  addIntelligenceItem: (item: IntelligenceItem) => void;
  setIntelligenceItems: (items: IntelligenceItem[]) => void;
  addAgentIntelMarkers: (markers: AgentIntelMarker[]) => void;
  removeExpiredAgentIntelMarkers: () => void;
  clearAgentIntelMarkers: () => void;
  setCves: (data: CVE[]) => void;
  setKev: (data: KEV[]) => void;
  setIocs: (data: IOC[]) => void;
  setBreaches: (data: BreachDisclosure[]) => void;
  setAdvisories: (data: Advisory[]) => void;
  setPatches: (data: Advisory[]) => void;
  setThreatActors: (data: ThreatActor[]) => void;
  setIncidents: (data: Incident[]) => void;
  setRiskSimulation: (data: MonteCarloResult | null) => void;
  markUpdated: (key: string) => void;
}

const MAX_INTELLIGENCE_ITEMS = 200;
const MAX_AGENT_INTEL_MARKERS = 50;

export const useDataStore = create<DataState>((set) => ({
  indices: [],
  sectors: [],
  commodities: [],
  news: {},
  crypto: [],
  congressTrades: [],
  whaleTransactions: [],
  predictionMarkets: [],
  fedData: null,
  fedCalendar: [],
  earnings: [],
  governmentContracts: [],
  tweets: [],
  intelligenceItems: [],
  agentIntelMarkers: [],
  cves: [],
  kev: [],
  iocs: [],
  breaches: [],
  advisories: [],
  patches: [],
  threatActors: [],
  incidents: [],
  riskSimulation: null,
  lastUpdated: {},

  setIndices: (data) =>
    set({
      indices: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, indices: Date.now() },
    }),

  setSectors: (data) =>
    set({
      sectors: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, sectors: Date.now() },
    }),

  setCommodities: (data) =>
    set({
      commodities: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, commodities: Date.now() },
    }),

  setNews: (category, items) =>
    set((state) => ({
      news: { ...state.news, [category]: items },
      lastUpdated: { ...state.lastUpdated, [`news_${category}`]: Date.now() },
    })),

  setCrypto: (data) =>
    set({
      crypto: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, crypto: Date.now() },
    }),

  setCongressTrades: (data) => set({ congressTrades: data }),
  setWhaleTransactions: (data) => set({ whaleTransactions: data }),
  setPredictionMarkets: (data) => set({ predictionMarkets: data }),
  setFedData: (data) => set({ fedData: data }),
  setFedCalendar: (data) => set({ fedCalendar: data }),
  setEarnings: (data) => set({ earnings: data }),
  setGovernmentContracts: (data) => set({ governmentContracts: data }),
  setTweets: (data) =>
    set({
      tweets: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, tweets: Date.now() },
    }),

  addIntelligenceItem: (item) =>
    set((state) => ({
      intelligenceItems: [item, ...state.intelligenceItems].slice(0, MAX_INTELLIGENCE_ITEMS),
    })),

  setIntelligenceItems: (items) => set({ intelligenceItems: items }),

  addAgentIntelMarkers: (markers) =>
    set((state) => ({
      agentIntelMarkers: [...state.agentIntelMarkers, ...markers].slice(-MAX_AGENT_INTEL_MARKERS),
    })),

  removeExpiredAgentIntelMarkers: () =>
    set((state) => ({
      agentIntelMarkers: state.agentIntelMarkers.filter(
        (m) => Date.now() - m.createdAt < m.ttl * 1000,
      ),
    })),

  clearAgentIntelMarkers: () => set({ agentIntelMarkers: [] }),

  setCves: (data) =>
    set({
      cves: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, cves: Date.now() },
    }),

  setKev: (data) =>
    set({
      kev: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, kev: Date.now() },
    }),

  setIocs: (data) =>
    set({
      iocs: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, iocs: Date.now() },
    }),

  setBreaches: (data) =>
    set({
      breaches: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, breaches: Date.now() },
    }),

  setAdvisories: (data) =>
    set({
      advisories: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, advisories: Date.now() },
    }),

  setPatches: (data) =>
    set({
      patches: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, patches: Date.now() },
    }),

  setThreatActors: (data) =>
    set({
      threatActors: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, threatActors: Date.now() },
    }),

  setIncidents: (data) =>
    set({
      incidents: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, incidents: Date.now() },
    }),

  setRiskSimulation: (data) =>
    set({
      riskSimulation: data,
      lastUpdated: { ...useDataStore.getState().lastUpdated, riskSimulation: Date.now() },
    }),

  markUpdated: (key) =>
    set((state) => ({
      lastUpdated: { ...state.lastUpdated, [key]: Date.now() },
    })),
}));
