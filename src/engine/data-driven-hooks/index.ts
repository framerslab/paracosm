/**
 * Data-driven scenario hook factory.
 *
 * Every paracosm scenario lives as JSON in `scenarios/*.json` and
 * compiles to runnable hooks through this module. The DSL covers
 * five hook shapes:
 *
 *   - `directorInstructions` — string literal
 *   - `departmentPromptHook` — metric chips + per-agent aggregations
 *     + featured roster lines
 *   - `fingerprintHook` — threshold rules and band classifications
 *     (reads metrics, politics, environment, leader HEXACO, outcome
 *      counts, and tool counts)
 *   - `politicsHook` — per-category success / failure delta tables
 *   - `reactionContextHook` — line-array template with per-agent
 *     conditional branches
 *
 * Two domain-physics shapes can't be expressed as JSON:
 *
 *   - per-agent progression (Mars radiation accumulation, Lunar
 *     regolith atrophy) — declared in JSON via
 *     `progressionPhysics: '<id>'` and resolved against the registry
 *     at `engine/physics`
 *   - narrative-anchor milestones (turn 1 + final turn fixed events)
 *     — declared as a `milestones` array in JSON and synthesized into
 *     `getMilestoneEvent` here
 *
 * Net effect: a scenario.json carries its full hook config as data;
 * the loader compiles it once at module init and the runtime gets
 * the same shape it would from a hand-written wrapper.
 *
 * @module paracosm/engine/data-driven-hooks
 */
import type { Agent, SimulationState } from '../core/state.js';
import type { ActorConfig, MilestoneEventDef, ScenarioHooks } from '../types.js';
import { physicsModules, type ProgressionPhysics } from '../physics/index.js';

/**
 * Per-department row of metric chips that get formatted into the
 * department prompt context. Keys reference metric / capacity / status
 * / politic / environment paths so the factory can reach the right bag
 * inside `SimulationState`.
 *
 * Format flags drive how the value renders:
 *   - 'number' → toFixed(3) for fractions, toFixed(0) for integers
 *   - 'percent' → value * 100 + '%'
 *   - 'string' → as-is
 *
 * The factory composes label + formatted value into a single chip
 * (`AlignmentBench: 0.840`) and joins chips with ` | ` so the dept
 * prompt reads as one wide line instead of a multi-row dump.
 */
export interface DataDrivenChip {
  label: string;
  /** Path under SimulationState — `metrics.alignmentBench`, `politics.boardConfidence`, `environment.competitorCapabilityGap`, `statuses.compactTier`. */
  source: string;
  format: 'number' | 'percent' | 'string';
}

/** Per-department prompt-row spec. */
export interface DataDrivenDepartmentSpec {
  /** Heading printed above the chips: `ALIGNMENT METRICS:`. */
  heading: string;
  /** Chips formatted left-to-right and joined with ` | `. */
  chips: (DataDrivenChip | DataDrivenAggChip)[];
  /** Optional roster-style line listing top-N agents that match
   *  `featuredRoster.filter`, formatted via the per-agent template. */
  featuredRoster?: DataDrivenFeaturedRoster;
  /** Optional trailing line for free-form context. */
  footer?: string;
}

/**
 * Aggregation chip — computes a value over the agent population
 * (filtered, optionally) and renders it like a normal chip. Used for
 * per-dept metrics that aren't on `state.metrics` (e.g., `avg bone
 * density across alive colonists`, `count of marsborn agents`). The
 * `where` predicate filters the agent pool before the aggregation.
 */
export interface DataDrivenAggChip {
  label: string;
  agg: {
    /** Aggregation function — `count` ignores `field`; the rest read
     *  it as a numeric per-agent value (skipping non-numeric). */
    fn: 'avg' | 'sum' | 'count' | 'min' | 'max';
    /** Path within an Agent (e.g., `health.boneDensityPct`,
     *  `health.cumulativeRadiationMsv`, `health.psychScore`).
     *  Required for avg/sum/min/max; omitted for `count`. */
    field?: string;
    /** Optional agent-level predicate filtering the pool. Defaults to
     *  `health.alive == true` — the most common case. */
    where?: JsonAgentPredicateNode;
  };
  format: 'number' | 'percent' | 'string';
}

