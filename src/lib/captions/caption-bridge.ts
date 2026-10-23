// Module-level singleton — shared across all imports in the same browser tab.
// Bridges caption cues from useCaptionBuffer (LivestreamPanel tree) to stream
// hooks (separate component trees) for on-demand, real-time caption access.

interface TimestampedCue {
  text: string;
  timestamp: number;
}

const buffers = new Map<string, TimestampedCue[]>();
const WINDOW_MS = 60_000; // Keep 60s of cues

export function pushCue(channelId: string, text: string): void {
  let cues = buffers.get(channelId);
  if (!cues) {
    cues = [];
    buffers.set(channelId, cues);
  }
  cues.push({ text, timestamp: Date.now() });
  // Prune old cues
  const cutoff = Date.now() - WINDOW_MS;
  const firstValid = cues.findIndex((c) => c.timestamp >= cutoff);
  if (firstValid > 0) cues.splice(0, firstValid);
}

export function getRecentCues(channelId: string, windowMs = 30_000): string[] {
  const cues = buffers.get(channelId);
  if (!cues) return [];
  const cutoff = Date.now() - windowMs;
  return cues.filter((c) => c.timestamp >= cutoff).map((c) => c.text);
}

export function clearChannel(channelId: string): void {
  buffers.delete(channelId);
}
