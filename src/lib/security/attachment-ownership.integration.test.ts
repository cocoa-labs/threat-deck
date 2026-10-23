import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { retryAttachmentDeletions } from '@/lib/agent/attachments/blob-cleanup';
import { query } from '@/lib/db/client';

import {
  claimAttachmentDeletions,
  pendingAttachmentDeletions,
} from '@/lib/db/queries/attachment-deletions';
import {
  completeAttachmentProcessing,
  createPendingAttachment,
  getAttachmentForOwner,
  markAttachmentProcessing,
  markAttachmentUploaded,
  softDeleteAttachmentForOwner,
} from '@/lib/db/queries/attachments';
import { deleteVisualBlob } from '@/lib/storage/vercel-blob';

vi.mock('@/lib/storage/vercel-blob', () => ({ deleteVisualBlob: vi.fn() }));
const owner = 'attachment-test@example.org';
const other = 'attachment-other@example.org';
const params = (id = randomUUID(), ownerEmail = owner) => ({
  id,
  ownerEmail,
  filename: 'example.txt',
  contentType: 'text/plain',
  sizeBytes: 4,
  kind: 'text' as const,
});
afterEach(async () => {
  vi.mocked(deleteVisualBlob).mockReset();
  await query('DELETE FROM attachment_file_deletions WHERE owner_email=ANY($1::text[])', [
    [owner, other],
  ]);
  await query('DELETE FROM agent_attachments WHERE owner_email=ANY($1::text[])', [[owner, other]]);
});
it('cannot claim another operator’s attachment ID or its stored private path', async () => {
  const id = randomUUID();
  await createPendingAttachment(params(id));
  await expect(createPendingAttachment(params(id, other))).rejects.toThrow(
    'attachment_id_already_used',
  );
  const result = await query<{ owner_email: string }>(
    'SELECT owner_email FROM agent_attachments WHERE id=$1',
    [id],
  );
  expect(result.rows[0]?.owner_email).toBe(owner);
});
it('enforces the active-attachment cap under concurrent upload-token requests', async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 14 }, () => createPendingAttachment(params())),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
});

async function readyFile() {
  const file = await createPendingAttachment(params());
  await markAttachmentUploaded({
    id: file.id,
    ownerEmail: owner,
    blobUrl: 'https://fixture.private.blob.vercel-storage.com/example.txt',
    blobPathname: `agent-attachments/uploads/${file.id}/example.txt`,
  });
  await markAttachmentProcessing({ id: file.id, ownerEmail: owner });
  await completeAttachmentProcessing({
    id: file.id,
    ownerEmail: owner,
    parsedText: 'private extracted text',
    summary: 'private summary',
  });
  await query("UPDATE agent_attachments SET created_at=NOW()-interval '1 day' WHERE id=$1", [
    file.id,
  ]);
  return file;
}
it('revokes access and scrubs extracted content transactionally, while keeping failed storage cleanup retryable', async () => {
  const file = await readyFile();
  expect(await softDeleteAttachmentForOwner({ id: file.id, ownerEmail: other })).toBeNull();
  await softDeleteAttachmentForOwner({ id: file.id, ownerEmail: owner });
  expect(await getAttachmentForOwner({ id: file.id, ownerEmail: owner })).toBeNull();
  const row = (
    await query<{ parsed_text: string | null; filename: string }>(
      'SELECT * FROM agent_attachments WHERE id=$1',
      [file.id],
    )
  ).rows[0];
  expect(row).toMatchObject({ parsed_text: null, filename: 'Deleted attachment' });
  vi.mocked(deleteVisualBlob).mockRejectedValueOnce(new Error('storage outage'));
  await retryAttachmentDeletions(owner);
  expect(await pendingAttachmentDeletions(owner, file.id)).toBe(1);
  expect(await pendingAttachmentDeletions(other, file.id)).toBe(0);
  await query('UPDATE attachment_file_deletions SET next_attempt_at=NOW() WHERE attachment_id=$1', [
    file.id,
  ]);
  vi.mocked(deleteVisualBlob).mockResolvedValue(undefined);
  await retryAttachmentDeletions(owner);
  expect(await pendingAttachmentDeletions(owner, file.id)).toBe(0);
});
it('does not double-claim deletion jobs across concurrent workers', async () => {
  const file = await readyFile();
  await softDeleteAttachmentForOwner({ id: file.id, ownerEmail: owner });
  const jobs = await Promise.all([
    claimAttachmentDeletions(owner),
    claimAttachmentDeletions(owner),
  ]);
  expect(jobs.flat()).toHaveLength(1);
});
it('keeps late upload and preview completions inaccessible and queued for deletion', async () => {
  const file = await createPendingAttachment(params());
  await softDeleteAttachmentForOwner({ id: file.id, ownerEmail: owner });
  expect(
    await markAttachmentUploaded({
      id: file.id,
      ownerEmail: owner,
      blobUrl: 'https://fixture.private.blob.vercel-storage.com/example.txt',
      blobPathname: `agent-attachments/uploads/${file.id}/example.txt`,
    }),
  ).toBeNull();
  expect(
    await completeAttachmentProcessing({
      id: file.id,
      ownerEmail: owner,
      parsedText: 'must not return',
      modelBlob: {
        url: 'https://fixture.private.blob.vercel-storage.com/preview.jpg',
        pathname: `agent-attachments/previews/${file.id}.jpg`,
        contentType: 'image/jpeg',
        size: 1,
      },
    }),
  ).toBeNull();
  expect(await getAttachmentForOwner({ id: file.id, ownerEmail: owner })).toBeNull();
  expect(await pendingAttachmentDeletions(owner, file.id)).toBe(2);
  // An outstanding upload grant can still create bytes; do not report final deletion yet.
  expect(await claimAttachmentDeletions(owner)).toHaveLength(0);
});
