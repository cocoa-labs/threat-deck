import { withRoutePolicy } from '@/lib/security/route-policy';
/**
 * Phase 11.D — Causal counterfactual (do-calculus) endpoint.
 *
 * POST /api/aegis/predictions/counterfactual
 *   body: { evidence?, intervention: {variable, value}, target }
 *
 * Runs do(intervention.variable = intervention.value) on the v0.1 causal
 * DAG and returns baseline vs intervention distributions + delta.
 *
 * The canonical query: do(VendorPatchLag='fast') → BreachDisclosure to
 * answer "how much does faster patching reduce breach risk?"
 *
 * Variables, values, and target names must match the v0.1 model's
 * domains exactly. Unknown values return 400; the validation logic
 * mirrors the model's domain map so the route fails fast on typos.
 *
 * Caching: none for v0.1. Inference is sub-millisecond; the do-calculus
 * counterfactuals table is for the WEEKLY thread (Phase 11.15) which
 * precomputes a handful of common scenarios.
 */

import { NextResponse } from 'next/server';
import {
  type CausalModel,
  type CounterfactualResult,
  doIntervene,
  loadDefaultModel,
  VARIABLES,
  type Variable,
} from '@/lib/aegis/forecasting/causal-dag';
import { getClientIp, withRateLimit } from '@/lib/security/rate-limit';

interface RequestBody {
  evidence?: Partial<Record<string, string>>;
  intervention: { variable: string; value: string };
  target: string;
}

interface RouteResponse {
  ok: boolean;
  result: CounterfactualResult | null;
  modelVersion: string | null;
  sourceUrl: string | null;
  error?: string;
}

async function handlePost(request: Request): Promise<NextResponse<RouteResponse>> {
  const sourceUrl = '/api/aegis/predictions/counterfactual';
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json<RouteResponse>(
      { ok: false, result: null, modelVersion: null, sourceUrl, error: 'invalid_json' },
      { status: 400 },
    );
  }

  if (!body?.intervention?.variable || !body?.intervention?.value || !body?.target) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        result: null,
        modelVersion: null,
        sourceUrl,
        error: 'missing_required_fields',
      },
      { status: 400 },
    );
  }

  const model = await loadDefaultModel();

  // Validate variable/value names against the model's domain map
  if (!isKnownVariable(body.intervention.variable)) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        result: null,
        modelVersion: model.version,
        sourceUrl,
        error: `unknown_variable: ${body.intervention.variable}`,
      },
      { status: 400 },
    );
  }
  if (!isKnownVariable(body.target)) {
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        result: null,
        modelVersion: model.version,
        sourceUrl,
        error: `unknown_target: ${body.target}`,
      },
      { status: 400 },
    );
  }
  if (!isKnownValue(model, body.intervention.variable, body.intervention.value)) {
    const domain = model.domains[body.intervention.variable as Variable];
    return NextResponse.json<RouteResponse>(
      {
        ok: false,
        result: null,
        modelVersion: model.version,
        sourceUrl,
        error: `unknown_value: ${body.intervention.value} (domain: ${domain.join('|')})`,
      },
      { status: 400 },
    );
  }

  // Validate evidence keys + values (filter out unknowns silently — these
  // are likely from a query string built in a different model version)
  const evidence: Partial<Record<Variable, string>> = {};
  if (body.evidence) {
    for (const [k, v] of Object.entries(body.evidence)) {
      if (typeof v !== 'string') continue;
      if (!isKnownVariable(k)) continue;
      if (!isKnownValue(model, k, v)) continue;
      evidence[k as Variable] = v;
    }
  }

  try {
    const result = doIntervene(
      {
        evidence,
        intervention: {
          variable: body.intervention.variable as Variable,
          value: body.intervention.value,
        },
        target: body.target as Variable,
      },
      model,
    );
    return NextResponse.json<RouteResponse>({
      ok: true,
      result,
      modelVersion: model.version,
      sourceUrl,
    });
  } catch (err) {
    return NextResponse.json<RouteResponse>({
      ok: false,
      result: null,
      modelVersion: model.version,
      sourceUrl,
      error: err instanceof Error ? err.message : 'counterfactual_failed',
    });
  }
}

// ─── Validation helpers ──────────────────────────────────────────────────────

function isKnownVariable(name: string): name is Variable {
  return (VARIABLES as readonly string[]).includes(name);
}

function isKnownValue(model: CausalModel, variable: string, value: string): boolean {
  if (!isKnownVariable(variable)) return false;
  return model.domains[variable].includes(value);
}

// Phase 13 Tier 3 — Per-IP rate-limit. Variable-elimination inference is
// the most expensive prediction route (full DAG enumeration). 20/min/IP.
const routePOSTImplementation = withRateLimit(handlePost, {
  key: (req: Request) => `predictions-counterfactual:${getClientIp(req)}`,
  limit: 20,
  windowMs: 60_000,
});

export const POST = withRoutePolicy(
  '/api/aegis/predictions/counterfactual',
  routePOSTImplementation,
);
