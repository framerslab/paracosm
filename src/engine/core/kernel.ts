import type { SimulationState, Agent, TurnEvent, HexacoProfile, TurnOutcome, Department } from './state.js';
import type { WorldMetrics, WorldPolitics } from './state.js';
import type { ProgressionHookContext, ScenarioPackage } from '../types.js';
import { SeededRng } from './rng.js';
import { agentIdKeys, generateInitialPopulation, generateJoiners, type KeyPersonnel } from './agent-generator.js';
import { progressBetweenTurns, applyPersonalityDrift, moraleAfterGain, ROLE_ACTIVATIONS } from './progression.js';
import type { KernelSnapshot } from './snapshot.js';
import { CURRENT_SNAPSHOT_VERSION } from './snapshot.js';
import { ageInYears, yearsPerTimeUnit } from './time-unit.js';

interface DeclaredMetric {
  id?: string;
  type?: 'number' | 'string' | 'boolean';
  initial?: number | string | boolean;
  min?: number;
  max?: number;
  /** A supply that sustains the people: its amount against landing day moves the yearly age and accident rates. */
  sustains?: boolean;
}

/**
 * The most people hires can bring a roster to. A delta is a number a model
 * or a compiled scenario wrote, and each person it brings in costs memory
 * and a place in every turn's snapshot.
 */
const MAX_ROSTER = 2000;

/** The floor and ceiling a scenario declares for each value that has one. */
type DeclaredRanges = Record<string, { min?: number; max?: number }>;

function declaredRanges(...bags: Array<Record<string, DeclaredMetric> | undefined>): DeclaredRanges {
  const ranges: DeclaredRanges = {};
  for (const bag of bags) {
    for (const [key, def] of Object.entries(bag ?? {})) {
      if (typeof def.min === 'number' || typeof def.max === 'number') ranges[key] = { min: def.min, max: def.max };
    }
  }
  return ranges;
}

/** The bags of a scenario's `world` that hold floors and ceilings. */
interface WorldRangeBags {
  metrics?: Record<string, DeclaredMetric>;
  capacities?: Record<string, DeclaredMetric>;
  politics?: Record<string, DeclaredMetric>;
}

/** Pick the declared initial value; fall back to a type-appropriate zero. */
function declaredInitial(def: DeclaredMetric): number | string | boolean {
  if (def.initial !== undefined) return def.initial;
  switch (def.type) {
    case 'string': return '';
    case 'boolean': return false;
    case 'number':
    default: return 0;
  }
}

/** Project a scenario bag declaration to a runtime record, coerced per type. */
function seedNumericBag(bag: Record<string, DeclaredMetric> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!bag) return out;
  for (const [key, def] of Object.entries(bag)) {
    const v = declaredInitial(def);
    if (typeof v === 'number') out[key] = v;
  }
  return out;
}

function seedStringOrBooleanBag(
  bag: Record<string, DeclaredMetric> | undefined,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  if (!bag) return out;
  for (const [key, def] of Object.entries(bag)) {
    const v = declaredInitial(def);
    if (typeof v === 'string' || typeof v === 'boolean') out[key] = v;
  }
  return out;
}

function seedAnyBag(
  bag: Record<string, DeclaredMetric> | undefined,
): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  if (!bag) return out;
  for (const [key, def] of Object.entries(bag)) {
    out[key] = declaredInitial(def);
  }
  return out;
}

/**
 * The kernel's Mars-heritage world: the settlement resources and Earth
 * politics the Mars and Lunar scenarios run on. A run with no scenario
 * starts with all of them, as it always has. A run of a scenario carries
 * only the ones its `world` declares (Mars and the Moon declare them all;
 * the deep-ocean station declares power and food), so an AI lab has no
 * power plant, food store or Earth dependency in its state, its stream,
 * its outcome effects or its saved run.
 */
const HERITAGE_METRICS: Readonly<Record<string, number>> = {
  powerKw: 400,
  foodMonthsReserve: 18,
  waterLitersPerDay: 800,
  pressurizedVolumeM3: 3000,
  lifeSupportCapacity: 120,
  infrastructureModules: 3,
  scienceOutput: 0,
};

const HERITAGE_POLITICS: Readonly<Record<string, number | string>> = {
  earthDependencyPct: 95,
  governanceStatus: 'earth-governed',
  independencePressure: 0.05,
};

/**
 * Drop the heritage keys `declared` does not hold. `declared` null means
 * the run has no scenario world, and everything stays.
 */
