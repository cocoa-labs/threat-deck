/** Shared watchlist-monitor vocab — used by the API routes + the scan cron. */
export const MONITOR_SOURCES = ['cve', 'kev', 'breach', 'news', 'tweet'] as const;
export const MONITOR_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type MonitorSource = (typeof MONITOR_SOURCES)[number];
export type MonitorSeverity = (typeof MONITOR_SEVERITIES)[number];
