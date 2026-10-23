import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * POST /api/data/ai-relevance
 *
 * Batch-score up to 50 news items via the Phase 9.2 scoring pipeline. Used by
 * the RSS collector and any future ad-hoc scoring callers. Pattern mirrored
 * from src/app/api/data/captions/summarize/route.ts.
 *
 * Request body:
 *   { items: Array<{ url: string; title: string; summary?: string }> }
 *
 * Response:
 *   { results: Array<ScoreResult> }
 */

import { NextResponse } from 'next/server';
import { type ScoreInput, scoreItems } from '@/lib/ai-relevance';

const MAX_BATCH = 50;
const MAX_TITLE = 500;
const MAX_SUMMARY = 4_000;

interface RequestBody {
  items?: unknown;
}

async function routePOSTImplementation(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Without Haiku we can still score via keywords — but we honor the same
    // gate as summarize/route.ts for consistency. Callers should treat 503
    // here the same way: degraded mode, the RSS collector silently skips
    // scoring and returns items without aiRelevance.
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = validateItems(body.items);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const results = await scoreItems(parsed.items);
    return NextResponse.json({ results });
  } catch (err) {
    // scoreItems is fail-soft internally — if we still get here, it's a hard
    // infrastructure error worth surfacing as 500.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'scoring failed' },
      { status: 500 },
    );
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

type ValidationResult = { ok: true; items: ScoreInput[] } | { ok: false; error: string };

function validateItems(raw: unknown): ValidationResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'items must be an array' };
  }
  if (raw.length === 0) {
    return { ok: false, error: 'items must contain at least one element' };
  }
  if (raw.length > MAX_BATCH) {
    return { ok: false, error: `items exceeds max batch size (${MAX_BATCH})` };
  }

  const items: ScoreInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r || typeof r !== 'object') {
      return { ok: false, error: `items[${i}] is not an object` };
    }
    const o = r as Record<string, unknown>;
    if (typeof o.url !== 'string' || o.url.length === 0) {
      return { ok: false, error: `items[${i}].url must be a non-empty string` };
    }
    if (typeof o.title !== 'string' || o.title.length === 0) {
      return { ok: false, error: `items[${i}].title must be a non-empty string` };
    }
    if (o.summary !== undefined && typeof o.summary !== 'string') {
      return { ok: false, error: `items[${i}].summary must be a string if present` };
    }
    items.push({
      url: o.url.slice(0, 2_000),
      title: o.title.slice(0, MAX_TITLE),
      summary: typeof o.summary === 'string' ? o.summary.slice(0, MAX_SUMMARY) : undefined,
    });
  }
  return { ok: true, items };
}

export const POST = withRoutePolicy('/api/data/ai-relevance', routePOSTImplementation);