function withoutUndeclaredHeritage<T extends Record<string, unknown>>(
  values: T | undefined,
  heritage: Readonly<Record<string, unknown>>,
  declared: ReadonlySet<string> | null,
): Partial<T> {
  if (!values) return {};
  if (!declared) return { ...values };
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !(key in heritage) || declared.has(key)),
  ) as Partial<T>;
}

/** Clamp a numeric field in place; a field the run does not carry stays absent. */
function clampField(bag: Record<string, unknown>, key: string, min: number, max = Infinity): void {
  const value = bag[key];
  if (typeof value === 'number') bag[key] = Math.max(min, Math.min(max, value));
}

/** Hold the fields a change touched to the range their scenario declares. */
function clampDeclared(bag: Record<string, unknown>, keys: Iterable<string>, ranges: DeclaredRanges): void {
  for (const key of keys) {
    const range = ranges[key];
    if (range) clampField(bag, key, range.min ?? -Infinity, range.max ?? Infinity);
  }
}

/**
 * The change a delta made: the delta itself, or less where a floor or
 * ceiling stopped it (power at 0) or a morale gain eased above 0.9.
 */
function changeMade(asked: number, before: number, after: number): number {
  const moved = after - before;
  // An unclamped change is the delta; the subtraction would add float noise.
  return Math.abs(moved - asked) < 1e-9 ? asked : Math.round(moved * 1e6) / 1e6;
}

/**
 * The most a department's report or patch moves a person's psych score in
 * one write. A report can say a featured person is struggling; a model's
 * 0.05 does not become a despair roll the leader never chose.
 */
export const PSYCH_STEP = 0.15;

/** The health keys a department's patch may write. */
const PATCHABLE_HEALTH = new Set(['psychScore', 'conditions']);


export interface SystemsPatch {
  metrics?: Partial<WorldMetrics>;
  politics?: Partial<WorldPolitics>;
  agentUpdates?: Array<{
    agentId: string;
    health?: Partial<Agent['health']>;
    career?: Partial<Agent['career']>;
  }>;
}

export interface PolicyEffect {
  description: string;
  /** Values set outright. A head count here is ignored: the roster holds it. */
  patches: SystemsPatch;
  /** Changes added to the current values, after `patches`; see {@link SimulationKernel.applyDeltas}. */
  deltas?: {
    metrics?: Record<string, number>;
    politics?: Record<string, number>;
  };
  events: TurnEvent[];
}

export interface SimulationInitOverrides {
  startTime?: number;
  initialPopulation?: number;
  /**
   * Source for scenario-declared world bag initials. When present, the
   * kernel seeds each runtime bag from `scenario.world.*` before
   * applying the explicit overlay fields below. Absent → Mars-heritage
   * hardcoded defaults only.
   */
  scenario?: ScenarioPackage;
  /**
   * Years in one unit of the run's time. Absent, it comes from the
   * scenario (see {@link yearsPerTimeUnit}); with no scenario it is 1.
   */
  yearsPerUnit?: number;
  startingResources?: Partial<WorldMetrics>;
  startingPolitics?: Partial<WorldPolitics>;
  startingStatuses?: Record<string, string | boolean>;
  startingEnvironment?: Record<string, number | string | boolean>;
}

export class SimulationKernel {
  private state: SimulationState;
  private rng: SeededRng;
  /** The floors and ceilings the scenario declares; empty for a run with no scenario. */
  private ranges: { metrics: DeclaredRanges; politics: DeclaredRanges } = { metrics: {}, politics: {} };

