/**
 * Measurement: can two opposite leaders end a run differently, in every
 * scenario the repository bundles and in a scenario the compiler emits?
 *
 * For each scenario and each of 61 seeds this drives the scenario's kernel
 * the way the orchestrator's turn loop does, with two decision streams and
 * no model call:
 *
 * - one event a turn (or two, in the sensitivity pass): the scenario's own
 *   milestone where it has one for the turn, with the category the
 *   orchestrator forces on it; otherwise a stand-in for the director's
 *   event, whose category is drawn from the scenario's own category tables
 *   on a stream of the seed (the same category for both streams), with two
 *   options, one marked risky, and a declared chance of 0.5;
 * - the "bold" stream always takes the risky option and the "safe" stream
 *   always takes a safe one;
 * - each outcome is drawn as the orchestrator draws it
 *   (`new SeededRng(seed).turnSeed(turn * 100 + ei)` against the chosen
 *   option's own chance, `classifyOutcomeById`), and the event's category
 *   table is applied with `applyOutcomeEffects` and the scenario's politics
 *   hook, with the orchestrator's noise draw, no personality bonus (a
 *   leader with every trait at one half), no tool modifiers and no adopted
 *   department effects.
 *
 * So the two streams differ in the option alone. It prints, for each
 * scenario, run shape and variant, on how many of the 61 seeds the two
 * streams end with different final metrics, different verdict score
 * inputs, a different mortality line, different death records and
 * different dead sets, with deaths a run for each stream.
 *
 * Variants set `sustains` marks and `setup.mortalityDice` on a copy of the
 * scenario, to measure what each does. Nothing here is merged.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { SeededRng } from '../src/engine/core/rng.js';
import { classifyOutcomeById, supplyLevel } from '../src/engine/core/progression.js';
import type { SimulationState } from '../src/engine/core/state.js';
import { EffectRegistry, type TurnOutcome } from '../src/engine/registries/effects.js';
import { lunarScenario, marsScenario } from '../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../src/engine/types.js';
import { compileScenario } from '../src/engine/compiler/index.js';
import { DraftScenarioSchema } from '../src/engine/compiler/compile-from-seed.js';
import { createCompilerTelemetry } from '../src/engine/compiler/telemetry.js';
import { applyOutcomeEffects } from '../src/runtime/orchestrator/outcome-effects.js';
import { loadDiskCustomScenarios } from '../src/cli/custom-scenarios.js';
import { scenarioKeyPersonnel } from '../src/cli/sim-config.js';
import { differingStateRows, formatScoreValue, scenarioScoreRows } from '../src/cli/verdict-scores.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const PART = process.env.PART ?? 'all';

type Stream = 'bold' | 'safe';

interface Variant {
  name: string;
  /** undefined: as the scenario ships. A list: exactly these keys marked `sustains`. */
  sustains?: string[];
  /** undefined: as the scenario ships. */
  dice?: 'year' | 'life';
}

interface Shape { name: string; population: number; turns: number }

interface StreamEvent {
  category: string;
  options: Array<{ id: string; isRisky: boolean }>;
  riskyOptionId: string;
  riskSuccessProbability: number;
  milestone: boolean;
}

/** A copy of `sc` with a variant's marks and dice; hooks are shared. */
function withVariant(sc: ScenarioPackage, v: Variant): ScenarioPackage {
  const world = (sc.world ?? {}) as Record<string, Record<string, Record<string, unknown>> | undefined>;
  const mark = (bag: Record<string, Record<string, unknown>> | undefined) => Object.fromEntries(
    Object.entries(bag ?? {}).map(([key, def]) => {
      if (v.sustains === undefined) return [key, def];
      const { sustains: _dropped, ...rest } = def as { sustains?: unknown };
      void _dropped;
      return [key, v.sustains.includes(key) ? { ...rest, sustains: true } : rest];
    }),
  );
  const setup = { ...sc.setup } as Record<string, unknown>;
  if (v.dice) setup.mortalityDice = v.dice;
  return {
    ...sc,
    setup,
    world: { ...world, metrics: mark(world.metrics), capacities: mark(world.capacities) },
  } as unknown as ScenarioPackage;
}

