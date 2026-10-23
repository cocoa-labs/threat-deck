import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isEmailAllowed } from '@/lib/auth/allowlist';
import { redis } from '@/lib/redis/client';
import { applicationOrigin } from '@/lib/security/origin';

function key(): string {
  const secret = process.env.WS_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('ws_auth_not_configured');
  return secret;
}

export async function issueWSTicket(email: string): Promise<string> {
  if (!isEmailAllowed(email)) throw new Error('unauthorized');
  const origin = applicationOrigin();
  if (!origin) throw new Error('origin_not_configured');
  const jti = randomUUID();
  const payload = Buffer.from(
    JSON.stringify({ email, origin, jti, exp: Date.now() + 60_000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', key()).update(payload).digest('base64url');
  await redis.set(`ws-ticket:${jti}`, 'unused', 'EX', 60, 'NX');
  return `${payload}.${signature}`;
}

/** HMAC authenticates the separate relay; GETDEL prevents replay across replicas. */
export async function consumeWSTicket(ticket: string, origin: string): Promise<string | null> {
  try {
    if (ticket.length > 2048) return null;
    const [payload, signature, extra] = ticket.split('.');
    if (!payload || !signature || extra) return null;
    const expected = createHmac('sha256', key()).update(payload).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data !== 'object') return null;
    const { email, exp, jti, origin: issuedOrigin } = data as Record<string, unknown>;
    if (
      typeof email !== 'string' ||
      !isEmailAllowed(email) ||
      typeof exp !== 'number' ||
      exp <= Date.now() ||
      exp > Date.now() + 60_000 ||
      issuedOrigin !== origin ||
      origin !== applicationOrigin() ||
      typeof jti !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(jti)
    )
      return null;
    return (await redis.getdel(`ws-ticket:${jti}`)) === 'unused' ? email : null;
  } catch {
    return null;
  }
}