  constructor(seed: number, leaderId: string, keyPersonnel: KeyPersonnel[], init: SimulationInitOverrides = {}) {
    this.rng = new SeededRng(seed);
    const startTime = init.startTime ?? 2035;
    // Mars Genesis's roster is the generator's own distribution, trades
    // beyond its five declared departments included. Any other scenario's
    // people work in the departments it declares.
    const rosterDepartments = init.scenario && init.scenario.id !== 'mars-genesis' && init.scenario.departments?.length
      ? init.scenario.departments
      : undefined;
    const yearsPerUnit = typeof init.yearsPerUnit === 'number' && Number.isFinite(init.yearsPerUnit) && init.yearsPerUnit > 0
      ? init.yearsPerUnit
      : init.scenario ? yearsPerTimeUnit(init.scenario.labels, init.scenario.setup) : 1;
    const agents = generateInitialPopulation(seed, startTime, keyPersonnel, init.initialPopulation ?? 100, rosterDepartments, yearsPerUnit);

    // Layer sources: Mars-heritage defaults (the ones the scenario
    // declares) → scenario declarations → caller overlays (last writer
    // wins). Scenario declarations flow through `init.scenario?.world.*`;
    // absent → bag is empty.
    const scenarioWorld = (init.scenario?.world ?? {}) as {
      metrics?: Record<string, DeclaredMetric>;
      capacities?: Record<string, DeclaredMetric>;
      statuses?: Record<string, DeclaredMetric>;
      politics?: Record<string, DeclaredMetric>;
      environment?: Record<string, DeclaredMetric>;
    };
    const scenarioSystems = {
      ...seedNumericBag(scenarioWorld.metrics),
      ...seedNumericBag(scenarioWorld.capacities),
    };
    const scenarioPolitics = seedAnyBag(scenarioWorld.politics);
    const scenarioStatuses = seedStringOrBooleanBag(scenarioWorld.statuses);
    const scenarioEnvironment = seedAnyBag(scenarioWorld.environment);
    // What the scenario declares, for the heritage defaults. Mars declares
    // `governanceStatus` among its statuses; it stays in politics there.
    const declaredMetrics = init.scenario?.world
      ? new Set(Object.keys(scenarioSystems))
      : null;
    const declaredPolitics = init.scenario?.world
      ? new Set([...Object.keys(scenarioPolitics), ...Object.keys(scenarioStatuses)])
      : null;

    this.state = {
      metadata: {
        simulationId: `sim-${seed}-${leaderId.toLowerCase().replace(/\s+/g, '-')}`,
        leaderId, seed,
        startTime, currentTime: startTime, currentTurn: 0,
        yearsPerUnit,
      },
      metrics: {
        // Every run has people and morale; the heritage resources only
        // where the scenario declares them (or there is no scenario).
        population: agents.length,
        ...withoutUndeclaredHeritage(HERITAGE_METRICS, HERITAGE_METRICS, declaredMetrics),
        morale: 0.85,
        // Scenario declarations (metrics + capacities flattened)
        ...scenarioSystems,
        // Caller overlay wins, within what the scenario carries
        ...withoutUndeclaredHeritage(init.startingResources, HERITAGE_METRICS, declaredMetrics),
      } as WorldMetrics,
      agents,
      politics: {
        ...withoutUndeclaredHeritage(HERITAGE_POLITICS, HERITAGE_POLITICS, declaredPolitics),
        ...scenarioPolitics,
        ...withoutUndeclaredHeritage(init.startingPolitics, HERITAGE_POLITICS, declaredPolitics),
      } as WorldPolitics,
      statuses: {
        ...scenarioStatuses,
        ...init.startingStatuses,
      },
      environment: {
        ...scenarioEnvironment,
        ...init.startingEnvironment,
      },
      eventLog: [],
    };
    // The roster is the head count, whatever a scenario declares for a
    // full-size run: a demo run of Atlas Lab has 30 people, not 480.
    this.state.metrics.population = agents.length;
    // What the colony holds on landing day, after the caller's starting
    // resources, of each supply the scenario marks as sustaining its
    // people (`sustains`), when it holds more than nothing. A scenario
    // that marks none keeps no landing amounts, and its supply level
    // reads 1.
    const landingSupplies: Record<string, number> = {};
    for (const bag of [scenarioWorld.metrics, scenarioWorld.capacities]) {
      for (const [key, def] of Object.entries(bag ?? {})) {
        const value = (this.state.metrics as Record<string, unknown>)[key];
        if (def.sustains === true && typeof value === 'number' && value > 0) landingSupplies[key] = value;
      }
    }
    if (Object.keys(landingSupplies).length > 0) this.state.metadata.landingSupplies = landingSupplies;
    // How each person's death dice are kept, recorded in the state so a
    // saved run and a fork of one keep the dice they began with.
    if (init.scenario?.setup?.mortalityDice === 'life') this.state.metadata.mortalityDice = 'life';
    this.setRanges(init.scenario);
  }

  /** Read the floors and ceilings out of a scenario's `world`. */
  private setRanges(scenario: ScenarioPackage | undefined): void {
    const world = (scenario?.world ?? {}) as WorldRangeBags;
    this.ranges = {
      metrics: declaredRanges(world.metrics, world.capacities),
      politics: declaredRanges(world.politics),
    };
  }

