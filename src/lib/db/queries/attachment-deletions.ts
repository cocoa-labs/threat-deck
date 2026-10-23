import { query, queryOne } from '../client';

/** Call only with server-validated original/preview paths, never arbitrary request paths. */
export async function queueAttachmentFileDeletion(params: {
  id: string;
  ownerEmail: string;
  pathname: string;
}): Promise<void> {
  await query(
    `INSERT INTO attachment_file_deletions(pathname,attachment_id,owner_email)
    SELECT $3,id,owner_email FROM agent_attachments WHERE id=$1 AND owner_email=$2
    ON CONFLICT(pathname) DO UPDATE SET next_attempt_at=greatest(NOW(),attachment_file_deletions.not_before), last_error=NULL, attempts=attachment_file_deletions.attempts+1`,
    [params.id, params.ownerEmail, params.pathname],
  );
}
export async function pendingAttachmentDeletions(ownerEmail: string, id?: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM attachment_file_deletions WHERE owner_email=$1 AND ($2::uuid IS NULL OR attachment_id=$2)`,
    [ownerEmail, id ?? null],
  );
  return Number(row?.count ?? 0);
}
export async function claimAttachmentDeletions(ownerEmail?: string) {
  return (
    await query<{ pathname: string; attempts: number }>(
      `WITH due AS (
    SELECT pathname FROM attachment_file_deletions WHERE next_attempt_at<=NOW() AND ($1::text IS NULL OR owner_email=$1)
    ORDER BY next_attempt_at LIMIT 10 FOR UPDATE SKIP LOCKED
  ) UPDATE attachment_file_deletions q SET attempts=q.attempts+1,next_attempt_at=NOW()+interval '2 minutes'
    FROM due WHERE q.pathname=due.pathname RETURNING q.pathname,q.attempts`,
      [ownerEmail ?? null],
    )
  ).rows;
}
export async function completeFileDeletion(pathname: string, attempt: number) {
  await query('DELETE FROM attachment_file_deletions WHERE pathname=$1 AND attempts=$2', [
    pathname,
    attempt,
  ]);
}
export async function failFileDeletion(pathname: string, attempt: number) {
  await query(
    `UPDATE attachment_file_deletions SET last_error='storage_delete_failed',next_attempt_at=NOW()+($3*interval '1 second') WHERE pathname=$1 AND attempts=$2`,
    [pathname, attempt, Math.min(86400, 60 * 2 ** Math.min(attempt, 10))],
  );
}
