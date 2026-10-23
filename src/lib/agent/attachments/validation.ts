import type { AgentAttachmentKind, AgentAttachmentRow, AgentAttachmentSummary } from './types';

export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ACTIVE_ATTACHMENTS = 10;

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const PDF_MIME_TYPES = ['application/pdf'] as const;
export const DOCX_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const SPREADSHEET_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/tab-separated-values',
] as const;
export const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'application/x-ndjson',
] as const;

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  ...PDF_MIME_TYPES,
  ...DOCX_MIME_TYPES,
  ...SPREADSHEET_MIME_TYPES,
  ...TEXT_MIME_TYPES,
] as const;

const EXTENSION_KIND: Record<string, AgentAttachmentKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  csv: 'spreadsheet',
  tsv: 'spreadsheet',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  json: 'text',
  ndjson: 'text',
};

const DEFAULT_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  ndjson: 'application/x-ndjson',
};

export function normalizeContentType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export function extensionOf(filename: string): string {
  const clean = filename.toLowerCase().split('?')[0] ?? filename.toLowerCase();
  const index = clean.lastIndexOf('.');
  if (index === -1) return '';
  return clean.slice(index + 1);
}

export function inferContentType(filename: string, contentType: string | null | undefined): string {
  const normalized = normalizeContentType(contentType);
  if (normalized && normalized !== 'application/octet-stream') return normalized;
  const ext = extensionOf(filename);
  return DEFAULT_CONTENT_TYPE_BY_EXTENSION[ext] ?? normalized ?? 'application/octet-stream';
}

export function detectAttachmentKind(
  filename: string,
  contentType: string | null | undefined,
): AgentAttachmentKind | null {
  const type = normalizeContentType(contentType);
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(type)) return 'image';
  if ((PDF_MIME_TYPES as readonly string[]).includes(type)) return 'pdf';
  if ((DOCX_MIME_TYPES as readonly string[]).includes(type)) return 'docx';
  if ((SPREADSHEET_MIME_TYPES as readonly string[]).includes(type)) return 'spreadsheet';
  if ((TEXT_MIME_TYPES as readonly string[]).includes(type)) return 'text';
  return EXTENSION_KIND[extensionOf(filename)] ?? null;
}

export function sanitizeFilename(filename: string): string {
  const clean = filename
    .normalize('NFKD')
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return clean.length > 0 ? clean : 'attachment';
}

export function safeAttachmentPath(id: string, filename: string): string {
  return `agent-attachments/uploads/${id}/${sanitizeFilename(filename)}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateAttachmentInput(params: {
  id?: string;
  filename: string;
  contentType?: string | null;
  sizeBytes: number;
}):
  | { ok: true; kind: AgentAttachmentKind; contentType: string; filename: string }
  | { ok: false; error: string } {
  if (params.id !== undefined && !isUuid(params.id))
    return { ok: false, error: 'invalid_attachment_id' };
  if (!Number.isFinite(params.sizeBytes) || params.sizeBytes < 0) {
    return { ok: false, error: 'invalid_size' };
  }
  if (params.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'file_exceeds_32mb_cap' };
  }

  const filename = sanitizeFilename(params.filename);
  const contentType = inferContentType(filename, params.contentType);
  const kind = detectAttachmentKind(filename, contentType);
  if (!kind) return { ok: false, error: 'unsupported_file_type' };
  const extensionKind = EXTENSION_KIND[extensionOf(filename)];
  if (extensionKind && extensionKind !== kind) return { ok: false, error: 'file_type_mismatch' };
  if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(contentType))
    return { ok: false, error: 'unsupported_file_type' };

  return { ok: true, kind, contentType, filename };
}

export function toAttachmentSummary(row: AgentAttachmentRow): AgentAttachmentSummary {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    kind: row.kind,
    status: row.status,
    ...(row.blob_url ? { blobUrl: row.blob_url } : {}),
    ...(row.model_url ? { modelUrl: row.model_url } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