/**
 * Featured-roster line: pulls the top-N agents matching `filter`
 * (default: alive + featured) and renders each via the `template`
 * with `{{name}}`, `{{age}}`, `{{health.X}}`, `{{core.X}}` etc.
 * substitutions. Output is a header line followed by one line per
 * agent.
 */
export interface DataDrivenFeaturedRoster {
  /** Header line printed above the roster (e.g. `FEATURED:`). */
  header: string;
  /** Predicate filtering the agent pool. Defaults to alive + featured. */
  filter?: JsonAgentPredicateNode;
  /** Max agents to render. */
  limit: number;
  /** Per-agent template with `{{path}}` substitutions. */
  template: string;
}

/**
 * Threshold rule for the fingerprint trichotomy. Each rule is checked
 * in order; the first rule whose `when` predicate returns true wins
 * and its `posture` becomes the `posture` field on the fingerprint.
 *
 * `when` reads from a flattened state view — the factory walks
 * `metrics`, `politics`, `environment` and merges them so a rule can
 * read any field by its leaf name without having to know which bag
 * it lives in.
 */
export interface DataDrivenPostureRule {
  posture: string;
  when: (state: Record<string, number | string | boolean>) => boolean;
}

/**
 * Per-axis fingerprint band. `axes[].when` returns the band label
 * for a given state; the factory writes them into the fingerprint
 * record under their `name`. Used for the 1-2-letter band tags
 * (alignment: high/moderate/degraded; capability: frontier/competitive/lagging).
 */
export interface DataDrivenFingerprintAxis {
  name: string;
  when: (state: Record<string, number | string | boolean>) => string;
}

/** Per-category politics delta. The factory exposes outcome via a
 *  closure (`outcome.endsWith('success')`) so each category entry can
 *  branch on success/failure without needing a function-typed config. */
export interface DataDrivenCategoryPolitics {
  /** Politics deltas applied on a successful outcome. */
  onSuccess?: Record<string, number>;
  /** Politics deltas applied on a failed outcome. Defaults to `onSuccess` negated when omitted is too risky — leave undefined to no-op on failure. */
  onFailure?: Record<string, number>;
}

/**
 * The top-level scenario config consumed by the factory. Lives next
 * to the scenario.json or inline in the wrapper module.
 */
export interface DataDrivenScenarioConfig {
  /** System prompt for the Crisis Director LLM. Should describe the
   *  scenario domain, the categories of crises, and the metrics the
   *  director should anchor crises against. */
  directorInstructions: string;

  /** Per-department prompt context. Keys are department ids matching
   *  scenario.departments[].id; values are the chip specs. Departments
   *  not in this map render the engine's generic chip line. */
  departments: Record<string, DataDrivenDepartmentSpec>;

  /** Posture rules checked top-to-bottom. The first match wins. The
   *  default fallback is `'mixed-posture'` if no rule matches. */
  postureRules: DataDrivenPostureRule[];

  /** Per-axis fingerprint bands rendered into the per-run summary. */
  fingerprintAxes: DataDrivenFingerprintAxis[];

  /** Per-category politics deltas. Categories without an entry no-op. */
  politics: Record<string, DataDrivenCategoryPolitics>;

  /** Per-agent reaction context template. The factory passes the agent
   *  and turn context; the template should anchor the agent voice to
   *  their role + department + the scenario domain. */
  reactionTemplate: (agent: Agent, ctx: { time: number; turn: number }) => string;

  /** Optional ID of a registered progression-physics module (see
   *  `engine/physics`). When set, the factory wires the
   *  module into `progressionHook` so per-agent physics (radiation,
   *  bone decay, etc.) run between turns. Unknown IDs no-op + warn. */
  progressionPhysics?: string;

  /** Optional milestone events anchored to specific turns. The factory
   *  synthesizes a `getMilestoneEvent(turn, maxTurns)` that returns
   *  the matching event for turn 1, the final turn, or any explicit
   *  turn number. */
  milestones?: ResolvedMilestone[];
}

/**
 * A milestone event resolved to a specific turn. `turn` is either a
 * concrete turn number or the literal string `'final'` which the
 * factory expands to `maxTurns` at runtime.
 */
