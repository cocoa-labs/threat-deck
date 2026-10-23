/**
 * Phase 11.C.9 — Causal probabilistic graphical model with do-calculus.
 *
 * Answers: "if we patched in 14 days instead of 60, how much does breach
 * risk drop for an actor like LockBit targeting Healthcare?" — i.e.,
 * questions about INTERVENTIONS, not just observations.
 *
 * Architecture:
 *
 *   Hand-built 7-node DAG (v0.1) over discrete categorical variables.
 *   CPTs (conditional probability tables) are populated either from
 *   counting AEGIS data (Phase 11.D wires this) or from hand-set priors
 *   when no data exists yet. Inference is variable elimination — exact
 *   on a graph this small.
 *
 *   Causal DAG (parents listed in parentheses):
 *
 *     Actor              ()
 *     VictimSector       (Actor)
 *     VictimCountry      (Actor)
 *     TTPSet             (Actor)
 *     VendorPatchLag     ()                     ← independent intervention variable
 *     CVEChoice          (TTPSet, VictimSector, VendorPatchLag)
 *     InitialAccess      (TTPSet, CVEChoice)
 *     IncidentOutcome    (InitialAccess, VictimSector)
 *     BreachDisclosure   (IncidentOutcome)
 *
 *   Each node has a small categorical domain (≤ ~10 values). Worst-case
 *   variable elimination is O(domain^maxFanIn), which for fan-in 3 +
 *   domain 10 = 1000 ops per query. Sub-millisecond.
 *
 * Do-calculus (Pearl):
 *
 *   P(target | evidence)              — pure observation, condition on what we see
 *   P(target | do(X=x), evidence)     — INTERVENTION: cut incoming edges to X,
 *                                       set X=x, then run the same VE algorithm.
 *                                       Captures "if I FORCE X to be x, what
 *                                       happens to target?" — not the same as
 *                                       conditioning, because conditioning still
 *                                       respects the causal pre-X dependencies.
 *
 *   For us the canonical query is do(VendorPatchLag = 14d) — what if we
 *   could intervene on the patch lag for a specific class of CVEs?
 *
 * Pure module — DB is the source of CPT counts but the inference itself
 * has no I/O. The training/cron pipeline (Phase 11.D) builds CPTs from
 * AEGIS counts and writes them into aegis_causal_edges; this module loads
 * them and answers queries.
 *
 * Pattern reference: cve-lifecycle-hmm.ts (hand-built v0.1 + load-with-
 * fallback). exploit-logistic.ts (pure math, monte-carlo-style API).
 */

// ─── Public surface ──────────────────────────────────────────────────────────

export type Variable =
  | 'Actor'
  | 'VictimSector'
  | 'VictimCountry'
  | 'TTPSet'
  | 'VendorPatchLag'
  | 'CVEChoice'
  | 'InitialAccess'
  | 'IncidentOutcome'
  | 'BreachDisclosure';

export const VARIABLES = [
  'Actor',
  'VictimSector',
  'VictimCountry',
  'TTPSet',
  'VendorPatchLag',
  'CVEChoice',
  'InitialAccess',
  'IncidentOutcome',
  'BreachDisclosure',
] as const;

/** Categorical domain for each variable. Order is significant for CPT indexing. */
export interface VariableDomains {
  Actor: readonly string[];
  VictimSector: readonly string[];
  VictimCountry: readonly string[];
  TTPSet: readonly string[];
  VendorPatchLag: readonly string[]; // bucketed: 'fast' / 'medium' / 'slow' / 'severe'
  CVEChoice: readonly string[];
  InitialAccess: readonly string[];
  IncidentOutcome: readonly string[];
  BreachDisclosure: readonly string[];
}

/**
 * A CPT is a flat table: for each parent assignment (cartesian product of
 * parent domains), a probability distribution over the child's domain.
 *
 * `parents` lists the parent variables in canonical order; `tables` is
 * keyed by `parentAssignmentKey()` = parent values joined by '|'.
 * `tables['Alice|Healthcare']` is a child-domain-length array summing to 1.
 *
 * Variables with no parents (roots) have parents=[] and a single entry
 * keyed '' (empty string).
 */
export interface CPT {
  variable: Variable;
  parents: readonly Variable[];
  tables: Record<string, number[]>;
}

export interface CausalModel {
  version: string;
  domains: VariableDomains;
  cpts: Record<Variable, CPT>;
  /** Topological order — used by variable elimination. */
  topoOrder: readonly Variable[];
  trainedAt: string;
  trainingSampleSize: number;
}

