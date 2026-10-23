/**
 * Seedance video provider selection.
 *
 * Local dev runs the `higgsfield` CLI directly. Production (Vercel) can't shell
 * out, so it forwards to the Fly render worker via the remote provider. The
 * choice is purely transport — both implement the same surface and report the
 * same providerId, so the DB layer and `refreshGeneratedVideoIfNeeded` are
 * transport-agnostic.
 *
 * Selection: `HIGGSFIELD_REMOTE_URL` set → remote; otherwise local CLI.
 */

import {
  HiggsfieldCliVideoProvider,
  type HiggsfieldJobState,
  type HiggsfieldStartVideoInput,
  type VideoProviderProbe,
} from '@/lib/visual/providers/higgsfield-cli-video';
import { HiggsfieldRemoteVideoProvider } from '@/lib/visual/providers/higgsfield-remote-video';

export interface SeedanceVideoProvider {
  readonly providerId: string;
  readonly modelVersion: string;
  startVideo(input: HiggsfieldStartVideoInput): Promise<HiggsfieldJobState>;
  getJob(jobId: string): Promise<HiggsfieldJobState>;
  /** Read-only, credit-free liveness/auth check backing the VID preflight. */
  probe(): Promise<VideoProviderProbe>;
}

export function isRemoteVideoConfigured(): boolean {
  const url = process.env.HIGGSFIELD_REMOTE_URL;
  if (typeof url !== 'string' || url.trim().length === 0) return false;
  // On the Fly worker itself the CLI is local. If HIGGSFIELD_REMOTE_URL ever
  // leaks into the machine's shared env, honouring it would make the worker
  // forward renders to itself over the network for no reason.
  if (process.env.FLY_MACHINE_ID || process.env.FLY_APP_NAME) return false;
  return true;
}

export function getVideoProvider(): SeedanceVideoProvider {
  return isRemoteVideoConfigured()
    ? new HiggsfieldRemoteVideoProvider()
    : new HiggsfieldCliVideoProvider();
}
