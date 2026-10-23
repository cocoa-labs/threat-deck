import { create } from 'zustand';
import type { AlertHistoryItem, Severity } from '@/lib/types';

interface AlertsState {
  alerts: AlertHistoryItem[];
  unacknowledgedCount: number;
  soundEnabled: boolean;

  setAlerts: (alerts: AlertHistoryItem[]) => void;
  addAlert: (alert: AlertHistoryItem) => void;
  acknowledgeAlert: (id: string) => void;
  setSoundEnabled: (enabled: boolean) => void;
}

export const useAlertsStore = create<AlertsState>((set) => ({
  alerts: [],
  unacknowledgedCount: 0,
  soundEnabled: true,

  setAlerts: (alerts) =>
    set({
      alerts,
      unacknowledgedCount: alerts.filter((a) => !a.acknowledged).length,
    }),

  addAlert: (alert) =>
    set((state) => {
      const next = [alert, ...state.alerts].slice(0, 100);
      return {
        alerts: next,
        unacknowledgedCount: next.filter((a) => !a.acknowledged).length,
      };
    }),

  acknowledgeAlert: (id) =>
    set((state) => {
      const next = state.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a));
      return {
        alerts: next,
        unacknowledgedCount: next.filter((a) => !a.acknowledged).length,
      };
    }),

  setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
}));

export function getSeverityColor(severity: Severity): string {
  const colors: Record<Severity, string> = {
    critical: 'var(--severity-critical)',
    high: 'var(--severity-high)',
    medium: 'var(--severity-medium)',
    low: 'var(--severity-low)',
    info: 'var(--severity-info)',
  };
  return colors[severity];
}