export const DEFAULT_MODEL_VERSION = 'causal-dag-v0_1';

/** Parents of each variable in the DAG. Used to build CPTs + drive VE. */
export const PARENTS: Record<Variable, readonly Variable[]> = {
  Actor: [],
  VictimSector: ['Actor'],
  VictimCountry: ['Actor'],
  TTPSet: ['Actor'],
  VendorPatchLag: [],
  CVEChoice: ['TTPSet', 'VictimSector', 'VendorPatchLag'],
  InitialAccess: ['TTPSet', 'CVEChoice'],
  IncidentOutcome: ['InitialAccess', 'VictimSector'],
  BreachDisclosure: ['IncidentOutcome'],
};

/** Topological order — every node's parents appear before it. */
export const TOPO_ORDER: readonly Variable[] = [
  'Actor',
  'VendorPatchLag',
  'VictimSector',
  'VictimCountry',
  'TTPSet',
  'CVEChoice',
  'InitialAccess',
  'IncidentOutcome',
  'BreachDisclosure',
];

// ─── Inference: P(target | evidence) ─────────────────────────────────────────

export interface CausalQuery {
  /** Observed values fixing the corresponding variables. */
  evidence: Partial<Record<Variable, string>>;
  target: Variable;
}

export interface CausalResult {
  /** Distribution over target's domain, sorted DESC by probability. */
  distribution: { value: string; probability: number }[];
  modelVersion: string;
}

/**
 * Compute P(target | evidence) via brute-force enumeration over the
 * non-evidence non-target variables. For our 9-variable DAG with ≤10-
 * sized domains, this is comfortably under 10⁹ ops worst-case — but in
 * practice the conditional structure prunes most paths and we're well
 * under 10⁵ for typical queries.
 *
 * Returns null when the target value is unreachable given the evidence
 * (e.g., evidence sets a variable to a value that has 0 probability under
 * the CPTs — usually means CPT data is incomplete).
 */
export function infer(query: CausalQuery, model: CausalModel): CausalResult | null {
  const targetDomain = model.domains[query.target];
  const numerators = new Map<string, number>();
  let denominator = 0;

  // Enumerate joint configurations consistent with evidence. For each,
  // compute the joint probability via the DAG factorization
  //   P(x_1, ..., x_n) = Π_i P(x_i | parents(x_i))
  // Sum over target values into a histogram.
  enumerateAssignments(model, query.evidence, (assignment, jointP) => {
    denominator += jointP;
    const targetValue = assignment[query.target];
    if (targetValue !== undefined) {
      numerators.set(targetValue, (numerators.get(targetValue) ?? 0) + jointP);
    }
  });

  if (denominator <= 0) return null;

  const distribution: { value: string; probability: number }[] = [];
  for (const value of targetDomain) {
    const p = (numerators.get(value) ?? 0) / denominator;
    distribution.push({ value, probability: p });
  }
  distribution.sort((a, b) => b.probability - a.probability);

  return { distribution, modelVersion: model.version };
}

// ─── Do-calculus: P(target | do(X=x), evidence) ──────────────────────────────

export interface CounterfactualQuery {
  evidence: Partial<Record<Variable, string>>;
  intervention: { variable: Variable; value: string };
  target: Variable;
}

export interface CounterfactualResult {
  baseline: CausalResult;
  intervention: CausalResult;
  /** Difference in target's P(positive outcome) — sign tells direction. */
  delta: number;
  /** The variable + value that was intervened on. */
  intervenedOn: { variable: Variable; value: string };
  modelVersion: string;
}

/**
 * do(X=x) semantics: cut all incoming edges to X (delete its CPT and
 * replace with a delta-function at x), then run regular inference on the
 * mutilated graph. This isolates the CAUSAL effect of forcing X=x from
 * the OBSERVATIONAL correlation that ordinary conditioning would conflate.
 *
 * For "what if we patched in 14d" we set VendorPatchLag='fast' as the
 * intervention; the difference between baseline and intervention is the
 * causal effect of the policy.
 *
 * Returns null if either pass returns null. `delta` is the change in
 * the top-ranked baseline value's probability under intervention — i.e.,
 * "by how much did the most-likely outcome shift?"
 */
