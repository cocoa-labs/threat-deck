/**
 * generateInfographic — end-to-end visual generation orchestrator.
 *
 * IMG Button V2 makes the image model the primary infographic renderer. The
 * orchestrator now sends a structured VisualBrief + Cocoa AI visual spec to
 * gpt-image-2 and uploads the returned PNG directly. The old Satori overlay
 * path remains available in the codebase as fallback/provenance plumbing, but
 * it is not the default generation path.
 *
 * On any failure:
 *   - UPDATE aegis_generated_media row: status='failed'
 *   - recordAudit OUTBOUND_VISUAL_FAILED
 *   - rethrow the original error for the caller (route handler) to surface
 *
 * IMPORTANT: The caller MUST have already inserted the aegis_generated_media
 * row (status='pending') before calling this function. This orchestrator only
 * updates the existing row.
 */

import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { uploadVisualBlob } from '@/lib/storage/vercel-blob';
import {
  buildModelRenderedInfographicPrompt,
  buildSafetySoftenedInfographicPrompt,
} from '@/lib/visual/infographic-prompt';
import { OpenAIImageProvider } from '@/lib/visual/providers/openai-image';
import { type ImageGenerationResult, ProviderApiError } from '@/lib/visual/providers/types';
import type { StyleTag } from '@/lib/visual/style-registry';
import type { VisualBrief, VisualBriefSourceContext } from '@/lib/visual/visual-brief';

// ─── Public request type ──────────────────────────────────────────────────────

export interface GenerateInfographicRequest {
  /** Primary key of the aegis_generated_media row (must already exist as 'pending'). */
  generatedMediaId: string;
  styleTag: StyleTag;
  visualBrief: VisualBrief;
  sourceContext?: VisualBriefSourceContext | null;
  entityKind?: string;
  entityId?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  generatedAt: string; // ISO 8601
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function generateInfographic(req: GenerateInfographicRequest): Promise<void> {
  const { generatedMediaId, styleTag } = req;
  const startMs = Date.now();

  const infographicPrompt = buildModelRenderedInfographicPrompt(req.visualBrief, styleTag);

  let blobUrl: string | undefined;
  let blobSize: number | undefined;
  let costUsd: number | undefined;
  let generationDurationMs: number | undefined;
  let providerName: string | undefined;
  let modelVersion: string | undefined;
  let promptUsed = infographicPrompt;
  let safetyRetry = false;

  try {
    // Step 1 — generate the full model-rendered infographic.
    const provider = new OpenAIImageProvider();
    let generated: ImageGenerationResult;
    try {
      generated = await provider.generate({
        prompt: infographicPrompt,
        styleTag,
        width: 1200,
        height: 2400,
        quality: 'high',
        allowText: true,
      });
    } catch (err) {
      if (!isImageSafetyRejection(err)) {
        throw err;
      }

      safetyRetry = true;
      promptUsed = buildSafetySoftenedInfographicPrompt(req.visualBrief, styleTag);
      generated = await provider.generate({
        prompt: promptUsed,
        styleTag,
        width: 1200,
        height: 2400,
        quality: 'high',
        allowText: true,
      });
    }

    if (generated.buffer.length < 1024) {
      throw new Error('image provider returned an unexpectedly small image buffer');
    }

    costUsd = generated.costUsd;
    generationDurationMs = generated.durationMs;
    providerName = generated.provider;
    modelVersion = generated.modelVersion;

    // Step 2 — upload final PNG to Vercel Blob.
    // @vercel/blob put() only accepts access: 'public'; the underlying store
    // MUST be configured as a public Blob store. If you see a 400 "access must
    // be public" or "Cannot use public access on a private store" error, the
    // store needs to be recreated in public mode (Vercel doesn't expose a
    // flip-mode toggle on existing private stores at the time of writing).
    const blobResult = await uploadVisualBlob(
      `outbound-visuals/${styleTag}/${generatedMediaId}.png`,
      generated.buffer,
      { contentType: 'image/png' },
    );

    blobUrl = blobResult.url;
    blobSize = generated.buffer.length;

    // Step 3 — UPDATE row: status='ready' + metadata
    await query(
      `UPDATE aegis_generated_media
          SET status = 'ready',
              blob_url = $1,
              blob_size_bytes = $2,
              cost_usd = $3,
              generation_duration_ms = $4,
              provider = $5,
              model_version = $6,
              prompt_used = $7,
              visual_schema_version = $8,
              visual_payload = $9::jsonb,
              source_context = $10::jsonb
        WHERE id = $11`,
      [
        blobUrl,
        blobSize,
        costUsd ?? 0,
        generationDurationMs ?? Math.max(1, Date.now() - startMs),
        providerName ?? 'openai_gpt_image_2',
        modelVersion ?? null,
        promptUsed,
        req.visualBrief.schemaVersion,
        JSON.stringify(req.visualBrief),
        JSON.stringify(req.sourceContext ?? null),
        generatedMediaId,
      ],
    );

    // Step 4 — audit success
    await recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_VISUAL_GENERATED,
      outcome: 'success',
      targetKind: 'generated_media',
      targetId: generatedMediaId,
      details: {
        styleTag,
        entityKind: req.entityKind,
        entityId: req.entityId,
        title: req.visualBrief.title,
        schemaVersion: req.visualBrief.schemaVersion,
        blobUrl,
        blobSizeBytes: blobSize,
        costUsd: costUsd ?? 0,
        generationDurationMs: generationDurationMs ?? 0,
        provider: providerName,
        modelVersion,
        safetyRetry,
      },
    });
  } catch (err) {
    // Failure path: mark row as failed + audit + rethrow
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Best-effort DB update — don't let a secondary DB failure mask the original error
    try {
      await query(
        `UPDATE aegis_generated_media
            SET status = 'failed',
                error_message = $2
          WHERE id = $1`,
        [generatedMediaId, errorMessage],
      );
    } catch (dbErr) {
      console.error('[orchestrator] failed to mark row as failed:', dbErr);
    }

    // Best-effort audit
    try {
      await recordAudit({
        action: AUDIT_ACTIONS.OUTBOUND_VISUAL_FAILED,
        outcome: 'failure',
        targetKind: 'generated_media',
        targetId: generatedMediaId,
        errorMessage,
        details: {
          styleTag,
          entityKind: req.entityKind,
          entityId: req.entityId,
          title: req.visualBrief.title,
          errorName: err instanceof Error ? err.name : 'UnknownError',
        },
      });
    } catch (auditErr) {
      console.error('[orchestrator] failed to record failure audit:', auditErr);
    }

    throw err;
  }
}

function isImageSafetyRejection(err: unknown): boolean {
  if (!(err instanceof ProviderApiError) || err.status !== 400) return false;
  const message = err.providerMessage.toLowerCase();
  return message.includes('safety system') || message.includes('rejected by the safety');
}
