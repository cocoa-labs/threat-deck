import { isCapabilityEnabled } from '@/lib/security/capabilities';
import type { AgentAttachmentKind } from './types';
import {
  DOCX_MIME_TYPES,
  extensionOf,
  normalizeContentType,
  SPREADSHEET_MIME_TYPES,
} from './validation';

export function isOfficeAttachment(input: {
  kind?: AgentAttachmentKind;
  filename: string;
  contentType?: string | null;
}): boolean {
  return (
    input.kind === 'docx' ||
    input.kind === 'spreadsheet' ||
    [
      'doc',
      'docx',
      'xls',
      'xlsx',
      'xlsm',
      'xlsb',
      'csv',
      'tsv',
      'ppt',
      'pptx',
      'rtf',
      'ods',
      'odt',
    ].includes(extensionOf(input.filename)) ||
    [...DOCX_MIME_TYPES, ...SPREADSHEET_MIME_TYPES].includes(
      normalizeContentType(input.contentType) as (typeof DOCX_MIME_TYPES)[number],
    )
  );
}

/** Checked again at execution time, including files uploaded before a flag change. */
export function requireAttachmentIngestion(input: {
  kind?: AgentAttachmentKind;
  filename: string;
  contentType?: string | null;
}): void {
  if (isOfficeAttachment(input) && !isCapabilityEnabled('officeIngestion')) {
    throw new Error('office_ingestion_disabled');
  }
}