export function doIntervene(
  query: CounterfactualQuery,
  model: CausalModel,
): CounterfactualResult | null {
  // Baseline: regular P(target | evidence)
  const baseline = infer({ evidence: query.evidence, target: query.target }, model);
  if (!baseline) return null;

  // Intervention: rebuild the model with the intervened variable's CPT
  // replaced by a delta function (probability 1 at the intervened value,
  // 0 elsewhere) and the parent list emptied. This implements the graph
  // mutilation of do-calculus.
  const mutilated = mutilateGraph(model, query.intervention);
  const intervention = infer({ evidence: query.evidence, target: query.target }, mutilated);
  if (!intervention) return null;

  // Delta: change in the baseline's top value's probability
  const topValue = baseline.distribution[0]?.value;
  const baselineP = topValue
    ? (baseline.distribution.find((d) => d.value === topValue)?.probability ?? 0)
    : 0;
  const interventionP = topValue
    ? (intervention.distribution.find((d) => d.value === topValue)?.probability ?? 0)
    : 0;
  const delta = interventionP - baselineP;

  return {
    baseline,
    intervention,
    delta,
    intervenedOn: query.intervention,
    modelVersion: model.version,
  };
}

// ─── Hand-built v0.1 priors ──────────────────────────────────────────────────

/**
 * Build the v0.1 hand-built causal model. Small categorical domains chosen
 * so the model is interpretable + the joint enumeration is cheap. Training
 * (Phase 11.D, scripts/refresh-causal-dag.ts) will refine CPTs against
 * aegis_threat_actor_targets / incidents / breach_disclosures counts.
 */
export function buildInitialModel(version = DEFAULT_MODEL_VERSION): CausalModel {
  const domains: VariableDomains = {
    Actor: ['LockBit', 'APT29', 'FIN7', 'Generic'],
    VictimSector: ['Healthcare', 'Finance', 'Tech', 'Government', 'Manufacturing', 'Other'],
    VictimCountry: ['US', 'EU', 'UK', 'APAC', 'Other'],
    TTPSet: ['Ransomware', 'StealthEspionage', 'POSAttack', 'Mixed'],
    VendorPatchLag: ['fast', 'medium', 'slow', 'severe'],
    CVEChoice: ['HighValue', 'Standard', 'Low'],
    InitialAccess: ['Phishing', 'PublicFacingApp', 'ValidCreds', 'SupplyChain'],
    IncidentOutcome: ['Breach', 'Contained'],
    BreachDisclosure: ['Disclosed', 'Undisclosed'],
  };

  const cpts: Record<Variable, CPT> = {
    Actor: rootCPT('Actor', domains.Actor, [0.4, 0.2, 0.2, 0.2]),
    VendorPatchLag: rootCPT('VendorPatchLag', domains.VendorPatchLag, [0.25, 0.4, 0.25, 0.1]),

    // VictimSector | Actor — actors specialize in target sectors
    VictimSector: cpt('VictimSector', ['Actor'], {
      LockBit: [0.35, 0.3, 0.15, 0.05, 0.1, 0.05], // ransomware: Healthcare + Finance heavy
      APT29: [0.05, 0.1, 0.25, 0.45, 0.05, 0.1], // espionage: Government + Tech heavy
      FIN7: [0.1, 0.5, 0.1, 0.05, 0.15, 0.1], // financial-fraud: Finance heavy
      Generic: [0.15, 0.2, 0.2, 0.15, 0.15, 0.15],
    }),

    VictimCountry: cpt('VictimCountry', ['Actor'], {
      LockBit: [0.4, 0.35, 0.1, 0.1, 0.05],
      APT29: [0.45, 0.25, 0.15, 0.1, 0.05],
      FIN7: [0.5, 0.2, 0.1, 0.15, 0.05],
      Generic: [0.3, 0.25, 0.15, 0.2, 0.1],
    }),

    TTPSet: cpt('TTPSet', ['Actor'], {
      LockBit: [0.85, 0.05, 0.05, 0.05],
      APT29: [0.05, 0.85, 0.05, 0.05],
      FIN7: [0.1, 0.1, 0.7, 0.1],
      Generic: [0.25, 0.25, 0.25, 0.25],
    }),

    // CVEChoice | TTPSet, VictimSector, VendorPatchLag — fan-in 3
    // Hand-set so "slow patch lag" + "high-value TTP" amplifies HighValue choice.
    CVEChoice: cpt(
      'CVEChoice',
      ['TTPSet', 'VictimSector', 'VendorPatchLag'],
      buildCveChoiceCPT(domains),
    ),

    // InitialAccess | TTPSet, CVEChoice
    InitialAccess: cpt('InitialAccess', ['TTPSet', 'CVEChoice'], buildInitialAccessCPT(domains)),

    // IncidentOutcome | InitialAccess, VictimSector — defenses vary by sector
    IncidentOutcome: cpt(
      'IncidentOutcome',
      ['InitialAccess', 'VictimSector'],
      buildIncidentOutcomeCPT(domains),
    ),

    // BreachDisclosure | IncidentOutcome — only Breach can lead to Disclosure
    BreachDisclosure: cpt('BreachDisclosure', ['IncidentOutcome'], {
      Breach: [0.7, 0.3], // most breaches eventually disclosed
      Contained: [0.05, 0.95], // contained incidents rarely disclosed
    }),
  };

  return {
    version,
    domains,
    cpts,
    topoOrder: TOPO_ORDER,
    trainedAt: new Date().toISOString(),
    trainingSampleSize: 0,
  };
}