  getState(): SimulationState { return structuredClone(this.state); }

  /** The turn {@link psychAtFirstWrite} holds, and each person's psych at the turn's first department write. */
  private psychTurn = -1;
  private psychAtFirstWrite = new Map<string, number>();

  /**
   * Move a person's psych toward `target` (clamped 0 to 1), never more
   * than {@link PSYCH_STEP} from where it stood at the turn's first
   * department write, however many reports and patches name them.
   */
  private movePsych(agent: Agent, target: number): void {
    if (!Number.isFinite(target)) return;
    const turn = this.state.metadata.currentTurn;
    if (turn !== this.psychTurn) {
      this.psychTurn = turn;
      this.psychAtFirstWrite.clear();
    }
    const id = agent.core.id;
    if (!this.psychAtFirstWrite.has(id)) this.psychAtFirstWrite.set(id, agent.health.psychScore);
    const start = this.psychAtFirstWrite.get(id)!;
    const goal = Math.max(0, Math.min(1, target));
    agent.health.psychScore = start + Math.max(-PSYCH_STEP, Math.min(PSYCH_STEP, goal - start));
  }

  /**
   * Years in one unit of the run's time. A state saved before units had
   * lengths carries none, and its ages were written as if a unit were a
   * year, so it reads 1.
   */
  get yearsPerUnit(): number {
    return this.state.metadata.yearsPerUnit ?? 1;
  }

  /** A person's age in years now. */
  ageYears(agent: Agent): number {
    return ageInYears(agent, this.state.metadata.currentTime, this.yearsPerUnit);
  }

  /**
   * Capture a {@link KernelSnapshot} bundle. The returned object is
   * plain JSON-safe data: `JSON.stringify(snap)` + `JSON.parse` +
   * `SimulationKernel.fromSnapshot(parsed, scenarioId)` round-trips
   * to a new kernel in the same state. Used by
   * `WorldModel.snapshot()` + `fork()` for mid-run counterfactuals.
   *
   * @param scenarioId - Scenario id the snapshot is being taken
   *   against. Stamped into the snapshot so `fromSnapshot` can
   *   verify the target WorldModel's scenario matches.
   */
  toSnapshot(scenarioId: string): KernelSnapshot {
    return {
      snapshotVersion: CURRENT_SNAPSHOT_VERSION,
      scenarioId,
      turn: this.state.metadata.currentTurn,
      time: this.state.metadata.currentTime,
      state: structuredClone(this.state),
      rngState: this.rng.getState(),
      startTime: this.state.metadata.startTime,
      seed: this.state.metadata.seed,
    };
  }

  /**
   * Reverse of {@link SimulationKernel.toSnapshot}. Constructs a
   * fresh kernel positioned at the snapshot's turn, with simulation
   * state + PRNG state + metadata fully restored. The returned
   * kernel is indistinguishable from the one that produced the
   * snapshot as far as subsequent `advanceTurn` calls are concerned.
   *
   * @param snap - The captured snapshot.
   * @param expectedScenarioId - Scenario id the caller expects the
   *   snapshot to match. Throws when they differ; this is the gate
   *   against accidental cross-scenario forks.
   * @param scenario - The scenario the kernel goes on running, for its
   *   declared floors and ceilings, which a snapshot does not hold.
   *   Without it the restored kernel keeps only its built-in ones.
   * @throws Error when `snap.snapshotVersion !== 1` or when
   *   `snap.scenarioId !== expectedScenarioId`.
   */
  static fromSnapshot(snap: KernelSnapshot, expectedScenarioId: string, scenario?: ScenarioPackage): SimulationKernel {
    if (snap.snapshotVersion !== 1) {
      throw new Error(
        `KernelSnapshot.snapshotVersion=${snap.snapshotVersion} is not supported; ` +
        `this paracosm build only restores version 1.`,
      );
    }
    if (snap.scenarioId !== expectedScenarioId) {
      throw new Error(
        `KernelSnapshot scenarioId mismatch: snapshot was taken against ` +
        `'${snap.scenarioId}' but the caller expects '${expectedScenarioId}'. ` +
        `Cross-scenario forks are not supported.`,
      );
    }
    // Build a minimal kernel shell via the existing constructor, then
    // overwrite its state + rng with the snapshot. The constructor
    // allocates a fresh SimulationState (including a generated agent
    // roster); we throw that away and graft on the snapshot's
    // deep-cloned one. This costs one allocation that we discard but
    // keeps the kernel's invariants (rng seeded, metadata populated)
    // intact for the same-shape grafting.
    const kernel = new SimulationKernel(snap.seed, snap.state.metadata.leaderId, [], {
      startTime: snap.startTime,
    });
    kernel.state = structuredClone(snap.state);
    kernel.rng = SeededRng.fromState(snap.rngState);
    kernel.setRanges(scenario);
    return kernel;
  }