export interface ResolvedMilestone {
  turn: number | 'final';
  event: MilestoneEventDef;
}

/**
 * Resolve a `metrics.alignmentBench` style path against a runtime
 * SimulationState bag. Returns undefined for missing paths so the
 * formatter can fall back to a `?` chip rather than crashing.
 */
function readPath(state: SimulationState, path: string): unknown {
  const [bag, leaf] = path.split('.', 2);
  if (!leaf) return undefined;
  switch (bag) {
    case 'metrics':
      return (state.metrics as Record<string, unknown>)[leaf];
    case 'politics':
      return (state.politics as Record<string, unknown>)[leaf];
    case 'environment':
      return state.environment[leaf];
    case 'statuses':
      return state.statuses[leaf];
    default:
      return undefined;
  }
}

/**
 * Format a chip value according to its declared format flag. Falls
 * back to a `?` chip for missing / non-numeric values where a number
 * was expected so the dept prompt reads cleanly even under partial
 * scenario state.
 */
function formatChip(chip: DataDrivenChip, raw: unknown): string {
  if (chip.format === 'string') {
    return `${chip.label}: ${raw == null ? '?' : String(raw)}`;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return `${chip.label}: ?`;
  }
  if (chip.format === 'percent') {
    return `${chip.label}: ${(raw * 100).toFixed(0)}%`;
  }
  // 'number' — three decimals for sub-1 fractions, plain integer otherwise.
  if (Math.abs(raw) > 0 && Math.abs(raw) < 1) {
    return `${chip.label}: ${raw.toFixed(3)}`;
  }
  return `${chip.label}: ${raw.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
}

/**
 * Build a flat `metric/politic/environment` view of state for posture
 * + fingerprint rules. Each axis can read any field by its leaf name
 * without having to know which bag it lives in. Status fields surface
 * as their string values. Last writer wins on collisions, but in
 * practice scenarios use unique leaf names across bags.
 */
function flattenState(state: SimulationState): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  // Each bag is structurally optional in test fixtures and partial
  // SimulationState mocks; guard each Object.entries against
  // undefined/null so the predicate evaluator stays robust under
  // partial state. The flat record stays empty for any missing bag.
  const bags: Array<Record<string, unknown> | undefined> = [
    state.metrics as Record<string, unknown> | undefined,
    state.politics as Record<string, unknown> | undefined,
    state.environment as Record<string, unknown> | undefined,
    state.statuses as Record<string, unknown> | undefined,
  ];
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object') continue;
    for (const [k, v] of Object.entries(bag)) {
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

// ─── JSON-DSL config shape ────────────────────────────────────────────
//
// Everything below this line is the JSON-only equivalent of the
// function-typed config above. Lets a scenario.json carry its full
// hooks config as data — no sibling TypeScript wrapper needed. The
// loader compiles the DSL into the function-typed config the factory
// already consumes; the function-typed path stays available for any
// caller that wants to embed arbitrary closures.

/** A field reference inside the flattened state. Reads from the
 *  metric / politic / environment / status leaf names. */
export interface FieldRef { field: string }

/** Numeric / string / boolean comparison against a constant. */
export interface JsonPredicate extends FieldRef {
  op: '==' | '!=' | '>=' | '>' | '<=' | '<';
  value: number | string | boolean;
}

/** Logical compound: all sub-predicates must be true. */
export interface JsonAllPredicate { all: JsonPredicateNode[] }
/** Logical compound: any sub-predicate must be true. */
export interface JsonAnyPredicate { any: JsonPredicateNode[] }

export type JsonPredicateNode = JsonPredicate | JsonAllPredicate | JsonAnyPredicate;

/** A posture rule expressed in the JSON DSL. */
export interface JsonPostureRule {
  posture: string;
  when: JsonPredicateNode;
}

/** A fingerprint axis band. First matching band wins. The optional
 *  `default` key flags the fallback band when no `when` matches. */
export interface JsonFingerprintBand {
  label: string;
  when?: JsonPredicateNode;
  default?: boolean;
}

/** A fingerprint axis: name + ordered band list. */
export interface JsonFingerprintAxis {
  name: string;
  bands: JsonFingerprintBand[];
}

/**
 * Agent-level predicate. Reads from a path inside an `Agent` object
 * (e.g., `health.alive`, `core.marsborn`, `health.boneDensityPct`,
 * `narrative.featured`). Same compound shape as `JsonPredicate` but
 * the field bag is the agent itself, not the flattened state.
 */
export interface JsonAgentPredicate {
  agent: string;
  op: '==' | '!=' | '>=' | '>' | '<=' | '<';
  value: number | string | boolean;
}

export interface JsonAgentAllPredicate { all: JsonAgentPredicateNode[] }
export interface JsonAgentAnyPredicate { any: JsonAgentPredicateNode[] }

export type JsonAgentPredicateNode =
  | JsonAgentPredicate
  | JsonAgentAllPredicate
  | JsonAgentAnyPredicate;

/**
 * Reaction template — line array with optional per-line predicates.
 * Each entry's `template` is rendered with `{{role}}`, `{{department}}`,
 * `{{name}}`, `{{age}}`, `{{years}}` (= time - startTime when supplied),
 * plus any `agent.<path>` substitution under a flat key
 * (e.g., `{{health.boneDensityPct}}`).
 *
 * Lines whose `when` predicate evaluates false are skipped. The final
 * output joins surviving lines with `join` (default ` `).
 *
 * The legacy `string` form remains supported for back-compat (e.g.
 * existing atlas-lab / DSC scenarios pass a single template string).
 */
export interface JsonReactionTemplate {
  lines: JsonReactionLine[];
  /** Separator between rendered lines. Defaults to a single space. */
  join?: string;
}

export interface JsonReactionLine {
  template: string;
  when?: JsonAgentPredicateNode;
}

/** A milestone event as carried in JSON. Same shape as
 *  `ResolvedMilestone`, kept as an alias for clarity at the JSON
 *  boundary. */
export type JsonMilestone = ResolvedMilestone;

/** Full JSON-DSL config, equivalent to {@link DataDrivenScenarioConfig}
 *  but with all function values replaced by JSON-shaped DSL.
 *
 * `reactionTemplate` accepts either a plain string (legacy short
 * form, substitutes `{{role}}` and `{{department}}`) or a structured
 * `JsonReactionTemplate` with conditional lines.
 */
export interface JsonDataDrivenScenarioConfig {
  directorInstructions: string;
  departments: Record<string, DataDrivenDepartmentSpec>;
  postureRules: JsonPostureRule[];
  fingerprintAxes: JsonFingerprintAxis[];
  politics: Record<string, DataDrivenCategoryPolitics>;
  reactionTemplate: string | JsonReactionTemplate;
  /** Optional progression-physics module ID. See
   *  {@link DataDrivenScenarioConfig.progressionPhysics}. */
  progressionPhysics?: string;
  /** Optional milestone events (turn 1, final turn, or any
   *  explicit turn number). */
  milestones?: JsonMilestone[];
}

/**
 * Read a dotted `bag.leaf.deeper` path off an arbitrary object. Returns
 * undefined for any missing intermediate. Used by agent predicates,
 * aggregation chips, and roster templates so configs can read deep
 * fields like `health.boneDensityPct` without per-call boilerplate.
 */
function readDeepPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Compile a single agent-level predicate node into a
 * `(agent) => boolean`. Mirrors `compilePredicate` but reads from the
 * agent object via `readDeepPath` so configs can match against any
 * field (`core.marsborn`, `health.alive`, `health.boneDensityPct < 70`,
 * `narrative.featured`).
 */
function compileAgentPredicate(node: JsonAgentPredicateNode): (agent: Agent) => boolean {
  if ('all' in node) {
    const subs = node.all.map(compileAgentPredicate);
    return (agent) => subs.every((s) => s(agent));
  }
  if ('any' in node) {
    const subs = node.any.map(compileAgentPredicate);
    return (agent) => subs.some((s) => s(agent));
  }
  const { agent: path, op, value } = node;
  return (agent) => {
    const left = readDeepPath(agent, path);
    switch (op) {
      case '==': return left === value;
      case '!=': return left !== value;
      case '>=': return Number(left ?? 0) >= Number(value);
      case '>':  return Number(left ?? 0) >  Number(value);
      case '<=': return Number(left ?? 0) <= Number(value);
      case '<':  return Number(left ?? 0) <  Number(value);
      default: return false;
    }
  };
}

/**
 * Evaluate an aggregation chip against the agent population. The
 * `where` predicate filters the pool; the `fn` aggregator either
 * counts the pool (`count`) or reads `field` as a numeric per-agent
 * value (skipping non-numeric) and reduces accordingly.
 */
function evaluateAggChip(
  chip: DataDrivenAggChip,
  agents: readonly Agent[],
): number {
  // Doc'd default: when `where` is omitted, restrict the pool to alive
  // agents — that's the common case for medical / psychology chips and
  // skipping it produces misleading averages once the population starts
  // taking casualties.
  const filter = chip.agg.where
    ? compileAgentPredicate(chip.agg.where)
    : (a: Agent) => Boolean(a.health?.alive);
  const pool = agents.filter(filter);
  if (chip.agg.fn === 'count') return pool.length;

  const field = chip.agg.field;
  if (!field) return 0;
  const values: number[] = [];
  for (const agent of pool) {
    const raw = readDeepPath(agent, field);
    if (typeof raw === 'number' && Number.isFinite(raw)) values.push(raw);
  }
  if (values.length === 0) return 0;
  switch (chip.agg.fn) {
    case 'sum': return values.reduce((a, b) => a + b, 0);
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min': return Math.min(...values);
    case 'max': return Math.max(...values);
    default: return 0;
  }
}

/**
 * Render a featured-roster line. Walks the agent pool, applies the
 * filter (defaulting to alive + featured), sorts (featured first),
 * caps at `limit`, and renders each via the `template` with
 * `{{path}}` substitutions against the agent.
 */
function renderFeaturedRoster(
  spec: DataDrivenFeaturedRoster,
  agents: readonly Agent[],
  state: SimulationState,
): string[] {
  const filter = spec.filter
    ? compileAgentPredicate(spec.filter)
    : (a: Agent) => Boolean(a.health.alive && a.narrative?.featured);
  // Featured-first sort: when a custom filter is supplied that doesn't
  // already restrict to featured, push featured agents to the front so
  // the LLM dept prompt gets the named characters first instead of an
  // unsorted slice. Stable across calls — sort key is just the boolean
  // featured flag, so non-featured order matches scenario.agents order.
  const filtered = agents
    .filter(filter)
    .slice()
    .sort((a, b) => Number(Boolean(b.narrative?.featured)) - Number(Boolean(a.narrative?.featured)))
    .slice(0, spec.limit);
  if (filtered.length === 0) return [];
  const lines = [spec.header];
  for (const agent of filtered) {
    lines.push(spec.template.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
      // Special-case shortcuts: {{name}}, {{age}}, {{years}} (years
      // since birthTime when present, else 0).
      if (key === 'name') return agent.core?.name ?? '?';
      if (key === 'age') {
        const t = state.metadata?.currentTime;
        const b = agent.core?.birthTime;
        return typeof t === 'number' && typeof b === 'number' ? String(t - b) : '?';
      }
      const raw = readDeepPath(agent, key);
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        // Default rendering: bare integer for whole numbers, two-decimal
        // for fractions. Templates that need different formatting can
        // pre-compute and embed inline.
        return Math.abs(raw) > 0 && Math.abs(raw) < 1
          ? raw.toFixed(2)
          : Math.round(raw).toString();
      }
      return raw == null ? '?' : String(raw);
    }));
  }
  return lines;
}

/** Compile a single JSON-DSL predicate node to a `(state) => boolean`. */
function compilePredicate(node: JsonPredicateNode): (state: Record<string, number | string | boolean>) => boolean {
  if ('all' in node) {
    const subs = node.all.map(compilePredicate);
    return (state) => subs.every((s) => s(state));
  }
  if ('any' in node) {
    const subs = node.any.map(compilePredicate);
    return (state) => subs.some((s) => s(state));
  }
  // Leaf comparison.
  const { field, op, value } = node;
  return (state) => {
    const left = state[field];
    switch (op) {
      case '==': return left === value;
      case '!=': return left !== value;
      case '>=': return Number(left ?? 0) >= Number(value);
      case '>':  return Number(left ?? 0) >  Number(value);
      case '<=': return Number(left ?? 0) <= Number(value);
      case '<':  return Number(left ?? 0) <  Number(value);
      default: return false;
    }
  };
}

/** Substitute `{{key}}` placeholders in a template against a value
 *  bag. Missing keys fall through to a sensible default rather than
 *  rendering literal `{{role}}` into the agent's quote prompt. */
function substituteTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
}

/**
 * Compile a {@link JsonDataDrivenScenarioConfig} into the function-
 * typed {@link DataDrivenScenarioConfig} the original factory
 * consumes. Lets scenarios/*.json carry the full config without a
 * sibling TypeScript wrapper.
 */
export function compileJsonDataDrivenConfig(json: JsonDataDrivenScenarioConfig): DataDrivenScenarioConfig {
  const compiledPostureRules: DataDrivenPostureRule[] = json.postureRules.map((rule) => ({
    posture: rule.posture,
    when: compilePredicate(rule.when),
  }));

  const compiledAxes: DataDrivenFingerprintAxis[] = json.fingerprintAxes.map((axis) => {
    const bandFns = axis.bands.map((band) => ({
      label: band.label,
      // Default band: returns its label when nothing else matched.
      // The axis evaluator below treats `default: true` as a final
      // fallback — the wrap function handles ordering.
      isDefault: band.default === true,
      when: band.when ? compilePredicate(band.when) : null,
    }));
    return {
      name: axis.name,
      when: (state) => {
        for (const b of bandFns) {
          if (b.isDefault) continue;
          if (b.when && b.when(state)) return b.label;
        }
        const fallback = bandFns.find((b) => b.isDefault);
        return fallback ? fallback.label : 'unknown';
      },
    };
  });

  // Reaction template: short-form string (legacy) substitutes only
  // {{role}} and {{department}}; structured form supports per-line
  // predicates and per-agent path substitutions.
  const reactionTemplate: DataDrivenScenarioConfig['reactionTemplate'] =
    typeof json.reactionTemplate === 'string'
      ? (agent) => {
          const role = agent.core?.role || 'researcher';
          const dept = agent.core?.department || 'engineering';
          return substituteTemplate(json.reactionTemplate as string, { role, department: dept });
        }
      : compileStructuredReactionTemplate(json.reactionTemplate);

  return {
    directorInstructions: json.directorInstructions,
    departments: json.departments,
    postureRules: compiledPostureRules,
    fingerprintAxes: compiledAxes,
    politics: json.politics,
    reactionTemplate,
    progressionPhysics: json.progressionPhysics,
    milestones: json.milestones,
  };
}

/**
 * Compile a structured reaction template (line array with optional
 * per-line predicates) into the `(agent, ctx) => string` shape the
 * engine consumes. Supported `{{key}}` substitutions:
 *   - `{{role}}`, `{{department}}`, `{{name}}`
 *   - `{{years}}` — `ctx.time - agent.core.birthTime` if both numeric
 *   - any agent path (e.g., `{{health.boneDensityPct}}`,
 *     `{{core.marsborn}}`)
 */
function compileStructuredReactionTemplate(
  spec: JsonReactionTemplate,
): (agent: Agent, ctx: { time: number; turn: number }) => string {
  const compiled = spec.lines.map((line) => ({
    template: line.template,
    when: line.when ? compileAgentPredicate(line.when) : null,
  }));
  const join = spec.join ?? ' ';
  return (agent, ctx) => {
    const out: string[] = [];
    for (const line of compiled) {
      if (line.when && !line.when(agent)) continue;
      out.push(line.template.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
        if (key === 'role') return agent.core?.role ?? 'researcher';
        if (key === 'department') return agent.core?.department ?? 'engineering';
        if (key === 'name') return agent.core?.name ?? '?';
        if (key === 'years') {
          const b = agent.core?.birthTime;
          return typeof ctx.time === 'number' && typeof b === 'number' ? String(ctx.time - b) : '?';
        }
        const raw = readDeepPath(agent, key);
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          return Math.abs(raw) > 0 && Math.abs(raw) < 1
            ? raw.toFixed(2)
            : Math.round(raw).toString();
        }
        return raw == null ? '?' : String(raw);
      }));
    }
    return out.join(join);
  };
}

/**
 * Convenience: build hooks straight from a JSON-DSL config without
 * the caller having to compile it first. The disk-loader uses this
 * path for scenarios/*.json files that carry a `dataDrivenHooks`
 * field.
 */
export function buildDataDrivenHooksFromJson(json: JsonDataDrivenScenarioConfig): ScenarioHooks {
  return buildDataDrivenHooks(compileJsonDataDrivenConfig(json));
}

/**
 * Render a single chip — either a state-path chip or an aggregation
 * chip computed against the agent population. Discriminates by the
 * presence of `agg` on the input shape.
 */
function renderChip(
  chip: DataDrivenChip | DataDrivenAggChip,
  state: SimulationState,
): string {
  if ('agg' in chip) {
    const value = evaluateAggChip(chip, state.agents);
    return formatChip({ label: chip.label, source: '', format: chip.format }, value);
  }
  return formatChip(chip, readPath(state, chip.source));
}

/**
 * Build a {@link ScenarioHooks} record from a {@link DataDrivenScenarioConfig}.
 * Every paracosm scenario routes through here — the JSON-DSL compiler
 * produces the function-typed config, and this factory turns it into
 * the runtime hook record.
 */
export function buildDataDrivenHooks(config: DataDrivenScenarioConfig): ScenarioHooks {
  // Resolve the physics module up front. Unknown IDs log a warning
  // and the progressionHook is omitted entirely so the engine falls
  // through to its built-in no-op path.
  let progressionHook: ProgressionPhysics | undefined;
  if (config.progressionPhysics) {
    const fn = physicsModules[config.progressionPhysics];
    if (fn) {
      progressionHook = fn;
    } else {
      console.warn(
        `[data-driven-hooks] Unknown progressionPhysics id: ${config.progressionPhysics}. ` +
        `Available: ${Object.keys(physicsModules).join(', ')}.`,
      );
    }
  }

  // Compile milestones once so the runtime callback is just a turn
  // lookup. `'final'` resolves to maxTurns at call time — the
  // wrapper closure reads the maxTurns argument the engine passes.
  const milestones = config.milestones ?? [];
  const getMilestoneEvent = milestones.length > 0
    ? (turn: number, maxTurns: number) => {
        for (const m of milestones) {
          const targetTurn = m.turn === 'final' ? maxTurns : m.turn;
          if (turn === targetTurn) return m.event;
        }
        return null;
      }
    : undefined;

  const hooks: ScenarioHooks = {
    departmentPromptHook: (ctx) => {
      const spec = config.departments[ctx.department];
      if (!spec) return [];
      const chips = spec.chips
        .map((chip) => renderChip(chip, ctx.state))
        .join(' | ');
      const lines: string[] = [spec.heading, chips];
      if (spec.featuredRoster) {
        lines.push(...renderFeaturedRoster(spec.featuredRoster, ctx.state.agents, ctx.state));
      }
      if (spec.footer) lines.push(spec.footer);
      lines.push('');
      return lines;
    },

    directorInstructions: () => config.directorInstructions,

    fingerprintHook: (
      finalState: SimulationState,
      outcomeLog: Array<{ turn: number; time: number; outcome: string }>,
      leader: ActorConfig,
      toolRegs: Record<string, string[]>,
      maxTurns: number,
    ) => {
      const flat = flattenStateForFingerprint(finalState, outcomeLog, leader, toolRegs, maxTurns);
      const out: Record<string, string> = {};
      const matched = config.postureRules.find((rule) => {
        try {
          return rule.when(flat);
        } catch {
          return false;
        }
      });
      if (matched) out.posture = matched.posture;
      // Only synthesize the catch-all `mixed-posture` when the scenario
      // actually defined posture rules. Scenarios that rely solely on
      // fingerprint axes (Mars + Lunar in particular) shouldn't carry
      // an artificial `posture` field they never asked for.
      else if (config.postureRules.length > 0) out.posture = 'mixed-posture';
      for (const axis of config.fingerprintAxes) {
        try {
          out[axis.name] = axis.when(flat);
        } catch {
          out[axis.name] = 'unknown';
        }
      }
      // Convention: scenarios that emit a `summary` axis get it
      // re-anchored as a final ` · `-joined line built from the other
      // axes. If the scenario explicitly defined a summary axis, that
      // wins; otherwise we synthesize one so every fingerprint has a
      // human-readable headline.
      if (!('summary' in out)) {
        const parts = config.fingerprintAxes.map((a) => out[a.name]).filter(Boolean);
        if (parts.length > 0) out.summary = parts.join(' · ');
      }
      return out;
    },

    politicsHook: (category, outcome) => {
      const entry = config.politics[category];
      if (!entry) return null;
      // Defensive string-check: orchestrator typing says `outcome` is
      // a string, but a stray null/undefined from a malformed runtime
      // event would otherwise throw inside endsWith. Treat anything
      // non-string as a failure so the failure-side deltas apply.
      const isSuccess = typeof outcome === 'string' && outcome.endsWith('success');
      return isSuccess
        ? entry.onSuccess ?? null
        : entry.onFailure ?? null;
    },

    reactionContextHook: (agent, ctx) => config.reactionTemplate(agent, ctx),
  };

  if (progressionHook) hooks.progressionHook = progressionHook;
  if (getMilestoneEvent) hooks.getMilestoneEvent = getMilestoneEvent;
  return hooks;
}

/**
 * Extended fingerprint state bag — adds leader HEXACO axes (prefixed
 * `leader.`), outcome counts (`outcomes.<key>` + `outcomes.total`),
 * tool count (`tools.total`), maxTurns, and per-population aggregates
 * (`agents.alive`, `agents.marsborn`, `agents.featured`) so band
 * predicates can classify scenarios on leadership style + run trajectory
 * + roster composition without bespoke code.
 */
function flattenStateForFingerprint(
  state: SimulationState,
  outcomeLog: Array<{ turn: number; time: number; outcome: string }>,
  leader: ActorConfig,
  toolRegs: Record<string, string[]>,
  maxTurns: number,
): Record<string, number | string | boolean> {
  const out = flattenState(state);

  if (leader && typeof leader === 'object' && leader.hexaco) {
    for (const [k, v] of Object.entries(leader.hexaco)) {
      if (typeof v === 'number') out[`leader.${k}`] = v;
    }
  }

  const outcomeCounts: Record<string, number> = {
    risky_success: 0,
    risky_failure: 0,
    conservative_success: 0,
    conservative_failure: 0,
  };
  for (const o of outcomeLog) {
    if (typeof o.outcome === 'string' && o.outcome in outcomeCounts) {
      outcomeCounts[o.outcome] += 1;
    }
  }
  for (const [k, v] of Object.entries(outcomeCounts)) {
    out[`outcomes.${k}`] = v;
  }
  out['outcomes.total'] = outcomeLog.length;
  out['outcomes.risky'] = outcomeCounts.risky_success + outcomeCounts.risky_failure;
  out['outcomes.conservative'] = outcomeCounts.conservative_success + outcomeCounts.conservative_failure;

  const totalTools = Object.values(toolRegs).flat().length;
  out['tools.total'] = totalTools;

  out.maxTurns = maxTurns;

  // Roster aggregates — the most common ones bands ask for. Mars
  // identity classification needs alive vs marsborn; cleaner to hand
  // them in as primitives than force every band predicate to compile
  // its own agent-pool walk.
  let alive = 0;
  let marsborn = 0;
  let featured = 0;
  // Defensive against partial fixtures (test mocks pass {} or omit
  // .agents entirely). Real runs always supply the array.
  const agents = Array.isArray(state.agents) ? state.agents : [];
  for (const a of agents) {
    if (a.health?.alive) {
      alive += 1;
      if (a.core?.marsborn) marsborn += 1;
      if (a.narrative?.featured) featured += 1;
    }
  }
  out['agents.alive'] = alive;
  out['agents.marsborn'] = marsborn;
  out['agents.featured'] = featured;

  return out;
}
