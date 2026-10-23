import { timingSafeEqual } from 'node:crypto';

export function matchesSecret(provided: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || !provided || provided.length > 4096) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hasCronSecret(request: Request): boolean {
  const authorization = request.headers.get('authorization');
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  return (
    matchesSecret(bearer, process.env.CRON_SECRET) ||
    matchesSecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)
  );
}