/** The events of one turn: the scenario's milestone, or stand-ins for the director's. */
function eventsFor(sc: ScenarioPackage, registry: EffectRegistry, seed: number, turn: number, maxTurns: number, perTurn: number): StreamEvent[] {
  const milestone = sc.hooks?.getMilestoneEvent?.(turn, maxTurns) as
    | { options: Array<{ id: string; isRisky: boolean }>; riskyOptionId: string; riskSuccessProbability: number; category: string }
    | null | undefined;
  if (milestone) {
    // As the orchestrator: a milestone takes the first or the last category the knowledge bundle maps.
    const keys = Object.keys(sc.knowledge?.categoryMapping ?? {});
    const category = keys.length > 0 ? (turn === 1 ? keys[0] : keys[keys.length - 1]) : milestone.category;
    return [{ category, options: milestone.options, riskyOptionId: milestone.riskyOptionId, riskSuccessProbability: milestone.riskSuccessProbability, milestone: true }];
  }
  const cats = registry.categories();
  const pool = cats.length > 0 ? cats : ['general'];
  return Array.from({ length: perTurn }, (_, ei) => {
    const pick = new SeededRng(seed).turnSeed(turn * 100 + ei + 77);
    return {
      category: pool[pick.int(0, pool.length - 1)],
      options: [{ id: 'option_a', isRisky: false }, { id: 'option_b', isRisky: true }],
      riskyOptionId: 'option_b',
      riskSuccessProbability: 0.5,
      milestone: false,
    };
  });
}

interface RunResult { state: SimulationState; outcomes: TurnOutcome[] }

/** One run: `stream` null advances the kernel with no decisions. */
function run(sc: ScenarioPackage, seed: number, shape: Shape, stream: Stream | null, perTurn: number): RunResult {
  const start = sc.setup?.defaultStartTime ?? 1;
  const unitsPerTurn = sc.setup?.defaultTimePerTurn ?? 1;
  const kernel = new SimulationKernel(seed, 'Leader', scenarioKeyPersonnel(sc), { startTime: start, initialPopulation: shape.population, scenario: sc });
  const registry = EffectRegistry.forScenario(sc);
  const outcomes: TurnOutcome[] = [];
  for (let turn = 1; turn <= shape.turns; turn++) {
    const time = start + (turn - 1) * unitsPerTurn;
    kernel.advanceTurn(turn, time, sc.hooks?.progressionHook);
    if (!stream) continue;
    const events = eventsFor(sc, registry, seed, turn, shape.turns, perTurn);
    events.forEach((ev, ei) => {
      const optionId = stream === 'bold' ? ev.riskyOptionId : (ev.options.find(o => !o.isRisky) ?? ev.options[0]).id;
      const outcome = classifyOutcomeById(optionId, ev.options, ev.riskSuccessProbability, kernel.getState().metrics, new SeededRng(seed).turnSeed(turn * 100 + ei));
      const noise = new SeededRng(seed).turnSeed(turn * 100 + ei + 50).next() * 0.2 - 0.1;
      applyOutcomeEffects(kernel, registry, {
        category: ev.category,
        outcome,
        modifiers: { personalityBonus: 0, noise },
        turn,
        time,
        politicsHook: sc.hooks?.politicsHook,
      });
      outcomes.push(outcome);
    });
  }
  return { state: kernel.getState(), outcomes };
}

