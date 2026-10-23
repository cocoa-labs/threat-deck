import {
  claimAttachmentDeletions,
  completeFileDeletion,
  failFileDeletion,
} from '@/lib/db/queries/attachment-deletions';
import { deleteVisualBlob } from '@/lib/storage/vercel-blob';

/** Bounded, leased, idempotent retries survive process restarts and provider outages. */
export async function retryAttachmentDeletions(ownerEmail?: string): Promise<void> {
  const jobs = await claimAttachmentDeletions(ownerEmail);
  await Promise.all(
    jobs.map(async (job) => {
      try {
        await deleteVisualBlob(job.pathname);
        await completeFileDeletion(job.pathname, job.attempts);
      } catch {
        await failFileDeletion(job.pathname, job.attempts);
      }
    }),
  );
}
