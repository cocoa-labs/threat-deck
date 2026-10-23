import { describe, expect, it } from 'vitest';
import {
  detectAttachmentKind,
  MAX_ATTACHMENT_BYTES,
  safeAttachmentPath,
  sanitizeFilename,
  validateAttachmentInput,
} from './validation';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('attachment validation', () => {
  it('detects supported file kinds by MIME type', () => {
    expect(detectAttachmentKind('photo.png', 'image/png')).toBe('image');
    expect(detectAttachmentKind('brief.pdf', 'application/pdf')).toBe('pdf');
    expect(
      detectAttachmentKind(
        'report.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('docx');
    expect(
      detectAttachmentKind(
        'workbook.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('spreadsheet');
    expect(detectAttachmentKind('notes.md', 'text/markdown')).toBe('text');
  });

  it('falls back to filename extension when browser MIME type is empty', () => {
    expect(detectAttachmentKind('table.csv', '')).toBe('spreadsheet');
    expect(detectAttachmentKind('evidence.json', 'application/octet-stream')).toBe('text');
  });

  it('rejects unsupported, oversized, and invalid-id uploads', () => {
    expect(
      validateAttachmentInput({
        id: UUID,
        filename: 'payload.exe',
        contentType: 'application/x-msdownload',
        sizeBytes: 20,
      }),
    ).toEqual({ ok: false, error: 'unsupported_file_type' });

    expect(
      validateAttachmentInput({
        id: UUID,
        filename: 'big.pdf',
        contentType: 'application/pdf',
        sizeBytes: MAX_ATTACHMENT_BYTES + 1,
      }),
    ).toEqual({ ok: false, error: 'file_exceeds_32mb_cap' });

    expect(
      validateAttachmentInput({
        id: 'nope',
        filename: 'brief.pdf',
        contentType: 'application/pdf',
        sizeBytes: 20,
      }),
    ).toEqual({ ok: false, error: 'invalid_attachment_id' });
  });

  it('sanitizes blob paths deterministically', () => {
    expect(sanitizeFilename('../scary file?.pdf')).toBe('.._scary file_.pdf');
    expect(safeAttachmentPath(UUID, '../scary file?.pdf')).toBe(
      `agent-attachments/uploads/${UUID}/.._scary file_.pdf`,
    );
  });
});
