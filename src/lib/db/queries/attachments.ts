import type { AgentAttachmentKind, AgentAttachmentRow } from '@/lib/agent/attachments/types';
import { MAX_ACTIVE_ATTACHMENTS } from '@/lib/agent/attachments/validation';
import { db, query, queryOne } from '../client';

export async function createPendingAttachment(params: {
  id: string;
  ownerEmail: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  kind: AgentAttachmentKind;
}): Promise<AgentAttachmentRow> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `attachment:${params.ownerEmail}`,
    ]);
    const count = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM agent_attachments WHERE owner_email=$1 AND deleted_at IS NULL AND status <> 'deleted'",
      [params.ownerEmail],
    );
    if (Number(count.rows[0]?.count ?? MAX_ACTIVE_ATTACHMENTS) >= MAX_ACTIVE_ATTACHMENTS)
      throw new Error('active_attachment_cap_reached');
    const result = await client.query<AgentAttachmentRow>(
      `INSERT INTO agent_attachments(id,owner_email,filename,content_type,size_bytes,kind,status)
       VALUES($1,$2,$3,$4,$5,$6,'uploading') ON CONFLICT(id) DO NOTHING RETURNING *`,
      [
        params.id,
        params.ownerEmail,
        params.filename,
        params.contentType,
        params.sizeBytes,
        params.kind,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('attachment_id_already_used');
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function countActiveAttachmentsForOwner(ownerEmail: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM agent_attachments
      WHERE owner_email = $1
        AND deleted_at IS NULL
        AND status <> 'deleted'`,
    [ownerEmail],
  );
  return Number(row?.count ?? 0);
}

export async function markAttachmentUploaded(params: {
  id: string;
  ownerEmail: string;
  blobUrl: string;
  blobPathname: string;
  contentType?: string;
  sizeBytes?: number;
}): Promise<AgentAttachmentRow | null> {
  return queryOne<AgentAttachmentRow>(
    `UPDATE agent_attachments SET
       status = CASE WHEN status = 'processing' OR status = 'ready' THEN status ELSE 'uploaded' END,
       blob_url = $3,
       blob_pathname = $4,
       content_type = COALESCE($5, content_type),
       size_bytes = COALESCE($6, size_bytes),
       error_message = NULL
     WHERE id = $1
       AND owner_email = $2
       AND deleted_at IS NULL
       AND status <> 'deleted'
     RETURNING *`,
    [
      params.id,
      params.ownerEmail,
      params.blobUrl,
      params.blobPathname,
      params.contentType,
      params.sizeBytes,
    ],
  );
}

export async function getAttachmentForOwner(params: {
  id: string;
  ownerEmail: string;
}): Promise<AgentAttachmentRow | null> {
  return queryOne<AgentAttachmentRow>(
    `SELECT *
       FROM agent_attachments
      WHERE id = $1
        AND owner_email = $2
        AND deleted_at IS NULL
        AND status <> 'deleted'`,
    [params.id, params.ownerEmail],
  );
}

export async function getAttachmentsForOwner(params: {
  ids: string[];
  ownerEmail: string;
}): Promise<AgentAttachmentRow[]> {
  if (params.ids.length === 0) return [];
  const result = await query<AgentAttachmentRow>(
    `SELECT *
       FROM agent_attachments
      WHERE owner_email = $1
        AND id = ANY($2::uuid[])
        AND deleted_at IS NULL
        AND status <> 'deleted'`,
    [params.ownerEmail, params.ids],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  return params.ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

export async function listAttachmentsForOwner(params: {
  ownerEmail: string;
  limit?: number;
}): Promise<AgentAttachmentRow[]> {
  const result = await query<AgentAttachmentRow>(
    `SELECT *
       FROM agent_attachments
      WHERE owner_email = $1
        AND deleted_at IS NULL
        AND status <> 'deleted'
      ORDER BY created_at DESC
      LIMIT $2`,
    [params.ownerEmail, params.limit ?? 50],
  );
  return result.rows;
}

export async function markAttachmentProcessing(params: {
  id: string;
  ownerEmail: string;
}): Promise<AgentAttachmentRow | null> {
  return queryOne<AgentAttachmentRow>(
    `UPDATE agent_attachments SET
       status = 'processing',
       error_message = NULL
     WHERE id = $1
       AND owner_email = $2
       AND deleted_at IS NULL
       AND status IN ('uploading', 'uploaded', 'failed')
     RETURNING *`,
    [params.id, params.ownerEmail],
  );
}

export async function completeAttachmentProcessing(params: {
  id: string;
  ownerEmail: string;
  parsedText?: string;
  summary?: string;
  structured?: Record<string, unknown>;
  sha256?: string;
  modelBlob?: {
    url: string;
    pathname: string;
    contentType: string;
    size: number;
  };
}): Promise<AgentAttachmentRow | null> {
  return queryOne<AgentAttachmentRow>(
    `UPDATE agent_attachments SET
       status = 'ready',
       parsed_text = $3,
       summary = $4,
       structured = COALESCE($5::jsonb, '{}'::jsonb),
       sha256 = $6,
       model_url = $7,
       model_pathname = $8,
       model_content_type = $9,
       model_size_bytes = $10,
       error_message = NULL
     WHERE id = $1
       AND owner_email = $2
       AND deleted_at IS NULL
       AND status <> 'deleted'
     RETURNING *`,
    [
      params.id,
      params.ownerEmail,
      params.parsedText,
      params.summary,
      params.structured ? JSON.stringify(params.structured) : null,
      params.sha256,
      params.modelBlob?.url,
      params.modelBlob?.pathname,
      params.modelBlob?.contentType,
      params.modelBlob?.size,
    ],
  );
}

export async function failAttachmentProcessing(params: {
  id: string;
  ownerEmail: string;
  errorMessage: string;
}): Promise<AgentAttachmentRow | null> {
  return queryOne<AgentAttachmentRow>(
    `UPDATE agent_attachments SET
       status = 'failed',
       error_message = $3
     WHERE id = $1
       AND owner_email = $2
       AND deleted_at IS NULL
       AND status <> 'deleted'
     RETURNING *`,
    [params.id, params.ownerEmail, params.errorMessage.slice(0, 2000)],
  );
}

export async function softDeleteAttachmentForOwner(params: {
  id: string;
  ownerEmail: string;
}): Promise<AgentAttachmentRow | null> {
  return queryOne<AgentAttachmentRow>(
    `UPDATE agent_attachments SET
       status = 'deleted',
       deleted_at = NOW()
     WHERE id = $1
       AND owner_email = $2
       AND deleted_at IS NULL
     RETURNING *`,
    [params.id, params.ownerEmail],
  );
}

export async function softDeleteChatAttachmentsForOwner(
  ownerEmail: string,
): Promise<AgentAttachmentRow[]> {
  const result = await query<AgentAttachmentRow>(
    `UPDATE agent_attachments SET
       status = 'deleted',
       deleted_at = NOW()
     WHERE owner_email = $1
       AND scope = 'chat'
       AND deleted_at IS NULL
     RETURNING *`,
    [ownerEmail],
  );
  return result.rows;
}
