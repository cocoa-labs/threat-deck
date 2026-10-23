import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AGENT_IDENTITY } from '@/lib/constants/agent-identity';
import type { PanelConfig, PanelId, SlotId } from '@/lib/types';
import { migrateLocalStorageKey } from '@/lib/utils/storage-migration';

// Phase 5 rename: klammer-panels → threatdeck-panels. Run BEFORE persist
// middleware initializes so existing slot layouts + visibility carry over.
migrateLocalStorageKey('klammer-panels', 'threatdeck-panels');

export const PANEL_CONFIGS: PanelConfig[] = [
  // Markets
  { id: 'markets', title: 'MARKETS', defaultVisible: true, span: 2, priority: 1 },
  { id: 'news', title: 'NEWS', defaultVisible: true, span: 1, priority: 1 },
  { id: 'heatmap', title: 'SECTOR HEATMAP', defaultVisible: true, span: 1, priority: 1 },
  { id: 'crypto', title: 'CRYPTO', defaultVisible: true, span: 1, priority: 1 },
  {
    id: 'agentBrief',
    title: `${AGENT_IDENTITY.name.toUpperCase()} BRIEF`,
    defaultVisible: true,
    span: 1,
    priority: 1,
  },
  {
    id: 'agentActivity',
    title: `${AGENT_IDENTITY.name.toUpperCase()} ACTIVITY`,
    defaultVisible: true,
    span: 1,
    priority: 1,
  },
  { id: 'polymarket', title: 'PREDICTION MARKETS', defaultVisible: true, span: 2, priority: 2 },
  { id: 'congress', title: 'CONGRESS TRADES', defaultVisible: true, span: 1, priority: 2 },
  { id: 'whales', title: 'WHALE WATCH', defaultVisible: true, span: 1, priority: 2 },
  { id: 'fed', title: 'ECONOMIC INDICATORS', defaultVisible: true, span: 2, priority: 2 },
  { id: 'earnings', title: 'EARNINGS CALENDAR', defaultVisible: true, span: 1, priority: 2 },
  { id: 'contracts', title: 'GOV CONTRACTS', defaultVisible: false, span: 2, priority: 3 },
  // The alert spine's catch-all surface. The hero breaking-alert overlay is
  // geo-gated, so alerts that don't resolve to coordinates land ONLY here —
  // this panel must be visible by default or those alerts have no home.
  { id: 'alerts', title: 'ALERTS', defaultVisible: true, span: 1, priority: 1 },
  { id: 'monitors', title: 'MY MONITORS', defaultVisible: false, span: 1, priority: 2 },
  { id: 'chart', title: 'CHART', defaultVisible: false, span: 2, priority: 2 },
  { id: 'livestream', title: 'LIVESTREAM', defaultVisible: false, span: 1, priority: 3 },
  { id: 'livestream2', title: 'LIVESTREAM 2', defaultVisible: false, span: 1, priority: 3 },
  { id: 'newsFeed', title: 'NEWS FEED', defaultVisible: true, span: 1, priority: 2 },
  { id: 'twitter', title: 'X FEED', defaultVisible: false, span: 1, priority: 2 },
  { id: 'youtubeSearch', title: 'YOUTUBE', defaultVisible: false, span: 1, priority: 3 },
  // AEGIS deep-intel (Phase 4 — Cyber)
  { id: 'cvePipeline', title: 'CVE PIPELINE', defaultVisible: true, span: 2, priority: 1 },
  { id: 'threatActorScores', title: 'THREAT ACTORS', defaultVisible: true, span: 1, priority: 1 },
  { id: 'incidentAssessment', title: 'INCIDENTS', defaultVisible: true, span: 2, priority: 1 },
  { id: 'riskSimulation', title: 'RISK SIMULATION', defaultVisible: true, span: 1, priority: 1 },
  // Cyber feeds (Phase 4)
  { id: 'kevAlerts', title: 'KEV ALERTS', defaultVisible: true, span: 1, priority: 1 },
  { id: 'iocFeed', title: 'IOC FEED', defaultVisible: true, span: 1, priority: 2 },
  { id: 'patchTracker', title: 'PATCH TRACKER', defaultVisible: true, span: 1, priority: 2 },
  { id: 'breachDisclosure', title: 'BREACH WIRE', defaultVisible: true, span: 1, priority: 1 },
  { id: 'xReplies', title: 'X REPLIES', defaultVisible: true, span: 1, priority: 2 },
  { id: 'emailReplies', title: 'EMAIL REPLIES', defaultVisible: true, span: 1, priority: 2 },
  // Forecast (Phase 11.D)
  { id: 'predictions', title: 'PREDICTIONS', defaultVisible: true, span: 2, priority: 1 },
];

/* ─── Default slot assignments ─── */