const deaths = (s: SimulationState) => s.eventLog.filter(e => e.type === 'death');
const records = (s: SimulationState) => deaths(s).map(e => `${e.agentId}|${e.time}|${e.cause}`).sort();
const deadIds = (s: SimulationState) => deaths(s).map(e => String(e.agentId)).sort();
const causeClass = (cause: string | undefined) => {
  const c = cause ?? 'unknown';
  if (c.startsWith('accident')) return 'accident';
  if (c === 'natural causes' || c === 'age-related complications') return 'age';
  return c;
};
/** The mortality line the verdict judge reads: how many died, by cause. */
function mortalityLine(s: SimulationState): string {
  const counts: Record<string, number> = {};
  for (const d of deaths(s)) {
    const key = (d.cause ?? 'unknown').startsWith('accident:') ? 'accident' : (d.cause ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts).sort().map(([k, n]) => `${n} ${k}`).join(', ') || 'no deaths';
}
const worldJson = (s: SimulationState) => JSON.stringify({ metrics: s.metrics, politics: s.politics, statuses: s.statuses });
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** The pair of streams over the seeds: the counts the table reports. */
function measure(label: string, sc: ScenarioPackage, shape: Shape, variant: Variant, perTurn: number): Record<string, unknown> {
  const v = withVariant(sc, variant);
  let metricsDiffer = 0, scoresDiffer = 0, mortalityDiffer = 0, recordsDiffer = 0, deadDiffer = 0, anyDeath = 0, sameStreamDiffer = 0;
  let deathsBold = 0, deathsSafe = 0, onlyBold = 0, onlySafe = 0, birthsBold = 0, birthsSafe = 0, levelBold = 0, levelSafe = 0;
  const keyDiffer: Record<string, number> = {};
  const scoreDiffer: Record<string, number> = {};
  const causes: Record<Stream, Record<string, number>> = { bold: {}, safe: {} };
  const outcomeCounts: Record<Stream, Record<string, number>> = { bold: {}, safe: {} };
  let scoreIds: string[] = [];
  for (const seed of SEEDS) {
    const bold = run(v, seed, shape, 'bold', perTurn);
    const safe = run(v, seed, shape, 'safe', perTurn);
    // The same stream twice must end the same: the harness adds no randomness of its own.
    if (seed === SEEDS[0] && JSON.stringify(run(v, seed, shape, 'safe', perTurn).state) !== JSON.stringify(safe.state)) sameStreamDiffer++;
    const a = bold.state, b = safe.state;
    if (worldJson(a) !== worldJson(b)) metricsDiffer++;
    for (const bag of ['metrics', 'politics'] as const) {
      for (const key of new Set([...Object.keys(a[bag]), ...Object.keys(b[bag])])) {
        if (JSON.stringify((a[bag] as Record<string, unknown>)[key]) !== JSON.stringify((b[bag] as Record<string, unknown>)[key])) keyDiffer[key] = (keyDiffer[key] ?? 0) + 1;
      }
    }
    const rows = scenarioScoreRows(v, [a, b]);
    scoreIds = rows.map(r => r.id);
    const differing = rows.filter(r => formatScoreValue(r.values[0], r.format) !== formatScoreValue(r.values[1], r.format));
    for (const r of differing) scoreDiffer[r.id] = (scoreDiffer[r.id] ?? 0) + 1;
    if (differing.length > 0 || differingStateRows(v, [a, b]).length > 0) scoresDiffer++;
    if (mortalityLine(a) !== mortalityLine(b)) mortalityDiffer++;
    const ra = records(a), rb = records(b);
    if (ra.join('\n') !== rb.join('\n')) recordsDiffer++;
    const da = deadIds(a), db = deadIds(b);
    if (da.join('\n') !== db.join('\n')) deadDiffer++;
    if (da.length + db.length > 0) anyDeath++;
    deathsBold += da.length; deathsSafe += db.length;
    onlyBold += da.filter(id => !db.includes(id)).length;
    onlySafe += db.filter(id => !da.includes(id)).length;
    birthsBold += a.eventLog.filter(e => e.type === 'birth').length;
    birthsSafe += b.eventLog.filter(e => e.type === 'birth').length;
    levelBold += supplyLevel(a.metrics, a.metadata.landingSupplies);
    levelSafe += supplyLevel(b.metrics, b.metadata.landingSupplies);
    for (const d of deaths(a)) causes.bold[causeClass(d.cause)] = (causes.bold[causeClass(d.cause)] ?? 0) + 1;
    for (const d of deaths(b)) causes.safe[causeClass(d.cause)] = (causes.safe[causeClass(d.cause)] ?? 0) + 1;
    for (const o of bold.outcomes) outcomeCounts.bold[o] = (outcomeCounts.bold[o] ?? 0) + 1;
    for (const o of safe.outcomes) outcomeCounts.safe[o] = (outcomeCounts.safe[o] ?? 0) + 1;
  }
  const n = SEEDS.length;
  const probe = run(v, SEEDS[0], shape, null, perTurn).state;
  return {
    label, shape: shape.name, population: shape.population, turns: shape.turns, variant: variant.name, eventsPerTurn: perTurn, seeds: n,
    metricsDiffer, scoresDiffer, mortalityDiffer, recordsDiffer, deadDiffer, anyDeath, sameStreamDiffer,
    deathsBold: round(deathsBold / n), deathsSafe: round(deathsSafe / n),
    onlyBold: round(onlyBold / n), onlySafe: round(onlySafe / n),
    birthsBold: round(birthsBold / n), birthsSafe: round(birthsSafe / n),
    supplyLevelBold: round(levelBold / n, 3), supplyLevelSafe: round(levelSafe / n, 3),
    causesBold: causes.bold, causesSafe: causes.safe,
    outcomesBold: outcomeCounts.bold, outcomesSafe: outcomeCounts.safe,
    keyDiffer, scoreIds, scoreDiffer,
    landingSupplies: Object.keys(probe.metadata.landingSupplies ?? {}),
    mortalityDice: probe.metadata.mortalityDice ?? 'year',
  };
}

/** One hash of every final state of a run with no decisions, over the seeds. */
function noDecisionHash(sc: ScenarioPackage, shape: Shape, variant: Variant): { sha: string; deaths: number; births: number } {
  const v = withVariant(sc, variant);
  const all = createHash('sha256');
  let d = 0, b = 0;
  for (const seed of SEEDS) {
    const state = run(v, seed, shape, null, 1).state;
    // The declared scenario differs between variants in its marks only; the state's own record of them is left out of the hash.
    const { landingSupplies: _l, mortalityDice: _m, ...metadata } = state.metadata;
    void _l; void _m;
    all.update(JSON.stringify({ ...state, metadata, agents: state.agents.map(a => ({ ...a, health: { ...a.health, survival: undefined } })) }));
    d += deaths(state).length;
    b += state.eventLog.filter(e => e.type === 'birth').length;
  }
  return { sha: all.digest('hex').slice(0, 16), deaths: d, births: b };
}

/** What a scenario's kernel holds and what the run reads, printed once. */
function describe(label: string, sc: ScenarioPackage, shape: Shape): void {
  const start = sc.setup?.defaultStartTime ?? 1;
  const kernel = new SimulationKernel(SEEDS[0], 'Leader', scenarioKeyPersonnel(sc), { startTime: start, initialPopulation: shape.population, scenario: sc });
  const state = kernel.getState();
  const registry = EffectRegistry.forScenario(sc);
  const unitsPerTurn = sc.setup?.defaultTimePerTurn ?? 1;
  const yearsPerUnit = state.metadata.yearsPerUnit ?? 1;
  const declared = (Array.isArray(sc.metrics) ? sc.metrics : []).map(m => m.id);
  const held = Object.keys(state.metrics);
  const ages = state.agents.map(a => (start - a.core.birthTime) * yearsPerUnit);
  console.log(`DESCRIBE ${JSON.stringify({
    label, id: sc.id, shape: shape.name, population: state.agents.length, turns: shape.turns,
    unit: sc.labels?.timeUnitNoun, unitsPerTurn, yearsPerUnit: round(yearsPerUnit, 5), yearsSpanned: round((shape.turns - 1) * unitsPerTurn * yearsPerUnit, 3),
    metricsHeld: held, politicsHeld: Object.keys(state.politics),
    declaredScores: declared, declaredScoresHeld: declared.filter(id => held.includes(id)),
    categories: registry.categories(),
    milestoneTurn1: !!sc.hooks?.getMilestoneEvent?.(1, shape.turns), milestoneLast: !!sc.hooks?.getMilestoneEvent?.(shape.turns, shape.turns),
    progressionHook: typeof sc.hooks?.progressionHook === 'function',
    firstAndLastEvent: [1, shape.turns].map(turn => eventsFor(sc, registry, SEEDS[0], turn, shape.turns, 1).map(e => ({ milestone: e.milestone, category: e.category, chance: e.riskSuccessProbability, inTables: registry.categories().includes(e.category) }))[0]),
    landingSupplies: state.metadata.landingSupplies ?? null, mortalityDice: state.metadata.mortalityDice ?? 'year',
    ageMin: Math.round(Math.min(...ages)), ageMax: Math.round(Math.max(...ages)),
  })}`);
}

const disk = loadDiskCustomScenarios(resolve(here, '../scenarios'));
const fromDisk = (id: string) => {
  const sc = disk.get(id)?.scenario as ScenarioPackage | undefined;
  if (!sc) throw new Error(`scenarios/ holds no ${id}`);
  return sc;
};
const station = fromDisk('deep-ocean-station');
const atlas = fromDisk('atlas-lab');
const corporate = fromDisk('corporate-quarterly');
const council = fromDisk('dual-superintelligence-council');

/** A model that returns no hook: every compiled hook is the compiler's own fallback. No model is called. */
const noHook = async () => 'not a hook';

/** The Digital Twin, compiled as the server compiles it, with the fallback hooks. */
const twin = await compileScenario(JSON.parse(readFileSync(resolve(here, '../scenarios/t2d-glp1-protocol.json'), 'utf-8')), { cache: false, generateText: noHook });

/** The seed draft tests/engine/progression-time-scale.test.ts compiles: what compile-from-seed emits. */
const ORCHARD_DRAFT = {
  id: 'orchard-seasons',
  labels: { name: 'Orchard', populationNoun: 'growers', settlementNoun: 'orchard', timeUnitNoun: 'season' },
  setup: { defaultTurns: 4, defaultPopulation: 20, defaultStartTime: 1, yearsPerTimeUnit: 0.25 },
  departments: [
    { id: 'growing', label: 'Growing', role: 'Head Grower', instructions: 'Weigh the harvest against the soil.' },
    { id: 'market', label: 'Market', role: 'Market Lead', instructions: 'Weigh prices against the stock.' },
  ],
  metrics: [
    { id: 'harvest', format: 'number' },
    { id: 'soil-health', format: 'percent' },
  ],
};
const orchard = await compileScenario(DraftScenarioSchema.parse(ORCHARD_DRAFT) as unknown as Record<string, unknown>, { cache: false, generateText: noHook });

/**
 * The same draft with what a compiled world would need to hold its own
 * scores: a `world` that declares them with starting values, and a
 * category table over them. Hand-written here to measure the mechanism;
 * the compiler emits neither today.
 */
const ORCHARD_WITH_WORLD = {
  ...ORCHARD_DRAFT,
  id: 'orchard-seasons-world',
  metrics: [
    { id: 'harvest', label: 'Harvest', source: 'metrics.harvest', format: 'number' },
    { id: 'soil-health', label: 'Soil health', source: 'metrics.soil-health', format: 'percent' },
  ],
  world: {
    metrics: {
      population: { id: 'population', label: 'Growers', unit: 'people', type: 'number', initial: 20, min: 0, category: 'metric' },
      morale: { id: 'morale', label: 'Morale', unit: '%', type: 'number', initial: 0.8, min: 0, max: 1, category: 'metric' },
      harvest: { id: 'harvest', label: 'Harvest', unit: 'tonnes', type: 'number', initial: 100, min: 0, category: 'metric' },
      'soil-health': { id: 'soil-health', label: 'Soil health', unit: '%', type: 'number', initial: 0.6, min: 0, max: 1, category: 'metric' },
    },
    capacities: {}, statuses: {}, politics: {}, environment: {},
  },
  effects: {
    growing: { harvest: 12, 'soil-health': -0.03 },
    market: { harvest: -6, morale: 0.05 },
    soil: { 'soil-health': 0.05, harvest: -4 },
  },
  knowledge: { topics: {}, categoryMapping: { growing: [], market: [], soil: [] } },
};
const orchardWorld = await compileScenario(ORCHARD_WITH_WORLD as unknown as Record<string, unknown>, { cache: false, generateText: noHook });

/** A raw JSON draft that marks a supply and declares its dice, through `compileScenario`: do the marks reach the kernel? */
const orchardMarked = await compileScenario({
  ...ORCHARD_WITH_WORLD,
  id: 'orchard-seasons-marked',
  setup: { ...ORCHARD_DRAFT.setup, mortalityDice: 'life' },
  world: { ...ORCHARD_WITH_WORLD.world, metrics: { ...ORCHARD_WITH_WORLD.world.metrics, harvest: { ...ORCHARD_WITH_WORLD.world.metrics.harvest, sustains: true } } },
} as unknown as Record<string, unknown>, { cache: false, generateText: noHook });
/** The same marks on a seed draft, through the schema compile-from-seed validates with. */
const seedDraftParsed = DraftScenarioSchema.parse({
  ...ORCHARD_DRAFT,
  setup: { ...ORCHARD_DRAFT.setup, mortalityDice: 'life' },
  metrics: [{ id: 'harvest', format: 'number', sustains: true }, { id: 'soil-health', format: 'percent' }],
}) as unknown as { setup: Record<string, unknown>; metrics: Array<Record<string, unknown>> };

/**
 * The deep-ocean station compiled from its JSON draft with the hooks
 * tests/engine/compiler/integration.test.ts has a stand-in model return:
 * a progression hook that runs in the compiler's sandbox each step.
 */
const stationCompiled = await compileScenario(JSON.parse(readFileSync(resolve(here, '../scenarios/submarine.json'), 'utf-8')), {
  cache: false,
  generateText: async (promptOrOptions) => {
    const prompt = typeof promptOrOptions === 'string'
      ? promptOrOptions
      : [...(promptOrOptions.system ?? []).map(s => s.text), promptOrOptions.prompt].join('\n');
    if (prompt.includes('progression hook')) {
      return `(ctx) => {
      for (const c of ctx.agents) {
        if (!c.health.alive) continue;
        c.health.psychScore = Math.max(0.1, c.health.psychScore - 0.02 * ctx.timeDelta);
        c.health.boneDensityPct = Math.max(60, c.health.boneDensityPct - 0.2 * ctx.timeDelta);
      }
    }`;
    }
    if (prompt.includes('politics hook')) {
      return `(category, outcome) => {
      if (category !== 'communications' && category !== 'scientific') return null;
      return outcome.includes('success') ? { fundingConfidence: 5, autonomyLevel: 3 } : { fundingConfidence: -3, autonomyLevel: -2 };
    }`;
    }
    return 'not a hook';
  },
});

const demo = (sc: ScenarioPackage): Shape => ({ name: 'demo', population: Math.min(sc.setup?.defaultPopulation ?? 30, 30), turns: Math.min(sc.setup?.defaultTurns ?? 6, 6) });
const full = (sc: ScenarioPackage): Shape => ({ name: 'default', population: sc.setup?.defaultPopulation ?? 30, turns: sc.setup?.defaultTurns ?? 6 });
const long = (turns: number): Shape => ({ name: `${turns} turns`, population: 30, turns });

const SHIPPED: Variant = { name: 'as shipped' };
const FIVE = ['powerKw', 'waterLitersPerDay', 'pressurizedVolumeM3', 'infrastructureModules', 'lifeSupportCapacity'];
const STATION_SUPPLIES = ['powerKw', 'hullIntegrity', 'oxygenReserveHours'];
const fourWays = (keys: string[]): Variant[] => [
  { name: 'no marks, a die a year', sustains: [], dice: 'year' },
  { name: 'supplies marked, a die a year', sustains: keys, dice: 'year' },
  { name: 'no marks, a die for life', sustains: [], dice: 'life' },
  { name: 'supplies marked, a die for life', sustains: keys, dice: 'life' },
];

interface Plan { label: string; sc: ScenarioPackage; shapes: Shape[]; variants: Variant[] }
const PLANS: Plan[] = [
  { label: 'Mars Genesis', sc: marsScenario, shapes: [demo(marsScenario), full(marsScenario)], variants: [SHIPPED, ...fourWays(FIVE)] },
  { label: 'Lunar Outpost', sc: lunarScenario, shapes: [demo(lunarScenario), full(lunarScenario), long(20)], variants: [SHIPPED, ...fourWays(FIVE)] },
  { label: 'Deep Ocean Station', sc: station, shapes: [demo(station), full(station), long(20)], variants: [SHIPPED, ...fourWays(STATION_SUPPLIES), { name: 'supplies and food marked, a die for life', sustains: [...STATION_SUPPLIES, 'foodMonthsReserve'], dice: 'life' }] },
  { label: 'Deep Ocean Station, compiled with a sandboxed progression hook', sc: stationCompiled, shapes: [demo(stationCompiled)], variants: [SHIPPED, { name: 'supplies marked, a die for life', sustains: STATION_SUPPLIES, dice: 'life' }] },
  { label: 'Atlas Lab', sc: atlas, shapes: [demo(atlas), full(atlas)], variants: [SHIPPED, { name: 'wrong marks: runwayMonths and burnRate, a die for life', sustains: ['runwayMonths', 'burnRate'], dice: 'life' }] },
  { label: 'Q-Scope Corp (corporate quarterly)', sc: corporate, shapes: [demo(corporate), full(corporate)], variants: [SHIPPED, { name: 'wrong marks: revenueArr and runwayMonths, a die for life', sustains: ['revenueArr', 'runwayMonths'], dice: 'life' }, { name: 'wrong mark: burnRate, a die for life', sustains: ['burnRate'], dice: 'life' }] },
  { label: 'Dual Superintelligence Council', sc: council, shapes: [demo(council)], variants: [SHIPPED] },
  { label: 'Digital Twin (T2D + GLP-1 Care)', sc: twin, shapes: [demo(twin)], variants: [SHIPPED] },
  { label: 'compiled from a seed draft (orchard-seasons)', sc: orchard, shapes: [demo(orchard)], variants: [SHIPPED, { name: 'a die for life', dice: 'life' }] },
  { label: 'the same draft with a world and a category table (hand-written)', sc: orchardWorld, shapes: [demo(orchardWorld), long(40)], variants: [SHIPPED, { name: 'harvest marked, a die for life', sustains: ['harvest'], dice: 'life' }] },
];

if (PART === 'all' || PART === 'describe') {
  for (const p of PLANS) for (const shape of p.shapes) describe(p.label, p.sc, shape);
  // Do marks written in a draft reach the kernel?
  const k = new SimulationKernel(1, 'Leader', [], { startTime: 1, initialPopulation: 20, scenario: orchardMarked });
  console.log(`MARKS raw JSON draft through compileScenario: ${JSON.stringify({ landingSupplies: k.getState().metadata.landingSupplies ?? null, mortalityDice: k.getState().metadata.mortalityDice ?? 'year' })}`);
  console.log(`MARKS seed draft through DraftScenarioSchema: ${JSON.stringify({ setupKeys: Object.keys(seedDraftParsed.setup), metricKeys: seedDraftParsed.metrics.map(m => Object.keys(m)) })}`);
  console.log(`MARKS compiled seed draft: ${JSON.stringify({ world: orchard.world, effects: orchard.effects, setup: orchard.setup, metrics: orchard.metrics })}`);
}

if (PART === 'all' || PART === 'describe') {
  // Which hooks does a compile keep when the model returns working ones? A
  // stand-in model returns a valid function for each code hook; the compiler's
  // own smoke tests decide whether it is kept.
  const standIn = async (promptOrOptions: string | { system?: Array<{ text: string }>; prompt: string }) => {
    const prompt = typeof promptOrOptions === 'string'
      ? promptOrOptions
      : [...(promptOrOptions.system ?? []).map(s => s.text), promptOrOptions.prompt].join('\n');
    if (prompt.includes('timeline fingerprint hook')) return `(finalState, outcomeLog, leader, toolRegs, maxTurns) => ({ posture: 'steady', summary: 'steady' })`;
    if (prompt.includes('department prompt hook')) return `(ctx) => ['[' + ctx.department + '] nominal']`;
    if (prompt.includes('reaction context hook')) return `(agent, ctx) => 'steady'`;
    if (prompt.includes('politics hook')) return `(category, outcome) => null`;
    if (prompt.includes('progression hook')) return `(ctx) => { for (const c of ctx.agents) { if (!c.health.alive) continue; } }`;
    return 'not a hook';
  };
  for (const [name, draft] of [
    ['seed draft (no world)', DraftScenarioSchema.parse(ORCHARD_DRAFT)],
    ['the same draft with a world', ORCHARD_WITH_WORLD],
  ] as const) {
    const telemetry = createCompilerTelemetry();
    await compileScenario(draft as unknown as Record<string, unknown>, { cache: false, generateText: standIn, telemetry });
    const snap = telemetry.snapshot();
    console.log(`COMPILE ${name}: ${JSON.stringify({ hooks: snap.schemaRetries, fallbacks: snap.fallbacks.map(f => ({ hook: f.hookName, attempts: f.attempts, reason: f.reason })) })}`);
  }
}

if (PART === 'all' || PART === 'streams') {
  for (const p of PLANS) for (const shape of p.shapes) for (const variant of p.variants) {
    console.log(`ROW ${JSON.stringify(measure(p.label, p.sc, shape, variant, 1))}`);
  }
}

if (PART === 'all' || PART === 'two-events') {
  // Sensitivity: two events in each turn that has no milestone.
  for (const p of PLANS) console.log(`ROW ${JSON.stringify(measure(p.label, p.sc, p.shapes[0], p.variants[0], 2))}`);
}

if (PART === 'all' || PART === 'hash') {
  // What a variant changes in a run with no decisions.
  for (const p of PLANS.slice(0, 3)) for (const shape of p.shapes) for (const variant of p.variants) {
    const h = noDecisionHash(p.sc, shape, variant);
    console.log(`HASH ${JSON.stringify({ label: p.label, shape: shape.name, variant: variant.name, ...h })}`);
  }
}
