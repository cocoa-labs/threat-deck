// ═══════════════════════════════════════════════
// KLAMMER MONITOR - Feed Connector Base
// Interface for all real-time data feed connectors
// ═══════════════════════════════════════════════

export interface FeedConnector {
  /** Human-readable name for logging */
  readonly name: string;

  /** Start the connection / polling loop */
  start(): Promise<void>;

  /** Stop the connection / polling loop gracefully */
  stop(): Promise<void>;

  /** Whether the feed is currently connected / active */
  isConnected(): boolean;
}
