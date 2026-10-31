import type { SimulationState, Agent, TurnEvent, HexacoProfile, TurnOutcome, Department } from './state.js';
import type { WorldMetrics, WorldPolitics } from './state.js';
import type { ScenarioPackage } from '../types.js';
import { SeededRng } from './rng.js';
import { agentIdKeys, generateInitialPopulation, type KeyPersonnel } from './agent-generator.js';
import { progressBetweenTurns, applyPersonalityDrift, ROLE_ACTIVATIONS } from './progression.js';
import type { KernelSnapshot } from './snapshot.js';
import { CURRENT_SNAPSHOT_VERSION } from './snapshot.js';

interface DeclaredMetric {
  id?: string;
  type?: 'number' | 'string' | 'boolean';
  initial?: number | string | boolean;
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
  patches: SystemsPatch;
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
  startingResources?: Partial<WorldMetrics>;
  startingPolitics?: Partial<WorldPolitics>;
  startingStatuses?: Record<string, string | boolean>;
  startingEnvironment?: Record<string, number | string | boolean>;
}

export class SimulationKernel {
  private state: SimulationState;
  private rng: SeededRng;

  constructor(seed: number, leaderId: string, keyPersonnel: KeyPersonnel[], init: SimulationInitOverrides = {}) {
    this.rng = new SeededRng(seed);
    const startTime = init.startTime ?? 2035;
    const agents = generateInitialPopulation(seed, startTime, keyPersonnel, init.initialPopulation ?? 100);

    // Layer sources: Mars-heritage defaults → scenario declarations →
    // caller overlays (last writer wins). Scenario declarations flow
    // through `init.scenario?.world.*`; absent → bag is empty.
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

    this.state = {
      metadata: {
        simulationId: `sim-${seed}-${leaderId.toLowerCase().replace(/\s+/g, '-')}`,
        leaderId, seed,
        startTime, currentTime: startTime, currentTurn: 0,
      },
      metrics: {
        // Mars-heritage numerics
        population: agents.length,
        powerKw: 400,
        foodMonthsReserve: 18,
        waterLitersPerDay: 800,
        pressurizedVolumeM3: 3000,
        lifeSupportCapacity: 120,
        infrastructureModules: 3,
        scienceOutput: 0,
        morale: 0.85,
        // Scenario declarations (metrics + capacities flattened)
        ...scenarioSystems,
        // Caller overlay wins
        ...init.startingResources,
      },
      agents,
      politics: {
        earthDependencyPct: 95,
        governanceStatus: 'earth-governed',
        independencePressure: 0.05,
        ...scenarioPolitics,
        ...init.startingPolitics,
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
  }

  getState(): SimulationState { return structuredClone(this.state); }

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
   * @throws Error when `snap.snapshotVersion !== 1` or when
   *   `snap.scenarioId !== expectedScenarioId`.
   */
  static fromSnapshot(snap: KernelSnapshot, expectedScenarioId: string): SimulationKernel {
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

  /** Apply a policy effect from the commander's decision. */
  applyPolicy(effect: PolicyEffect): void {
    const { patches, events } = effect;

    if (patches.metrics) {
      const c = this.state.metrics;
      for (const [k, v] of Object.entries(patches.metrics)) {
        if (v !== undefined && k in c) (c as any)[k] = v;
      }
      c.population = Math.max(0, c.population);
      c.morale = Math.max(0, Math.min(1, c.morale));
      c.foodMonthsReserve = Math.max(0, c.foodMonthsReserve);
      c.powerKw = Math.max(0, c.powerKw);
    }

    if (patches.politics) {
      const p = this.state.politics;
      for (const [k, v] of Object.entries(patches.politics)) {
        if (v !== undefined && k in p) (p as any)[k] = v;
      }
      p.earthDependencyPct = Math.max(0, Math.min(100, p.earthDependencyPct));
      p.independencePressure = Math.max(0, Math.min(1, p.independencePressure));
    }

    if (patches.agentUpdates) {
      for (const u of patches.agentUpdates) {
        const col = this.findAgent(u.agentId);
        if (!col) continue;
        if (u.health) Object.assign(col.health, u.health);
        if (u.career) Object.assign(col.career, u.career);
      }
    }

    this.state.eventLog.push(...events);
  }

  /** Advance to the next turn. Runs between-turn progression. */
  advanceTurn(nextTurn: number, nextTime: number, progressionHook?: (ctx: { agents: any[]; timeDelta: number; time: number; turn: number; startTime: number; rng: any }) => void): SimulationState {
    const prevTime = this.state.metadata.currentTime;
    const timeDelta = nextTime - prevTime;
    const turnRng = this.rng.turnSeed(nextTurn);

    // Update metadata FIRST so progression stamps events correctly
    this.state.metadata.currentTime = nextTime;
    this.state.metadata.currentTurn = nextTurn;

    const { state: progressed, events } = progressBetweenTurns(this.state, timeDelta, turnRng, progressionHook);
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

  /** Get top N candidates for a department role, scored by trait fit. */
  getCandidates(dept: Department, topN: number = 5): Agent[] {
    const activation = ROLE_ACTIVATIONS[dept] ?? {};
    return this.state.agents
      .filter(c => c.health.alive && !c.promotion)
      .map(c => ({
        colonist: c,
        score: Object.entries(activation).reduce((s, [trait, target]) =>
          s + (1 - Math.abs((c.hexaco as any)[trait] - (target as number))), 0),
      }))
      .sort((a, b) => b.score - a.score)
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

  /** Apply additive deltas to world systems (not absolute values). */
  applySystemDeltas(deltas: Partial<WorldMetrics>, events: TurnEvent[] = []): void {
    const c = this.state.metrics;
    for (const [k, v] of Object.entries(deltas)) {
      if (v !== undefined && typeof v === 'number' && k in c) {
        (c as any)[k] = (c as any)[k] + v;
      }
    }
    c.morale = Math.max(0, Math.min(1, c.morale));
    c.foodMonthsReserve = Math.max(0, c.foodMonthsReserve);
    c.powerKw = Math.max(0, c.powerKw);
    c.population = Math.max(0, c.population);
    c.lifeSupportCapacity = Math.max(0, c.lifeSupportCapacity);
    c.infrastructureModules = Math.max(0, c.infrastructureModules);
    this.state.eventLog.push(...events);
  }

  /** Apply additive deltas to world politics. */
  applyPoliticsDeltas(deltas: Partial<WorldPolitics>, events: TurnEvent[] = []): void {
    const p = this.state.politics;
    for (const [k, v] of Object.entries(deltas)) {
      if (v !== undefined && typeof v === 'number' && k in p) {
        (p as any)[k] = (p as any)[k] + v;
      }
    }
    p.earthDependencyPct = Math.max(0, Math.min(100, p.earthDependencyPct));
    p.independencePressure = Math.max(0, Math.min(1, p.independencePressure));
    this.state.eventLog.push(...events);
  }

  /** Apply personality drift to all promoted colonists. */
  applyDrift(commanderHexaco: HexacoProfile, outcome: TurnOutcome | null, timeDelta: number): void {
    applyPersonalityDrift(
      this.state.agents, commanderHexaco, outcome, timeDelta,
      this.state.metadata.currentTurn, this.state.metadata.currentTime,
    );
  }

  /** Apply featured colonist updates from department reports. */
  applyAgentUpdates(updates: Array<{ agentId: string; health?: Partial<Agent['health']>; career?: Partial<Agent['career']>; narrativeEvent?: string }>): void {
    for (const u of updates) {
      const col = this.findAgent(u.agentId);
      if (!col || !col.health.alive) continue;

      if (u.health) {
        if (u.health.psychScore !== undefined) {
          col.health.psychScore = Math.max(0, Math.min(1, u.health.psychScore));
        }
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