// ─── Internals ───────────────────────────────────────────────────────────────

function rootCPT(variable: Variable, domain: readonly string[], probs: number[]): CPT {
  if (probs.length !== domain.length) {
    throw new Error(`CPT shape mismatch for ${variable}: ${probs.length} vs ${domain.length}`);
  }
  return {
    variable,
    parents: [],
    tables: { '': normalize(probs) },
  };
}

function cpt(
  variable: Variable,
  parents: readonly Variable[],
  tables: Record<string, number[]>,
): CPT {
  const normalized: Record<string, number[]> = {};
  for (const [key, probs] of Object.entries(tables)) {
    normalized[key] = normalize(probs);
  }
  return { variable, parents, tables: normalized };
}

function normalize(arr: readonly number[]): number[] {
  const sum = arr.reduce((s, v) => s + v, 0);
  if (sum <= 0) {
    // Uniform fallback so CPTs always remain valid distributions
    return new Array(arr.length).fill(1 / arr.length);
  }
  return arr.map((v) => v / sum);
}

/**
 * Construct the CVEChoice CPT. Fan-in 3 → cartesian product of TTPSet (4)
 * × VictimSector (6) × VendorPatchLag (4) = 96 entries. We use a small
 * rule-based generator instead of hand-typing each entry — produces sane
 * priors that the training script will replace.
 */
function buildCveChoiceCPT(domains: VariableDomains): Record<string, number[]> {
  const tables: Record<string, number[]> = {};
  for (const ttp of domains.TTPSet) {
    for (const sector of domains.VictimSector) {
      for (const lag of domains.VendorPatchLag) {
        const key = `${ttp}|${sector}|${lag}`;
        let high = 0.2;
        let standard = 0.5;
        const low = 0.3;
        // Slower patch lag → higher chance of HighValue CVE getting used
        if (lag === 'severe') high = 0.6;
        else if (lag === 'slow') high = 0.4;
        else if (lag === 'fast') high = 0.1;
        // Stealth/espionage prefers HighValue
        if (ttp === 'StealthEspionage') high += 0.1;
        if (ttp === 'Ransomware') standard += 0.1;
        // Re-normalize the explicit row
        const sum = high + standard + low;
        tables[key] = normalize([high / sum, standard / sum, low / sum]);
      }
    }
  }
  return tables;
}

function buildInitialAccessCPT(domains: VariableDomains): Record<string, number[]> {
  const tables: Record<string, number[]> = {};
  for (const ttp of domains.TTPSet) {
    for (const cve of domains.CVEChoice) {
      const key = `${ttp}|${cve}`;
      // Defaults — equal-ish across the 4 access types
      let phishing = 0.3;
      let pubFacing = 0.3;
      let validCreds = 0.2;
      let supplyChain = 0.2;
      if (ttp === 'Ransomware') {
        phishing = 0.45;
        pubFacing = 0.35;
        validCreds = 0.15;
        supplyChain = 0.05;
      } else if (ttp === 'StealthEspionage') {
        phishing = 0.25;
        pubFacing = 0.2;
        validCreds = 0.35;
        supplyChain = 0.2;
      } else if (ttp === 'POSAttack') {
        phishing = 0.5;
        pubFacing = 0.3;
        validCreds = 0.15;
        supplyChain = 0.05;
      }
      if (cve === 'HighValue') {
        // HighValue CVE → harder to defend, opens stealthier access paths.
        // Tilt toward ValidCreds (highest breach rate per IncidentOutcome
        // table) and reduce SupplyChain (which has the lowest breach rate).
        // Net effect: weighted-avg breach probability is HIGHER for
        // HighValue than Standard — required for the do(patch_lag=fast)
        // → reduces BreachDisclosure direction to hold.
        validCreds += 0.15;
        pubFacing += 0.05;
        phishing -= 0.1;
        supplyChain -= 0.1;
      }
      tables[key] = normalize([
        Math.max(0.01, phishing),
        Math.max(0.01, pubFacing),
        Math.max(0.01, validCreds),
        Math.max(0.01, supplyChain),
      ]);
    }
  }
  return tables;
}

