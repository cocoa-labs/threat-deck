import { create } from 'zustand';

type ConnectionMode = 'connecting' | 'live' | 'rest';

interface ConnectionState {
  wsConnected: boolean;
  wsEverConnected: boolean;
  mode: ConnectionMode;
  feedStatuses: Record<string, 'connected' | 'disconnected' | 'reconnecting'>;
  lastWsMessage: number | null;
  setWsConnected: (connected: boolean) => void;
  setFeedStatus: (feed: string, status: 'connected' | 'disconnected' | 'reconnecting') => void;
  setLastWsMessage: (timestamp: number) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  wsConnected: false,
  wsEverConnected: false,
  mode: 'connecting',
  feedStatuses: {},
  lastWsMessage: null,

  setWsConnected: (connected) =>
    set((state) => ({
      wsConnected: connected,
      wsEverConnected: state.wsEverConnected || connected,
      mode: connected ? 'live' : 'rest',
    })),

  setFeedStatus: (feed, status) =>
    set((state) => ({
      feedStatuses: { ...state.feedStatuses, [feed]: status },
    })),

  setLastWsMessage: (timestamp) => set({ lastWsMessage: timestamp }),
}));
