export const ATTACHMENT_KINDS = ['image', 'pdf', 'docx', 'spreadsheet', 'text'] as const;
export type AgentAttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_STATUSES = [
  'uploading',
  'uploaded',
  'processing',
  'ready',
  'failed',
  'deleted',
] as const;
export type AgentAttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

export interface AgentAttachmentSummary {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  kind: AgentAttachmentKind;
  status: AgentAttachmentStatus;
  blobUrl?: string;
  modelUrl?: string;
  summary?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentAttachmentRow {
  id: string;
  owner_email: string;
  scope: 'chat';
  filename: string;
  content_type: string;
  size_bytes: number | string;
  kind: AgentAttachmentKind;
  status: AgentAttachmentStatus;
  blob_url: string | null;
  blob_pathname: string | null;
  model_url: string | null;
  model_pathname: string | null;
  model_content_type: string | null;
  model_size_bytes: number | string | null;
  sha256: string | null;
  parsed_text: string | null;
  structured: unknown;
  summary: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AttachmentProcessingResult {
  parsedText?: string;
  summary?: string;
  structured?: Record<string, unknown>;
  modelBlob?: {
    url: string;
    pathname: string;
    contentType: string;
    size: number;
  };
  sha256?: string;
}