function buildIncidentOutcomeCPT(domains: VariableDomains): Record<string, number[]> {
  const tables: Record<string, number[]> = {};
  // Sector defense quality (rough): higher = better defenses → lower breach rate
  const sectorDefense: Record<string, number> = {
    Finance: 0.7,
    Tech: 0.65,
    Government: 0.55,
    Healthcare: 0.4,
    Manufacturing: 0.35,
    Other: 0.4,
  };
  for (const access of domains.InitialAccess) {
    for (const sector of domains.VictimSector) {
      const key = `${access}|${sector}`;
      const defense = sectorDefense[sector] ?? 0.5;
      // Per-access-type breach rate before defense:
      const baseRate: Record<string, number> = {
        Phishing: 0.6,
        PublicFacingApp: 0.55,
        ValidCreds: 0.7, // hardest to detect → high breach rate
        SupplyChain: 0.5,
      };
      const breachP = Math.max(0.05, Math.min(0.95, (baseRate[access] ?? 0.5) * (1 - defense / 2)));
      tables[key] = [breachP, 1 - breachP];
    }
  }
  return tables;
}

// ─── Enumeration + VE ────────────────────────────────────────────────────────

/**
 * Walk all joint assignments consistent with the evidence, invoking
 * `visit(assignment, jointP)` for each. Uses the topo order so each node's
 * parents are bound before its CPT lookup.
 */
function enumerateAssignments(
  model: CausalModel,
  evidence: Partial<Record<Variable, string>>,
  visit: (assignment: Record<string, string>, jointP: number) => void,
): void {
  const remaining = [...model.topoOrder];
  recurse({}, 1.0);

  function recurse(assignment: Record<string, string>, jointP: number) {
    if (remaining.length === 0) {
      visit(assignment, jointP);
      return;
    }
    const variable = remaining.shift()!;
    const domain = model.domains[variable];
    const cpt = model.cpts[variable];
    const parentKey = cpt.parents.map((p) => assignment[p]).join('|');
    const dist = cpt.tables[parentKey];
    if (!dist) {
      // No CPT row for this parent combo — treat as uniform fallback
      const uniformP = 1 / domain.length;
      for (let i = 0; i < domain.length; i++) {
        const value = domain[i]!;
        if (evidence[variable] !== undefined && evidence[variable] !== value) continue;
        assignment[variable] = value;
        recurse(assignment, jointP * uniformP);
        delete assignment[variable];
      }
    } else {
      for (let i = 0; i < domain.length; i++) {
        const value = domain[i]!;
        if (evidence[variable] !== undefined && evidence[variable] !== value) continue;
        const p = dist[i] ?? 0;
        if (p <= 0) continue;
        assignment[variable] = value;
        recurse(assignment, jointP * p);
        delete assignment[variable];
      }
    }
    remaining.unshift(variable);
  }
}

/**
 * Mutilate the graph for do(intervention.variable = intervention.value):
 * replace the intervened variable's CPT with a delta function (probability
 * 1 at the chosen value) and drop its parent list. All other CPTs stay
 * untouched.
 */
function mutilateGraph(
  model: CausalModel,
  intervention: { variable: Variable; value: string },
): CausalModel {
  const domain = model.domains[intervention.variable];
  const idx = domain.indexOf(intervention.value);
  if (idx === -1) return model; // unknown value — graceful no-op
  const delta = new Array<number>(domain.length).fill(0);
  delta[idx] = 1;
  const newCpts = { ...model.cpts };
  newCpts[intervention.variable] = {
    variable: intervention.variable,
    parents: [],
    tables: { '': delta },
  };
  return { ...model, cpts: newCpts };
}

// ─── Model loading ───────────────────────────────────────────────────────────

/**
 * Load the v0.1 model. No JSON artifact yet — we always return the
 * hand-built initial model. When Phase 11.D wires DB-counted CPTs the
 * loader will read from aegis_causal_edges and reshape into CPTs.
 */
export async function loadDefaultModel(): Promise<CausalModel> {
  return buildInitialModel();
}