const DEFAULT_SLOT_ASSIGNMENTS: Record<SlotId, PanelId> = {
  // Hero: cyber-first layout
  'left-1': 'cvePipeline',
  'right-1': 'threatActorScores',
  'right-2': 'breachDisclosure',
  'bottom-1': 'iocFeed',
  'bottom-2': 'agentBrief',
  // Grid
  'grid-1': 'news',
  'grid-2': 'agentActivity',
  'grid-3': 'incidentAssessment',
  'grid-4': 'patchTracker',
  'grid-5': 'twitter',
  'grid-6': 'newsFeed',
  'grid-7': 'riskSimulation',
  'grid-8': 'kevAlerts',
  'grid-9': 'emailReplies',
  'grid-10': 'monitors',
  'grid-11': 'xReplies',
  // Phase: alert unification — ALERTS takes the last grid slot from the
  // finance-era `predictions` panel. It is the guaranteed home for every alert,
  // including the ones the geo-gated hero overlay can't show.
  'grid-12': 'alerts',
};

/* ─── Renamed panel IDs (persisted-state migration) ─── */

const PANEL_RENAMES: Partial<Record<string, PanelId>> = {
  atlasDealPipeline: 'cvePipeline',
  atlasLocationScores: 'threatActorScores',
  atlasAssessment: 'incidentAssessment',
  atlasMonteCarloResults: 'riskSimulation',
  capitalSources: 'patchTracker',
  creRates: 'kevAlerts',
  bankHealth: 'breachDisclosure',
  outreach: 'iocFeed',
  // Phase 11.D — livestream2 was defaultVisible:false; PredictionsPanel
  // takes its grid-12 slot. Users who never customized see the change;
  // anyone who explicitly placed livestream2 elsewhere keeps their layout.
  livestream2: 'predictions',
};

/* ─── State interface ─── */

interface PanelsState {
  // Legacy visibility state (backward-compatible)
  visiblePanels: Set<PanelId>;
  panelOrder: PanelId[];
  collapsedPanels: Set<PanelId>;

  // Slot-based state
  slotAssignments: Record<SlotId, PanelId>;
  fullscreenSlot: SlotId | null;
  heroFullscreen: boolean;

  // Column collapse state
  leftColumnCollapsed: boolean;
  rightColumnCollapsed: boolean;

  // Legacy actions
  togglePanel: (id: PanelId) => void;
  showPanel: (id: PanelId) => void;
  hidePanel: (id: PanelId) => void;
  toggleCollapse: (id: PanelId) => void;
  reorderPanels: (order: PanelId[]) => void;
  resetToDefaults: () => void;

  // Column collapse actions
  toggleLeftColumn: () => void;
  toggleRightColumn: () => void;

  // Slot actions
  assignPanelToSlot: (slotId: SlotId, panelId: PanelId) => void;
  setFullscreenSlot: (slotId: SlotId | null) => void;
  setHeroFullscreen: (fullscreen: boolean) => void;
}

/** The persisted (partialized) shape — Sets are serialized as arrays. */
type PersistedPanelsState = {
  visiblePanels: PanelId[];
  panelOrder: PanelId[];
  collapsedPanels: PanelId[];
  slotAssignments: Record<SlotId, PanelId>;
  leftColumnCollapsed: boolean;
  rightColumnCollapsed: boolean;
};

const defaultVisible = new Set<PanelId>(
  PANEL_CONFIGS.filter((p) => p.defaultVisible).map((p) => p.id),
);

const defaultOrder = PANEL_CONFIGS.map((p) => p.id);