  getFeaturedAgents(): Agent[] {
    return this.state.agents.filter(c => c.narrative.featured && c.health.alive);
  }

  getAliveAgents(): Agent[] {
    return this.state.agents.filter(c => c.health.alive);
  }

  getAliveCount(): number {
    return this.state.agents.filter(c => c.health.alive).length;
  }

  getDepartmentSummary(dept: string) {
    const m = this.state.agents.filter(c => c.health.alive && c.core.department === dept);
    if (!m.length) return { count: 0, avgMorale: 0, avgBoneDensity: 0, avgRadiation: 0 };
    return {
      count: m.length,
      avgMorale: m.reduce((s, c) => s + c.health.psychScore, 0) / m.length,
      avgBoneDensity: m.reduce((s, c) => s + ( c.health.boneDensityPct ?? 0), 0) / m.length,
      avgRadiation: m.reduce((s, c) => s + (c.health.cumulativeRadiationMsv ?? 0), 0) / m.length,
    };
  }

  /**
   * Apply a policy effect from the commander's decision: its patches set
   * values outright, then its deltas add to them. Returns the change each
   * delta made, and logs it.
   */
  applyPolicy(effect: PolicyEffect): Record<string, number> {
    const { patches, deltas, events } = effect;

    if (patches.metrics) {
      const c = this.state.metrics;
      const written: string[] = [];
      for (const [k, v] of Object.entries(patches.metrics)) {
        // The head count follows the roster; a model's number cannot replace it.
        // Number.isFinite is false for anything but a finite number.
        if (k === 'population' || !Number.isFinite(v) || !(k in c)) continue;
        (c as any)[k] = v;
        written.push(k);
      }
      clampField(c, 'morale', 0, 1);
      clampField(c, 'foodMonthsReserve', 0);
      clampField(c, 'powerKw', 0);
      clampDeclared(c, written, this.ranges.metrics);
    }

    if (patches.politics) {
      const p = this.state.politics;
      const written: string[] = [];
      for (const [k, v] of Object.entries(patches.politics)) {
        if (v !== undefined && k in p && typeof v === typeof p[k]) {
          (p as any)[k] = v;
          written.push(k);
        }
      }
      clampField(p, 'earthDependencyPct', 0, 100);
      clampField(p, 'independencePressure', 0, 1);
      clampDeclared(p, written, this.ranges.politics);
    }

    if (patches.agentUpdates) {
      const dropped = new Set<string>();
      for (const u of patches.agentUpdates) {
        const col = this.findAgent(u.agentId);
        if (!col) continue;
        if (u.health) {
          // A patch writes a person's psych (within the bound a report's
          // update has) and conditions. It never decides who lives (a death
          // comes from progression, with the `death` event the roster and
          // the verdict's mortality line are read from), and never writes
          // what a physics hook owns: dose and bone density gate deaths.
          for (const key of Object.keys(u.health)) {
            if (!PATCHABLE_HEALTH.has(key)) dropped.add(key);
          }
          if (typeof u.health.psychScore === 'number') this.movePsych(col, u.health.psychScore);
          if (Array.isArray(u.health.conditions)) col.health.conditions = [...u.health.conditions];
        }
        if (u.career) Object.assign(col.career, u.career);
      }
      this.state.metrics.population = this.getAliveCount();
      if (dropped.size > 0) {
        const { currentTurn: turn, currentTime: time } = this.state.metadata;
        this.state.eventLog.push({
          turn, time, type: 'system',
          description: `A department's patch wrote ${[...dropped].sort().join(', ')}, which a patch cannot set; left as they were`,
        });
      }
    }

    // One sum per key: a key both bags name moves once, within its range,
    // and reports the change it made.
    const asked: Record<string, number> = { ...deltas?.metrics };
    for (const [k, v] of Object.entries(deltas?.politics ?? {})) asked[k] = (asked[k] ?? 0) + v;
    const applied = this.applyDeltas(asked);
    this.state.eventLog.push(...events);
    const changes = Object.entries(applied);
    if (changes.length > 0) {
      const { currentTurn: turn, currentTime: time } = this.state.metadata;
      this.state.eventLog.push({
        turn, time, type: 'system',
        description: `Policy effect: ${changes.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}`,
      });
    }
    return applied;
  }

