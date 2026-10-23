import { retryAttachmentDeletions } from '../src/lib/agent/attachments/blob-cleanup';
import { db } from '../src/lib/db/client';
async function main() { try { await retryAttachmentDeletions(); } finally { await db.end(); } }
void main().catch(() => { console.error('Attachment cleanup failed; pending jobs remain queued.'); process.exitCode=1; });
