import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * GET /api/twitter/status
 *
 * Authenticated operator probe for the response-level POST TO X button.
 * Returns connection metadata only; OAuth token material never leaves the
 * server. Calling getActiveToken() may refresh an expired token before we
 * report `connected`.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { queryOne } from '@/lib/db/client';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';
import {
  getActiveToken,
  getActiveTokenScopes,
  getConfiguredTwitterHandle,
  getMissingTwitterScopes,
  REQUIRED_SCOPES,
} from '@/lib/twitter/oauth';
import { getDefaultDryRun } from '@/lib/twitter/write-client';

export const dynamic = 'force-dynamic';

interface TokenHandleRow {
  handle: string;
}

async function handleGet(_request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let handle: string | null = null;
  let token: string | null = null;
  let missingScopes: string[] = [];

  try {
    const configuredHandle = getConfiguredTwitterHandle();
    const row = await queryOne<TokenHandleRow>(
      `SELECT handle
         FROM cocoa_oauth_tokens
        WHERE provider = 'twitter'
          AND lower(ltrim(handle, '@')) = $1
        ORDER BY id DESC
        LIMIT 1`,
      [configuredHandle],
    );
    handle = row?.handle ?? null;
  } catch (err) {
    console.error('[twitter/status] token metadata lookup failed:', err);
  }

  if (handle) {
    token = await getActiveToken();
    const scopes = await getActiveTokenScopes();
    missingScopes = getMissingTwitterScopes(scopes, REQUIRED_SCOPES);
  }

  return NextResponse.json({
    ok: true,
    connected: Boolean(token),
    handle,
    dryRun: getDefaultDryRun(),
    missingScopes,
  });
}

const routeGETImplementation = withRateLimit(handleGet, {
  key: (req: Request) => `twitter-status:${getClientIp(req)}`,
  limit: 60,
  windowMs: 60_000,
});

export const GET = withRoutePolicy('/api/twitter/status', routeGETImplementation);