  /**
   * Add each delta to wherever the run holds its key, metrics first, then
   * politics; a key the run holds in neither is dropped. Returns the change
   * each key made.
   */
  applyDeltas(deltas: Record<string, number>): Record<string, number> {
    const metrics = this.applySystemDeltas(deltas as Partial<WorldMetrics>);
    const rest = Object.fromEntries(Object.entries(deltas).filter(([k]) => !(k in metrics)));
    return { ...metrics, ...this.applyPoliticsDeltas(rest as Partial<WorldPolitics>) };
  }

  /** Advance to the next turn. Runs between-turn progression. */
  advanceTurn(nextTurn: number, nextTime: number, progressionHook?: (ctx: ProgressionHookContext) => void): SimulationState {
    const prevTime = this.state.metadata.currentTime;
    const timeDelta = nextTime - prevTime;
    const turnRng = this.rng.turnSeed(nextTurn);

    // Update metadata FIRST so progression stamps events correctly
    this.state.metadata.currentTime = nextTime;
    this.state.metadata.currentTurn = nextTurn;

    const { state: progressed, events } = progressBetweenTurns(this.state, timeDelta, turnRng, progressionHook, this.yearsPerUnit);
    this.state = progressed;
    this.state.metrics.population = this.getAliveCount();
    this.updateFeaturedAgents(events);

    return this.getState();
  }

  private updateFeaturedAgents(recentEvents: TurnEvent[]): void {
    const eventIds = new Set(recentEvents.filter(e => e.agentId).map(e => e.agentId!));
    for (const c of this.state.agents) {
      if (eventIds.has(c.core.id) && c.health.alive) c.narrative.featured = true;
    }
    const featured = this.state.agents.filter(c => c.narrative.featured && c.health.alive);
    if (featured.length > 16) {
      const sorted = featured.sort((a, b) => b.narrative.lifeEvents.length - a.narrative.lifeEvents.length);
      for (let i = 16; i < sorted.length; i++) sorted[i].narrative.featured = false;
    }
  }

  /**
   * Get top N candidates for a department role, scored by trait fit. The
   * living adults with no department to head: a fork's roster holds the
   * people born since the start, and the score does not read age.
   */
  getCandidates(dept: Department, topN: number = 5): Agent[] {
    const activation = ROLE_ACTIVATIONS[dept] ?? {};
    return this.state.agents
      .filter(c => c.health.alive && !c.promotion && this.ageYears(c) >= 18)
      .map(c => ({
        colonist: c,
        score: Object.entries(activation).reduce((s, [trait, target]) =>
          s + (1 - Math.abs((c.hexaco as any)[trait] - (target as number))), 0),
      }))
      // Equal scores (a department the trait table does not know scores
      // everyone 0) go to the department's own people first.
      .sort((a, b) => b.score - a.score
        || Number(b.colonist.core.department === dept) - Number(a.colonist.core.department === dept))
      .slice(0, topN)
      .map(x => x.colonist);
  }

  /**
   * Find an agent by an id a model wrote. An exact id wins; otherwise the
   * id is compared with punctuation dropped on both sides, then also
   * without a leading title (see {@link agentIdKeys}). A loose match
   * counts only when it names exactly one agent.
   */
  findAgent(agentId: string): Agent | undefined {
    if (typeof agentId !== 'string') return undefined;
    const agents = this.state.agents;
    const exact = agents.find(a => a.core.id === agentId);
    if (exact) return exact;
    const wanted = agentIdKeys(agentId);
    const keyed = agents.map(a => ({ agent: a, keys: agentIdKeys(a.core.id) }));
    for (const i of [0, 1] as const) {
      if (!wanted[i]) continue;
      const hits = keyed.filter(k => k.keys[i] === wanted[i]);
      if (hits.length === 1) return hits[0].agent;
    }
    return undefined;
  }

