import { createHash } from 'node:crypto';
import { AUDIT_ACTIONS, recordAudit } from '@/lib/audit';
import { query } from '@/lib/db/client';
import { requireCapability } from '@/lib/security/capabilities';
import { checkOutboundVisualSpend } from '@/lib/security/visual-spend';
import { generateInfographic } from '@/lib/visual/orchestrator';
import type { StyleTag } from '@/lib/visual/style-registry';
import {
  normalizeSourceContext,
  resolveVisualStyleTag,
  VISUAL_BRIEF_SCHEMA_VERSION,
  type VisualBriefSeverity,
  type VisualBriefSourceContext,
} from '@/lib/visual/visual-brief';
import { buildVisualBrief } from '@/lib/visual/visual-brief-llm';

export interface StartImageGenerationInput {
  messageContent: string;
  messageTimestamp?: unknown;
  styleTag?: StyleTag;
  entityKind?: string;
  entityId?: string;
  bluf?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  dataTiles?: Array<{ label: string; value: string }>;
  sourceContext?: VisualBriefSourceContext;
  actorEmail?: string | null;
}

export interface GeneratedMediaMarker {
  ok: boolean;
  __generated_media: true;
  mediaKind: 'image' | 'video';
  generatedMediaId?: string;
  status?: 'pending' | 'ready' | 'failed' | 'published';
  pollUrl?: string;
  blobUrl?: string | null;
  styleTag?: string;
  providerJobId?: string;
  providerStatus?: string;
  errorMessage?: string;
  dedup?: boolean;
  error?: string;
  detail?: string;
  instruction?: string;
}

interface ExistingRow {
  id: string;
  blob_url: string | null;
  status: 'pending' | 'ready' | 'published' | 'failed';
  style_tag: string;
}

interface InsertedRow {
  id: string;
}

export const GENERATED_IMAGE_PROVIDER = 'openai_gpt_image_2';
export const GENERATED_IMAGE_MODEL_VERSION = 'gpt-image-2-2026-04-21';

function resolveMessageTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return Date.now();
}

function severityForLegacyColumn(
  severity: VisualBriefSeverity,
): 'critical' | 'high' | 'medium' | 'low' | undefined {
  return severity === 'critical' ||
    severity === 'high' ||
    severity === 'medium' ||
    severity === 'low'
    ? severity
    : undefined;
}

export async function startImageGeneration(
  input: StartImageGenerationInput,
): Promise<GeneratedMediaMarker> {
  requireCapability('media');
  const messageContent = input.messageContent.trim();
  if (!messageContent) {
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'image',
      error: 'messageContent is required',
    };
  }

  const spendCheck = await checkOutboundVisualSpend();
  if (!spendCheck.allowed) {
    void recordAudit({
      action: AUDIT_ACTIONS.OUTBOUND_VISUAL_BLOCKED_COST,
      outcome: 'denied',
      actorId: input.actorEmail ?? 'agent:tool:generate_image',
      targetKind: 'generated_media',
      details: {
        estimatedSpend24hUsd: spendCheck.estimatedSpend24hUsd,
        hardCapUsd: spendCheck.hardCapUsd,
        reason: spendCheck.reason,
      },
    }).catch((err: unknown) => console.error('[generate-image] audit BLOCKED_COST failed:', err));

    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'image',
      error: 'visual_spend_cap_exceeded',
      detail: `Daily visual spend hard cap of $${spendCheck.hardCapUsd} reached.`,
    };
  }

  const sourceContext = normalizeSourceContext(input.sourceContext);
  const visualBrief = await buildVisualBrief({
    messageContent,
    sourceContext,
    entityKind: input.entityKind,
    entityId: input.entityId,
    severity: input.severity,
    dataTiles: input.dataTiles,
    bluf: input.bluf,
  });
  const finalStyleTag = resolveVisualStyleTag(visualBrief, input.styleTag);
  const messageHash = createHash('sha256')
    .update(
      JSON.stringify({
        ownerEmail: input.actorEmail,
        schemaVersion: VISUAL_BRIEF_SCHEMA_VERSION,
        styleTag: finalStyleTag,
        messageContent,
        sourceContext,
      }),
    )
    .digest('hex');

  const existingResult = await query<ExistingRow>(
    `SELECT id::text, blob_url, status, style_tag
       FROM aegis_generated_media
       WHERE source_agent_message_hash = $1
         AND style_tag = $2
         AND media_kind = 'image'
         AND status IN ('pending', 'ready', 'published')
       ORDER BY id DESC
       LIMIT 1`,
    [messageHash, finalStyleTag],
  );

  const existingRow = existingResult.rows[0];
  if (existingRow) {
    return {
      ok: true,
      __generated_media: true,
      mediaKind: 'image',
      generatedMediaId: existingRow.id,
      status: existingRow.status,
      blobUrl: existingRow.blob_url
        ? `/api/outbound/generated-media/${existingRow.id}/content`
        : null,
      styleTag: existingRow.style_tag,
      pollUrl: `/api/outbound/generated-media/${existingRow.id}`,
      dedup: true,
      instruction:
        existingRow.status === 'ready' || existingRow.status === 'published'
          ? 'Image is ready. Mention that the generated image is attached below the response.'
          : 'Image generation is already running. Tell the user the image is being generated and will attach when ready.',
    };
  }

  const now = new Date().toISOString();
  const messageTimestamp = resolveMessageTimestamp(input.messageTimestamp);
  const insertResult = await query<InsertedRow>(
    `INSERT INTO aegis_generated_media (
         entity_kind,
         entity_id,
         media_kind,
         style_tag,
         provider,
         model_version,
         status,
         source_agent_message_ts,
         source_agent_message_hash,
         visual_schema_version,
         visual_payload,
         source_context, owner_email
       ) VALUES (
         $1, $2, 'image', $3, $4, $5, 'pending', $6, $7, $8, $9::jsonb, $10::jsonb, $11
       )
       RETURNING id::text`,
    [
      visualBrief.entityKind ?? input.entityKind ?? null,
      visualBrief.entityId ?? input.entityId ?? null,
      finalStyleTag,
      GENERATED_IMAGE_PROVIDER,
      GENERATED_IMAGE_MODEL_VERSION,
      messageTimestamp,
      messageHash,
      visualBrief.schemaVersion,
      JSON.stringify(visualBrief),
      JSON.stringify(sourceContext ?? null),
      input.actorEmail ?? null,
    ],
  );

  const insertedRow = insertResult.rows[0];
  if (!insertedRow) {
    return {
      ok: false,
      __generated_media: true,
      mediaKind: 'image',
      error: 'db_insert_failed',
    };
  }

  const generatedMediaId = insertedRow.id;
  void generateInfographic({
    generatedMediaId,
    styleTag: finalStyleTag,
    visualBrief,
    sourceContext,
    entityKind: visualBrief.entityKind ?? input.entityKind,
    entityId: visualBrief.entityId ?? input.entityId,
    severity: severityForLegacyColumn(visualBrief.severity) ?? input.severity,
    generatedAt: now,
  }).catch((err: unknown) =>
    console.error(
      '[generate-image] background generation failed for id',
      generatedMediaId,
      ':',
      err,
    ),
  );

  return {
    ok: true,
    __generated_media: true,
    mediaKind: 'image',
    generatedMediaId,
    status: 'pending',
    styleTag: finalStyleTag,
    pollUrl: `/api/outbound/generated-media/${generatedMediaId}`,
    instruction:
      'Image generation has started. Tell the user the image is being generated and will attach when ready.',
  };
}
