import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { query } from '@/lib/db/client';
import { createPendingAttachment } from '@/lib/db/queries/attachments';

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