export const usePanelsStore = create<PanelsState>()(
  persist(
    (set) => ({
      visiblePanels: defaultVisible,
      panelOrder: defaultOrder,
      collapsedPanels: new Set<PanelId>(),

      // Slot-based state
      slotAssignments: { ...DEFAULT_SLOT_ASSIGNMENTS },
      fullscreenSlot: null,
      heroFullscreen: false,

      // Column collapse state
      leftColumnCollapsed: false,
      rightColumnCollapsed: false,

      togglePanel: (id) => {
        set((state) => {
          const next = new Set(state.visiblePanels);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { visiblePanels: next };
        });
      },

      showPanel: (id) => {
        set((state) => ({
          visiblePanels: new Set([...state.visiblePanels, id]),
        }));
      },

      hidePanel: (id) => {
        set((state) => {
          const next = new Set(state.visiblePanels);
          next.delete(id);
          return { visiblePanels: next };
        });
      },

      toggleCollapse: (id) => {
        set((state) => {
          const next = new Set(state.collapsedPanels);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { collapsedPanels: next };
        });
      },

      reorderPanels: (order) => set({ panelOrder: order }),

      // Column collapse actions
      toggleLeftColumn: () => set((s) => ({ leftColumnCollapsed: !s.leftColumnCollapsed })),
      toggleRightColumn: () => set((s) => ({ rightColumnCollapsed: !s.rightColumnCollapsed })),

      resetToDefaults: () =>
        set({
          visiblePanels: defaultVisible,
          panelOrder: defaultOrder,
          collapsedPanels: new Set<PanelId>(),
          slotAssignments: { ...DEFAULT_SLOT_ASSIGNMENTS },
          fullscreenSlot: null,
          heroFullscreen: false,
          leftColumnCollapsed: false,
          rightColumnCollapsed: false,
        }),

      assignPanelToSlot: (slotId, panelId) => {
        set((state) => ({
          slotAssignments: { ...state.slotAssignments, [slotId]: panelId },
        }));
      },

      setFullscreenSlot: (slotId) => set({ fullscreenSlot: slotId }),

      setHeroFullscreen: (fullscreen) => set({ heroFullscreen: fullscreen }),
    }),
    {
      name: 'threatdeck-panels',
      version: 2,
      // v0 → v1 (email detour): surface the X REPLIES + EMAIL REPLIES panels on
      // existing decks. Non-destructive — only takes over the two slots if they
      // still hold their original defaults (alerts / livestream) and the reply
      // panel isn't already placed. Customized slots are left alone (use the
      // channel selector). Fresh installs get them via DEFAULT_SLOT_ASSIGNMENTS.
      //
      // v1 → v2 (alert unification): ALERTS became a real, populated panel and
      // the guaranteed home for every alert the geo-gated hero overlay can't
      // show. Existing decks had it hidden (it was permanently empty), so
      // surface it in grid-12 — but only if that slot still holds its default
      // `predictions` and ALERTS isn't already placed somewhere.
      migrate: (persisted: unknown, fromVersion: number) => {
        if (!persisted || typeof persisted !== 'object') {
          return persisted as PersistedPanelsState;
        }
        const p = persisted as {
          slotAssignments?: Record<string, string>;
          visiblePanels?: string[];
        };
        const slots = p.slotAssignments;

        if (fromVersion < 1 && slots) {
          const placed = (id: string) => Object.values(slots).includes(id);
          if (!placed('emailReplies') && slots['grid-9'] === 'alerts') {
            slots['grid-9'] = 'emailReplies';
          }
          if (!placed('xReplies') && slots['grid-11'] === 'livestream') {
            slots['grid-11'] = 'xReplies';
          }
        }

        if (fromVersion < 2 && slots) {
          const placed = (id: string) => Object.values(slots).includes(id);
          if (!placed('alerts') && slots['grid-12'] === 'predictions') {
            slots['grid-12'] = 'alerts';
          }
          if (Array.isArray(p.visiblePanels) && !p.visiblePanels.includes('alerts')) {
            p.visiblePanels.push('alerts');
          }
        }

        return persisted as PersistedPanelsState;
      },
      partialize: (state) => ({
        visiblePanels: [...state.visiblePanels],
        panelOrder: state.panelOrder,
        collapsedPanels: [...state.collapsedPanels],
        slotAssignments: state.slotAssignments,
        leftColumnCollapsed: state.leftColumnCollapsed,
        rightColumnCollapsed: state.rightColumnCollapsed,
      }),
      merge: (persisted, current) => {
        const stored = persisted as
          | {
              visiblePanels?: PanelId[];
              panelOrder?: PanelId[];
              collapsedPanels?: PanelId[];
              slotAssignments?: Record<string, PanelId>;
              leftColumnCollapsed?: boolean;
              rightColumnCollapsed?: boolean;
            }
          | undefined;

        // Rename old ATLAS/CRE panel IDs to their cyber replacements
        const renameId = (id: PanelId | string): PanelId =>
          (PANEL_RENAMES[id as string] ?? id) as PanelId;

        // Migrate old slot IDs and strip unknown ones
        let migratedSlots: Record<SlotId, PanelId> | undefined;
        if (stored?.slotAssignments) {
          const validSlotIds = new Set(Object.keys(DEFAULT_SLOT_ASSIGNMENTS));
          const raw = { ...stored.slotAssignments };

          // Remap removed slots to grid positions
          if ('left-3' in raw) {
            raw['grid-1'] = raw['left-3'] as PanelId;
            delete raw['left-3'];
          }
          if ('right-3' in raw) {
            raw['grid-2'] = raw['right-3'] as PanelId;
            delete raw['right-3'];
          }

          // Apply panel renames first (atlas/CRE → cyber)
          for (const [key, value] of Object.entries(raw)) {
            raw[key] = renameId(value);
          }

          // Strip any unknown slot IDs, keep only valid ones
          const cleaned: Partial<Record<SlotId, PanelId>> = {};
          for (const [key, value] of Object.entries(raw)) {
            if (validSlotIds.has(key)) {
              cleaned[key as SlotId] = value;
            }
          }

          migratedSlots = { ...DEFAULT_SLOT_ASSIGNMENTS, ...cleaned };
        }

        return {
          ...current,
          visiblePanels: stored?.visiblePanels
            ? new Set(stored.visiblePanels.map(renameId))
            : current.visiblePanels,
          panelOrder: stored?.panelOrder ? stored.panelOrder.map(renameId) : current.panelOrder,
          collapsedPanels: stored?.collapsedPanels
            ? new Set(stored.collapsedPanels)
            : current.collapsedPanels,
          slotAssignments: migratedSlots ?? current.slotAssignments,
          leftColumnCollapsed: stored?.leftColumnCollapsed ?? false,
          rightColumnCollapsed: stored?.rightColumnCollapsed ?? false,
        };
      },
    },
  ),
);
