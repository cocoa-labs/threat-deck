/**
 * Cross-poller claim registry for generated-media polling.
 *
 * Two independent loops can chase the same render: the stream-level poller in
 * `use-agent-stream` / `use-companion-stream` (which also resolves deferred
 * email attachments), and AgentDrawer's reload-safe resume poller (which is the
 * only one that survives a refresh). Both are wanted — but not simultaneously
 * on the same id.
 *
 * Every poll of a pending VIDEO calls `refreshGeneratedVideoIfNeeded`, which
 * shells out to the higgsfield CLI locally or makes a Fly round-trip in
 * production. Two loops at 2s meant a provider call every second per render,
 * and two concurrent finalize attempts downloading the same MP4.
 *
 * Module scope is the right lifetime: it is per-tab, and a claim must outlive
 * any single component instance.
 */

const inFlight = new Set<string>();

/** Returns true if the caller now owns polling for this id. */
export function claimMediaPoll(generatedMediaId: string): boolean {
  if (inFlight.has(generatedMediaId)) return false;
  inFlight.add(generatedMediaId);
  return true;
}

export function releaseMediaPoll(generatedMediaId: string): void {
  inFlight.delete(generatedMediaId);
}
