import { afterEach, expect, it, vi } from 'vitest';
import { buildAttachmentContentBlocks } from './context';
import { isOfficeAttachment, requireAttachmentIngestion } from './office-policy';
import { processAgentAttachment } from './parser';
import type { AgentAttachmentRow } from './types';
import { validateAttachmentInput } from './validation';

afterEach(() => vi.unstubAllEnvs());
it('rejects Office ingestion before reading bytes or invoking providers, including old ready uploads', async () => {
  vi.stubEnv('ENABLE_OFFICE_INGESTION', undefined);
  const row = {
    kind: 'docx',
    filename: 'example.docx',
    content_type: 'text/plain',
    status: 'ready',
    parsed_text: 'private',
  } as AgentAttachmentRow;
  await expect(processAgentAttachment(row)).rejects.toThrow('office_ingestion_disabled');
  await expect(buildAttachmentContentBlocks({ task: 'read', attachments: [row] })).rejects.toThrow(
    'office_ingestion_disabled',
  );
});
it('checks extension, MIME and stored kind independently', () => {
  vi.stubEnv('ENABLE_OFFICE_INGESTION', 'false');
  for (const input of [
    { filename: 'sample.xlsx', contentType: 'text/plain' },
    { filename: 'sample.txt', contentType: 'text/csv' },
    { filename: 'sample.txt', kind: 'spreadsheet' as const },
    { filename: 'sample.tsv', contentType: '' },
  ]) {
    expect(isOfficeAttachment(input)).toBe(true);
    expect(() => requireAttachmentIngestion(input)).toThrow('office_ingestion_disabled');
  }
  expect(
    validateAttachmentInput({ filename: 'sample.docx', contentType: 'text/plain', sizeBytes: 2 }),
  ).toMatchObject({ ok: false });
  expect(() =>
    requireAttachmentIngestion({ filename: 'sample.txt', contentType: 'text/plain' }),
  ).not.toThrow();
});
it('only enables the parser with the exact explicit server opt-in', () => {
  vi.stubEnv('ENABLE_OFFICE_INGESTION', '1');
  expect(() => requireAttachmentIngestion({ filename: 'sample.csv' })).toThrow();
  vi.stubEnv('ENABLE_OFFICE_INGESTION', 'true');
  expect(() => requireAttachmentIngestion({ filename: 'sample.csv' })).not.toThrow();
});
