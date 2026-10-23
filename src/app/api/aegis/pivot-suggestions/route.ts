import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 10.1 — Pivot Suggestions API.
 *
 * IntelCard's co-investigator surface. POST { kind, entityId } returns up
 * to 3 deterministic + 1 Haiku-augmented "next pivot" suggestions for the
 * given AEGIS entity.
 *
 * Two-tier generation pipeline:
 *
 *   1. Templated tier — runs ALWAYS. Pure-function SQL row → 3 pivots.
 *      Sub-500ms p95. The IntelCard treats this as the floor.
 *
 *   2. Haiku augmentation — runs ONLY when the entity is high-relevance
 *      (threat_actor composite_score > 80, cve cvss_v3_score > 9.0).
 *      Fires with a 1500ms wall-clock budget; if it returns in time, it
 *      replaces the lowest-rank template. If it misses, dropped silently.
 *
 * Cache + rate-limit story:
 *   - Cache key `pivots:{kind}:{entityId}` TTL 1h
 *   - Rate-limit `haiku_pivots` budget = 5/min (Haiku tier only)
 *   - Templated tier has no rate limit — pure SQL row read
 *
 * Error policy — ALWAYS returns 200 with `suggestions: []` on failure so
 * the IntelCard can render without pivots rather than 500. Validation
 * failures (bad kind, missing entityId) DO return 400 because they're
 * client bugs the IntelCard wiring would catch in development.
 */

import { NextResponse } from 'next/server';
import { generateHaikuPivot } from '@/lib/aegis/pivot-haiku';
import {
  buildEntitySourceUrl,
  buildTemplatedPivots,
  isPivotKind,
  loadEntityRow,
  type PivotEntityRow,
  type PivotKind,
  type PivotSuggestion,
} from '@/lib/aegis/pivot-templates';
import { checkRateLimit, getCached, setCache } from '@/lib/data/rate-limiter';

interface PivotRequestBody {
  kind: unknown;
  entityId: unknown;
}

interface PivotResponse {
  ok: boolean;
  sourceUrl: string | null;
  suggestions: PivotSuggestion[];
  generatedAt: string;
}

async function routePOSTImplementation(request: Request) {
  let body: PivotRequestBody;
  try {
    body = (await request.json()) as PivotRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { kind, entityId } = body;

  if (!isPivotKind(kind)) {
    return NextResponse.json(
      { error: 'kind must be one of: threat_actor, cve, victim, campaign' },
      { status: 400 },
    );
  }
  if (typeof entityId !== 'string' || entityId.length === 0 || entityId.length > 200) {
    return NextResponse.json(
      { error: 'entityId must be a non-empty string ≤ 200 chars' },
      { status: 400 },
    );
  }

  const cacheKey = `pivots:${kind}:${entityId}`;
  const cached = await getCached<PivotResponse>(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  // Fail-soft envelope from here on.
  try {
    const entity = await loadEntityRow(kind, entityId);
    if (!entity) {
      // No row in DB — return empty so the IntelCard hides the pivots
      // section gracefully. Cache the empty response for 5 min so we don't
      // re-hit the DB on every hover of a nonexistent entity.
      const empty: PivotResponse = {
        ok: true,
        sourceUrl: null,
        suggestions: [],
        generatedAt: new Date().toISOString(),
      };
      await setCache(cacheKey, empty, 300);
      return NextResponse.json(empty);
    }

    const templates = buildTemplatedPivots(entity);
    const suggestions = await maybeAppendHaiku(entity, templates);

    const result: PivotResponse = {
      ok: true,
      sourceUrl: buildEntitySourceUrl(kind, entityId),
      suggestions,
      generatedAt: new Date().toISOString(),
    };
    await setCache(cacheKey, result, 3_600);
    return NextResponse.json(result);
  } catch {
    // Any failure — return empty pivots, IntelCard hides silently.
    return NextResponse.json<PivotResponse>({
      ok: true,
      sourceUrl: buildEntitySourceUrl(kind, entityId),
      suggestions: [],
      generatedAt: new Date().toISOString(),
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Decide whether to fire the Haiku tier. The thresholds match PRD §10.1:
 *
 *   threat_actor: composite_score > 80
 *   cve:          cvss_v3_score > 9.0
 *   victim:       always skip (templates already exhaust the useful pivots)
 *   campaign:     always skip
 *
 * Rate-limit fallback: if the budget is spent, skip Haiku entirely rather
 * than waiting. Templates already give the user 3 chips; Haiku is icing.
 */
async function maybeAppendHaiku(
  entity: PivotEntityRow,
  templates: PivotSuggestion[],
): Promise<PivotSuggestion[]> {
  if (!shouldFireHaiku(entity)) return templates;
  if (!checkRateLimit('haiku_pivots')) return templates;

  const haiku = await generateHaikuPivot(entity, templates);
  if (!haiku) return templates;

  // Drop the lowest-ranked template and append the Haiku pivot. We keep
  // the displayed total at 3 so the IntelCard UI never has to scroll or
  // re-layout for a 4th chip.
  const kept = templates.slice(0, Math.max(0, templates.length - 1));
  return [...kept, { ...haiku, rank: kept.length }];
}

function shouldFireHaiku(entity: PivotEntityRow): boolean {
  switch (entity.kind) {
    case 'threat_actor':
      return (entity.data.composite_score ?? 0) > 80;
    case 'cve':
      return (entity.data.cvss_v3_score ?? 0) > 9.0;
    case 'victim':
    case 'campaign':
      return false;
  }
}

// Re-export the type so panel-side hooks can consume the response shape
// without importing the route module directly.
export type { PivotKind, PivotResponse, PivotSuggestion };

export const POST = withRoutePolicy('/api/aegis/pivot-suggestions', routePOSTImplementation);
