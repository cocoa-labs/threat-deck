import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/outbound/generated-media/[id] (Phase 14 Tier A)
 *
 * Polling endpoint for the IMG button client.
 * Returns current state of the aegis_generated_media row:
 *   - status: 'pending' | 'ready' | 'failed'
 *   - blob_url (null until status='ready')
 *   - error_message (set when status='failed')
 *   - generation_duration_ms (set when status='ready' or 'failed')
 */

import { auth } from '@/lib/auth';
import { query } from '@/lib/db/client';
import { refreshGeneratedVideoIfNeeded } from '@/lib/visual/video-generation-service';

// This route can synchronously drive a render to completion: a provider call
// (30s cap) plus an MP4 download (60s cap) plus a Blob upload. At the platform
// default it gets killed mid-download, the finalize claim expires, and the next
// poll starts over — until the reaper abandons a render that actually succeeded.
export const runtime = 'nodejs';
export const maxDuration = 120;

function getErrorDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type GeneratedMediaRow = {
  id: string;
  media_kind: string;
  status: string;
  blob_url: string | null;
  error_message: string | null;
  cost_usd: string | null;
  generation_duration_ms: number | null;
  style_tag: string;
  visual_schema_version: string | null;
  visual_payload: unknown;
  provider_job_id: string | null;
  provider_status: string | null;
  created_at: string;
};

async function loadGeneratedMediaRow(
  id: number,
  ownerEmail: string,
): Promise<GeneratedMediaRow | undefined> {
  const result = await query<GeneratedMediaRow>(
    `SELECT id::text, media_kind, status, blob_url, error_message, cost_usd::text, generation_duration_ms, style_tag, visual_schema_version, visual_payload, provider_job_id, provider_status, created_at::text
       FROM aegis_generated_media
       WHERE id = $1 AND owner_email = $2`,
    [id, ownerEmail],
  );
  return result.rows[0];
}

async function routeGETImplementation(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id: idParam } = await context.params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  try {
    let row = await loadGeneratedMediaRow(id, session.user.email);
    if (!row) {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }
    if (row.media_kind === 'video' && row.status === 'pending') {
      await refreshGeneratedVideoIfNeeded(String(id));
      row = (await loadGeneratedMediaRow(id, session.user.email)) ?? row;
    }

    return Response.json({
      ok: true,
      generatedMediaId: row.id,
      mediaKind: row.media_kind,
      status: row.status,
      pollUrl: `/api/outbound/generated-media/${row.id}`,
      blobUrl: row.blob_url ? `/api/outbound/generated-media/${row.id}/content` : null,
      errorMessage: row.error_message,
      costUsd: row.cost_usd ? Number(row.cost_usd) : null,
      generationDurationMs: row.generation_duration_ms,
      styleTag: row.style_tag,
      visualSchemaVersion: row.visual_schema_version,
      visualPayload: row.visual_payload,
      providerJobId: row.provider_job_id,
      providerStatus: row.provider_status,
      createdAt: row.created_at,
    });
  } catch (err) {
    const detail = getErrorDetail(err);
    console.error('[generated-media] lookup failed:', detail);
    return Response.json(
      { ok: false, error: 'generated_media_lookup_failed', detail },
      { status: 500 },
    );
  }
}

export const GET = withRoutePolicy('/api/outbound/generated-media/[id]', routeGETImplementation);