  /**
   * Promote a colonist to a department head role. Returns the roster id
   * the promotion resolved to, which can differ from `agentId` in
   * punctuation or a dropped title.
   */
  promoteAgent(agentId: string, dept: Department, role: string, promotedBy: string): string {
    const c = this.findAgent(agentId);
    if (!c) throw new Error(`Agent ${agentId} not found`);
    c.promotion = { department: dept, role, turnPromoted: this.state.metadata.currentTurn, promotedBy };
    c.core.department = dept;
    c.core.role = role;
    c.career.rank = 'chief';
    c.narrative.featured = true;
    c.narrative.lifeEvents.push({
      time: this.state.metadata.currentTime,
      event: `Promoted to ${role} by ${promotedBy}`,
      source: 'commander',
    });
    this.state.eventLog.push({
      turn: this.state.metadata.currentTurn,
      time: this.state.metadata.currentTime,
      type: 'promotion',
      description: `${c.core.name} promoted to ${role}`,
      agentId: c.core.id,
      data: { department: dept, promotedBy },
    });
    return c.core.id;
  }

  /**
   * Apply additive deltas to world systems (not absolute values). A delta
   * for a metric the run does not carry is dropped. A population delta
   * moves whole people on and off the roster; see {@link movePeople}.
   * A morale gain adds in full up to 0.9 and eases above it, so no gain
   * stops at 1 (`moraleAfterGain`). Returns the change each metric made,
   * which is what the run reports: the delta itself, or less where a floor
   * or ceiling stopped it (power at 0, a hull a scenario keeps at or under
   * 100) or a morale gain eased.
   */
  applySystemDeltas(deltas: Partial<WorldMetrics>, events: TurnEvent[] = []): Record<string, number> {
    const c = this.state.metrics;
    const requested: Array<[string, number, number]> = [];
    for (const [k, v] of Object.entries(deltas)) {
      if (typeof v !== 'number' || !Number.isFinite(v) || typeof (c as Record<string, unknown>)[k] !== 'number') continue;
      if (k === 'population') {
        const before = this.getAliveCount();
        requested.push([k, this.movePeople(v), before]);
        continue;
      }
      requested.push([k, v, c[k]]);
      (c as any)[k] = k === 'morale' && v > 0 ? moraleAfterGain((c as any)[k], v) : (c as any)[k] + v;
    }
    clampField(c, 'morale', 0, 1);
    clampField(c, 'foodMonthsReserve', 0);
    clampField(c, 'powerKw', 0);
    clampField(c, 'lifeSupportCapacity', 0);
    clampField(c, 'infrastructureModules', 0);
    clampDeclared(c, requested.map(([k]) => k).filter(k => k !== 'population'), this.ranges.metrics);
    const applied: Record<string, number> = {};
    for (const [k, v, before] of requested) applied[k] = changeMade(v, before, c[k]);
    this.state.eventLog.push(...events);
    return applied;
  }

  /**
   * Move `delta` people, rounded to whole people, on or off the roster and
   * return how many moved. Joiners are new adults in the departments the
   * roster already has; one delta brings in at most as many as the roster
   * holds, up to {@link MAX_ROSTER} or the scenario's declared `max`.
   * Leavers come off the roster with an event of their own: a departure is
   * not a death, so it counts in no mortality figure. Department heads and
   * children stay, people the run has featured go last, and the roster
   * keeps the scenario's declared `min`, so fewer can leave than were asked
   * for.
   */
  private movePeople(delta: number): number {
    const count = Math.abs(Math.round(delta));
    if (count === 0) return 0;
    const { currentTurn: turn, currentTime: time } = this.state.metadata;
    // A sub-stream of its own: the turn rolls derive from the same state and
    // must come out the same whether or not anyone moved.
    const rng = this.rng.turnSeed(turn * 1000 + this.state.eventLog.length + 500);
    const alive = this.getAliveCount();
    const { min = 0, max = MAX_ROSTER } = this.ranges.metrics.population ?? {};
    const moved = delta > 0
      ? this.addPeople(Math.min(count, alive, Math.max(0, Math.min(max, MAX_ROSTER) - alive)), rng, turn, time)
      : -this.removePeople(Math.min(count, Math.max(0, alive - min)), rng, turn, time);
    this.state.metrics.population = this.getAliveCount();
    return moved || 0;
  }

