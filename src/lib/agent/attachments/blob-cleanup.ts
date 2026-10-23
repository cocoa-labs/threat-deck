import { deleteVisualBlob } from '@/lib/storage/vercel-blob';
import type { AgentAttachmentRow } from './types';

export async function deleteAttachmentBlobs(row: AgentAttachmentRow): Promise<void> {
  const pathnames = [row.blob_pathname, row.model_pathname].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  await Promise.allSettled(pathnames.map((pathname) => deleteVisualBlob(pathname)));
}