  private addPeople(count: number, rng: SeededRng, turn: number, time: number): number {
    // The log holds who left, so a snapshot of the run carries them too.
    const former = this.state.eventLog.flatMap(e => (
      e.type === 'departure' && e.agentId ? [{ id: e.agentId, name: String(e.data?.name) }] : []
    ));
    const joiners = generateJoiners(rng, time, turn, count, this.state.agents, former, this.yearsPerUnit);
    this.state.agents.push(...joiners);
    for (const a of joiners) {
      this.state.eventLog.push({
        turn, time, type: 'arrival', description: `${a.core.name} joined as ${a.core.role}`, agentId: a.core.id,
        data: { department: a.core.department },
      });
    }
    return joiners.length;
  }

  private removePeople(count: number, rng: SeededRng, turn: number, time: number): number {
    const eligible = this.state.agents.filter(a => a.health.alive && !a.promotion && ageInYears(a, time, this.yearsPerUnit) >= 18);
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    // Array.prototype.sort is stable: the shuffle holds within each group.
    eligible.sort((a, b) => Number(a.narrative.featured) - Number(b.narrative.featured));
    const leaving = eligible.slice(0, count);
    const gone = new Map(leaving.map(a => [a.core.id, a]));
    this.state.agents = this.state.agents.filter(a => !gone.has(a.core.id));
    for (const a of this.state.agents) {
      const partner = a.social.partnerId ? gone.get(a.social.partnerId) : undefined;
      if (partner) {
        a.social.partnerId = undefined;
        a.narrative.lifeEvents.push({ time, event: `Partner ${partner.core.name} left`, source: 'kernel' });
      }
      a.social.friendIds = (a.social.friendIds ?? []).filter(id => !gone.has(id));
      a.social.childrenIds = a.social.childrenIds.filter(id => !gone.has(id));
    }
    for (const a of leaving) {
      this.state.eventLog.push({
        turn, time, type: 'departure', description: `${a.core.name} left`, agentId: a.core.id,
        data: { name: a.core.name, department: a.core.department, role: a.core.role },
      });
    }
    return leaving.length;
  }

  /**
   * Apply additive deltas to world politics; one for a field the run does
   * not carry is dropped. Returns the change each field made, within the
   * range its scenario declares.
   */
  applyPoliticsDeltas(deltas: Partial<WorldPolitics>, events: TurnEvent[] = []): Record<string, number> {
    const p = this.state.politics;
    const requested: Array<[string, number, number]> = [];
    for (const [k, v] of Object.entries(deltas)) {
      const held = p[k];
      if (typeof v === 'number' && Number.isFinite(v) && typeof held === 'number') {
        requested.push([k, v, held]);
        (p as any)[k] = held + v;
      }
    }
    clampField(p, 'earthDependencyPct', 0, 100);
    clampField(p, 'independencePressure', 0, 1);
    clampDeclared(p, requested.map(([k]) => k), this.ranges.politics);
    const applied: Record<string, number> = {};
    for (const [k, v, before] of requested) applied[k] = changeMade(v, before, p[k] as number);
    this.state.eventLog.push(...events);
    return applied;
  }

  /** Apply personality drift to all promoted colonists. */
  applyDrift(commanderHexaco: HexacoProfile, outcome: TurnOutcome | null, timeDelta: number): void {
    applyPersonalityDrift(
      this.state.agents, commanderHexaco, outcome, timeDelta,
      this.state.metadata.currentTurn, this.state.metadata.currentTime,
    );
  }

  /**
   * Apply featured colonist updates from department reports. A report's
   * psych score moves the person at most 0.15 toward the value it writes
   * ({@link PSYCH_STEP}); its conditions are set as written.
   */
  applyAgentUpdates(updates: Array<{ agentId: string; health?: Partial<Agent['health']>; career?: Partial<Agent['career']>; narrativeEvent?: string }>): void {
    for (const u of updates) {
      const col = this.findAgent(u.agentId);
      if (!col || !col.health.alive) continue;

      if (u.health) {
        if (typeof u.health.psychScore === 'number') this.movePsych(col, u.health.psychScore);
        if (u.health.conditions) {
          col.health.conditions = u.health.conditions;
        }
      }
      if (u.career) {
        if (u.career.achievements) {
          col.career.achievements = [...col.career.achievements, ...u.career.achievements];
        }
        if (u.career.currentProject !== undefined) {
          col.career.currentProject = u.career.currentProject;
        }
      }
      if (u.narrativeEvent) {
        col.narrative.lifeEvents.push({
          time: this.state.metadata.currentTime,
          event: u.narrativeEvent,
          source: col.core.department,
        });
      }
    }
  }

  export(): SimulationState { return structuredClone(this.state); }
}
