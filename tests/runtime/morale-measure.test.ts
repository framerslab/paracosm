/**
 * MEASUREMENT ONLY. Not for merge.
 *
 * Prints what morale does in Mars Genesis runs and under candidate changes.
 * Every line starts with `MM|`.
 *
 * The decisions are the ones the two live pairs made (8 November 2026 and
 * 10 November 2026, seed 950, six turns of eight years, 30 people), read
 * from the run log's `[policy] effects ... asked:` lines and the stream's
 * `outcome` events. `bonus` is how far the outcome's strength stood from
 * its own multiplier, read from the effects on keys no ceiling stopped.
 */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario, lunarScenario } from '../../src/engine/scenarios/index.js';
import { EffectRegistry, type TurnOutcome } from '../../src/engine/registries/effects.js';
import { applyCommanderPolicy, type PolicyEffectTables } from '../../src/runtime/orchestrator/commander-policy.js';
import { applyOutcomeEffects } from '../../src/runtime/orchestrator/outcome-effects.js';
import { emptyReport } from '../../src/runtime/util/parsers.js';
import { CommanderDecisionSchema } from '../../src/runtime/validators/commander.js';
import { scenarioKeyPersonnel } from '../../src/cli/sim-config.js';
import type { CommanderDecision, DepartmentReport } from '../../src/runtime/contracts.js';
import type { ProgressionHookContext, ScenarioPackage } from '../../src/engine/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const hook = marsScenario.hooks.progressionHook!;
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';

interface Live { turn: number; category: string; outcome: TurnOutcome; bonus: number; asked: Record<string, number> }
type Promotion = [id: string, department: string, role: string];

const P6_DIETRICH: Live[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.2176, asked: { powerKw: -10, waterLitersPerDay: 400, pressurizedVolumeM3: 500, lifeSupportCapacity: 30, infrastructureModules: 3, scienceOutput: 1, morale: 0.05, earthDependencyPct: -5, independencePressure: 0.07 } },
  { turn: 2, category: 'resource', outcome: 'conservative_failure', bonus: 0.0949, asked: { powerKw: -5, foodMonthsReserve: 0.3, infrastructureModules: 1, morale: 0.01, independencePressure: 0.05 } },
  { turn: 2, category: 'medical', outcome: 'conservative_success', bonus: 0.13, asked: { powerKw: -12, pressurizedVolumeM3: 120, infrastructureModules: 1, scienceOutput: 1, morale: 0.16, earthDependencyPct: -3, independencePressure: 0.05 } },
  { turn: 3, category: 'environmental', outcome: 'conservative_success', bonus: 0.1286, asked: { powerKw: -8, morale: 0.25, scienceOutput: 1, infrastructureModules: 1, earthDependencyPct: -3, independencePressure: 0.03 } },
  { turn: 4, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.1118, asked: { powerKw: -5.5, lifeSupportCapacity: 2, infrastructureModules: 1, scienceOutput: 1, morale: 0.28, earthDependencyPct: -4, independencePressure: 0.03 } },
  { turn: 5, category: 'resource', outcome: 'conservative_success', bonus: 0.1228, asked: { powerKw: -8, morale: 0.12, scienceOutput: 2, foodMonthsReserve: 0.2, earthDependencyPct: -4, independencePressure: 0.01 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.0558, asked: { scienceOutput: 1, morale: 0.04, earthDependencyPct: -2, independencePressure: 0.03 } },
];
const P6_ARIA: Live[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.2212, asked: { lifeSupportCapacity: 20, pressurizedVolumeM3: 300, infrastructureModules: 1, morale: 0.07, waterLitersPerDay: 200, earthDependencyPct: -2, independencePressure: 0.07 } },
  { turn: 2, category: 'infrastructure', outcome: 'conservative_failure', bonus: 0.1073, asked: { morale: 0.2, independencePressure: 0.03 } },
  { turn: 3, category: 'resource', outcome: 'conservative_success', bonus: 0.0889, asked: { lifeSupportCapacity: 8, morale: 0.22, infrastructureModules: 1, independencePressure: 0.04 } },
  { turn: 4, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.1026, asked: { infrastructureModules: 1, scienceOutput: 1, morale: 0.24, independencePressure: 0.04 } },
  { turn: 5, category: 'environmental', outcome: 'conservative_success', bonus: 0.1914, asked: { pressurizedVolumeM3: 50, infrastructureModules: 3, morale: 0.38, independencePressure: 0.07 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.1598, asked: { lifeSupportCapacity: 10, pressurizedVolumeM3: 200, morale: 0.12, infrastructureModules: 1, scienceOutput: 0.05, earthDependencyPct: -6, independencePressure: 0.1 } },
];
const P7_ARIA: Live[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.2212, asked: { pressurizedVolumeM3: 500, lifeSupportCapacity: 20, powerKw: 40, waterLitersPerDay: 200, infrastructureModules: 1, morale: 0.02, earthDependencyPct: -5, independencePressure: 0.02 } },
  { turn: 2, category: 'resource', outcome: 'conservative_failure', bonus: 0.154, asked: { waterLitersPerDay: -300, lifeSupportCapacity: -5, foodMonthsReserve: 1.5, earthDependencyPct: 2, independencePressure: 0.03 } },
  { turn: 3, category: 'medical', outcome: 'conservative_success', bonus: 0.142, asked: { waterLitersPerDay: -90, lifeSupportCapacity: -3, powerKw: -17, morale: 0.08, scienceOutput: 2, foodMonthsReserve: 0.8, independencePressure: 0.03 } },
  { turn: 4, category: 'resource', outcome: 'conservative_success', bonus: 0.1594, asked: { powerKw: -45, waterLitersPerDay: -105, lifeSupportCapacity: -4, scienceOutput: 4, morale: 0.05, earthDependencyPct: -1, independencePressure: 0.02 } },
  { turn: 5, category: 'environmental', outcome: 'conservative_success', bonus: 0.2056, asked: { powerKw: -24, lifeSupportCapacity: -2, waterLitersPerDay: -70, foodMonthsReserve: 1.2, morale: 0.1, scienceOutput: 3, earthDependencyPct: -2, independencePressure: 0.05 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.1738, asked: { waterLitersPerDay: 120, powerKw: -35, lifeSupportCapacity: 8, morale: 0.03, infrastructureModules: 1, earthDependencyPct: -3, independencePressure: 0.02 } },
];
const P7_DIETRICH: Live[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.1854, asked: { powerKw: 80, waterLitersPerDay: 450, morale: 0.06, infrastructureModules: 1, lifeSupportCapacity: 20, pressurizedVolumeM3: 500, earthDependencyPct: -7 } },
  { turn: 2, category: 'medical', outcome: 'conservative_failure', bonus: 0.134, asked: { powerKw: -15, morale: 0.02, lifeSupportCapacity: 15, pressurizedVolumeM3: 120, earthDependencyPct: -3, independencePressure: 0.03 } },
  { turn: 3, category: 'resource', outcome: 'conservative_success', bonus: 0.2006, asked: { waterLitersPerDay: -60, powerKw: -92, scienceOutput: 1, morale: 0.07, foodMonthsReserve: 0.3, earthDependencyPct: -5, independencePressure: 0.03 } },
  { turn: 4, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.1878, asked: { lifeSupportCapacity: 8, powerKw: -38, morale: 0.13, infrastructureModules: 1, earthDependencyPct: -5, independencePressure: 0.02 } },
  { turn: 4, category: 'medical', outcome: 'conservative_success', bonus: 0.096, asked: { morale: 0.07, powerKw: -10, lifeSupportCapacity: 3, earthDependencyPct: -2, independencePressure: 0.03 } },
  { turn: 5, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.2043, asked: { powerKw: -69, lifeSupportCapacity: 12, scienceOutput: -1, morale: 0.13, earthDependencyPct: -4, independencePressure: 0.01 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.0974, asked: { morale: 0.09, lifeSupportCapacity: 20, pressurizedVolumeM3: 400, scienceOutput: 5, infrastructureModules: 1, powerKw: -12, earthDependencyPct: -7, independencePressure: 0.08 } },
];

const HEADS_CARLOS: Promotion[] = [
  ['col-carlos-fernandez', 'medical', 'Chief Medical Officer'],
  ['col-bruno-morales', 'engineering', 'Chief Engineer'],
  ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'],
];
const HEADS_SVEN: Promotion[] = [
  ['col-sven-kim', 'medical', 'Chief Medical Officer'],
  ['col-bruno-morales', 'engineering', 'Chief Engineer'],
  ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'],
];

interface Pair { name: string; aria: Live[]; dietrich: Live[]; ariaHeads: Promotion[]; dietrichHeads: Promotion[] }
const PAIRS: Pair[] = [
  { name: 'pair of 8 Nov', aria: P6_ARIA, dietrich: P6_DIETRICH, ariaHeads: HEADS_CARLOS, dietrichHeads: HEADS_SVEN },
  { name: 'pair of 10 Nov', aria: P7_ARIA, dietrich: P7_DIETRICH, ariaHeads: HEADS_SVEN, dietrichHeads: HEADS_SVEN },
];

/** A candidate: the knee of eased gains, the yearly lift of a content colony, the scale of the Mars morale entries. */
interface Config { label: string; knee?: number; lift?: number; scale?: number }
const CONFIGS: Config[] = [
  { label: 'master' },
  { label: 'knee 0.9', knee: 0.9 },
  { label: 'knee 0.8', knee: 0.8 },
  { label: 'knee 0.6', knee: 0.6 },
  { label: 'fixed point 0.8 (lift 0.02)', lift: 0.02 },
  { label: 'fixed point 0.7 (lift 0.01)', lift: 0.01 },
  { label: 'fixed point 0.6 (lift 0)', lift: 0 },
  { label: 'mars morale entries x 1/3', scale: 1 / 3 },
  { label: 'mars morale entries x 1/5', scale: 1 / 5 },
];

const out: string[] = [];
const say = (line: string) => { out.push(`MM|${line}`); console.log(`MM|${line}`); };
const r4 = (x: number) => Math.round(x * 10000) / 10000;

const tablesByScale = new Map<number, { registry: EffectRegistry; tables: PolicyEffectTables }>();
function tablesFor(scale: number): { registry: EffectRegistry; tables: PolicyEffectTables } {
  const known = tablesByScale.get(scale);
  if (known) return known;
  const base = marsScenario.effects[0].categoryDefaults;
  const scaled = Object.fromEntries(Object.entries(base).map(([cat, t]) => [cat,
    Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === 'morale' && scale !== 1 ? Math.round(v * scale * 1000) / 1000 : v]))]));
  const registry = EffectRegistry.forScenario({ effects: [{ ...marsScenario.effects[0], categoryDefaults: scaled }], metrics: marsScenario.metrics });
  const made = { registry, tables: { registry, politicsHook: marsScenario.hooks.politicsHook, categories: Object.keys(marsScenario.knowledge?.categoryMapping ?? {}) } };
  tablesByScale.set(scale, made);
  return made;
}

function adopt(systemDelta: Record<string, number>) {
  const reports = [{
    ...emptyReport('engineering'),
    recommendedEffects: [{ id: 'effect_1', type: 'capacity_expansion', description: 'the effects the decision adopted', systemDelta }],
  } as unknown as DepartmentReport];
  const decision = CommanderDecisionSchema.parse({
    selectedOptionId: 'option_a',
    decision: 'the live decision',
    rationale: '',
    reasoning: '1) ...',
    selectedPolicies: ['engineering/effect_1'],
    rejectedPolicies: [],
    expectedTradeoffs: [],
    watchMetricsNextTurn: [],
  }) as unknown as CommanderDecision;
  return { reports, decision };
}

interface TurnRow { start: number; end: number; years: number[]; psychMean: number; psychMin: number; births: number; deaths: number; pairs: number; despair: number; applied: number[] }
interface Replay { rows: TurnRow[]; dead: Set<string>; final: number; births: number; pairs: number; deaths: number; despair: number }

function withConfig<T>(cfg: Config, fn: () => T): T {
  const g = globalThis as unknown as { __moraleKnee?: number; __psychLift?: number };
  g.__moraleKnee = cfg.knee;
  g.__psychLift = cfg.lift;
  try {
    return fn();
  } finally {
    g.__moraleKnee = undefined;
    g.__psychLift = undefined;
  }
}

/** Six Mars turns the way a hosted run takes them: progression, then each live event's policy step and outcome. */
function replay(seed: number, leader: string, heads: Promotion[], live: Live[], cfg: Config, change?: (l: Live) => Live): Replay {
  return withConfig(cfg, () => {
    const { registry, tables } = tablesFor(cfg.scale ?? 1);
    const kernel = new SimulationKernel(seed, leader, scenarioKeyPersonnel(marsScenario), { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
    for (const [id, department, role] of heads) kernel.promoteAgent(id, department as never, role, leader);
    const rows: TurnRow[] = [];
    for (const [turn, time] of TURNS) {
      const years: number[] = [];
      const watch = (ctx: ProgressionHookContext) => { years.push(ctx.metrics?.morale as number); hook(ctx); };
      const state = kernel.advanceTurn(turn, time, watch);
      const start = state.metrics.morale;
      const applied: number[] = [];
      for (const l of live.filter(x => x.turn === turn)) {
        const ev = change ? change(l) : l;
        const { reports, decision } = adopt(ev.asked);
        const policy = applyCommanderPolicy(kernel, decision, reports, turn, time, () => {}, tables);
        applied.push(policy.deltas.morale ?? 0);
        const effects = applyOutcomeEffects(kernel, registry, {
          category: ev.category, outcome: ev.outcome, modifiers: { personalityBonus: ev.bonus, noise: 0 }, turn, time,
          politicsHook: marsScenario.hooks.politicsHook,
        });
        applied.push(effects.systemDeltas.morale ?? 0);
      }
      const after = kernel.getState();
      const alive = after.agents.filter(a => a.health.alive);
      const mine = after.eventLog.filter(e => e.turn === turn);
      rows.push({
        start, end: after.metrics.morale, years,
        psychMean: alive.reduce((s, a) => s + a.health.psychScore, 0) / Math.max(1, alive.length),
        psychMin: alive.reduce((m, a) => Math.min(m, a.health.psychScore), 1),
        births: mine.filter(e => e.type === 'birth').length,
        deaths: mine.filter(e => e.type === 'death').length,
        pairs: mine.filter(e => e.type === 'relationship').length,
        despair: mine.filter(e => e.type === 'death' && e.cause === 'despair').length,
        applied,
      });
    }
    const end = kernel.getState();
    const sum = (k: 'births' | 'deaths' | 'pairs' | 'despair') => rows.reduce((s, r) => s + r[k], 0);
    return {
      rows, dead: new Set(end.agents.filter(a => !a.health.alive).map(a => a.core.id)), final: end.metrics.morale,
      births: sum('births'), pairs: sum('pairs'), deaths: sum('deaths'), despair: sum('despair'),
    };
  });
}

const differ = (a: Set<string>, b: Set<string>) => a.size !== b.size || [...a].some(id => !b.has(id));
const atOne = (x: number) => x >= 1 - 1e-9;

test('A. seed 950, the live decisions, master: morale each year and at each turn end', () => {
  for (const pair of PAIRS) {
    for (const [leader, live, heads] of [[ARIA, pair.aria, pair.ariaHeads], [DIETRICH, pair.dietrich, pair.dietrichHeads]] as Array<[string, Live[], Promotion[]]>) {
      const r = replay(950, leader, heads, live, CONFIGS[0]);
      r.rows.forEach((row, i) => {
        say(`A|${pair.name}|${leader}|turn ${i + 1}|start ${r4(row.start)}|end ${r4(row.end)}|applied ${row.applied.map(r4).join(',')}|years ${row.years.map(r4).join(',')}|psych mean ${r4(row.psychMean)} min ${r4(row.psychMin)}|births ${row.births} deaths ${row.deaths} pairs ${row.pairs} despair ${row.despair}`);
      });
      say(`A|${pair.name}|${leader}|dead ${r.dead.size}|births ${r.births}|pairs ${r.pairs}|final ${r4(r.final)}`);
    }
  }
});

test('B. seed 950, the live decisions, each candidate: turn ends', () => {
  for (const pair of PAIRS) {
    for (const cfg of CONFIGS) {
      const a = replay(950, ARIA, pair.ariaHeads, pair.aria, cfg);
      const b = replay(950, DIETRICH, pair.dietrichHeads, pair.dietrich, cfg);
      const ends = [...a.rows, ...b.rows].map(r => r.end);
      say(`B|${pair.name}|${cfg.label}|aria ends ${a.rows.map(r => r4(r.end)).join(',')}|dietrich ends ${b.rows.map(r => r4(r.end)).join(',')}|at 1: ${ends.filter(atOne).length} of 12|final gap ${r4(Math.abs(a.final - b.final))}|aria starts ${a.rows.map(r => r4(r.start)).join(',')}|dietrich starts ${b.rows.map(r => r4(r.start)).join(',')}|dead ${a.dead.size}/${b.dead.size} differ ${differ(a.dead, b.dead)}|births ${a.births}/${b.births}|pairs ${a.pairs}/${b.pairs}|psych min ${r4(Math.min(...a.rows.map(r => r.psychMin)))}/${r4(Math.min(...b.rows.map(r => r.psychMin)))}`);
    }
  }
});

test('C. 61 seeds, the live decisions with no promotions, each candidate', () => {
  for (const pair of PAIRS) {
    for (const cfg of CONFIGS) {
      const gaps: number[] = [];
      const ends: number[] = [];
      const years: number[] = [];
      let deadDiffer = 0;
      let birthsDiffer = 0;
      let pairsDiffer = 0;
      let births = 0;
      let pairs = 0;
      let despair = 0;
      for (const seed of SEEDS) {
        const a = replay(seed, ARIA, [], pair.aria, cfg);
        const b = replay(seed, DIETRICH, [], pair.dietrich, cfg);
        gaps.push(Math.abs(a.final - b.final));
        for (const r of [...a.rows, ...b.rows]) { ends.push(r.end); years.push(...r.years); }
        if (differ(a.dead, b.dead)) deadDiffer++;
        if (a.births !== b.births) birthsDiffer++;
        if (a.pairs !== b.pairs) pairsDiffer++;
        births += a.births + b.births;
        pairs += a.pairs + b.pairs;
        despair += a.despair + b.despair;
      }
      const over = (x: number) => gaps.filter(g => g > x).length;
      say(`C|${pair.name}|${cfg.label}|final morale differs on ${over(1e-9)} of ${SEEDS.length} seeds (over 0.001: ${over(0.001)}, over 0.005: ${over(0.005)}, over 0.01: ${over(0.01)}, over 0.05: ${over(0.05)})|mean gap ${r4(gaps.reduce((s, g) => s + g, 0) / gaps.length)}|turn ends at 1: ${ends.filter(atOne).length} of ${ends.length}|turn ends min ${r4(Math.min(...ends))} max ${r4(Math.max(...ends))}|year starts min ${r4(Math.min(...years))} max ${r4(Math.max(...years))}|dead sets differ ${deadDiffer}|births differ ${birthsDiffer} (total ${births})|pairs differ ${pairsDiffer} (total ${pairs})|despair ${despair}`);
    }
  }
});

test('D. 61 seeds: one leader, the 8 Nov Aria Chen decisions, against herself with every morale ask at 0.01', () => {
  // The two sides differ in the morale asked and in nothing else, so a
  // difference in births, partnerships or deaths is one morale made.
  const meek = (l: Live): Live => ({ ...l, asked: { ...l.asked, morale: 0.01 } });
  for (const cfg of CONFIGS) {
    const gaps: number[] = [];
    let deadDiffer = 0;
    let birthsDiffer = 0;
    let pairsDiffer = 0;
    for (const seed of SEEDS) {
      const a = replay(seed, ARIA, [], P6_ARIA, cfg);
      const b = replay(seed, ARIA, [], P6_ARIA, cfg, meek);
      gaps.push(Math.abs(a.final - b.final));
      if (differ(a.dead, b.dead)) deadDiffer++;
      if (a.births !== b.births) birthsDiffer++;
      if (a.pairs !== b.pairs) pairsDiffer++;
    }
    say(`D|${cfg.label}|final morale differs on ${gaps.filter(g => g > 1e-9).length} of ${SEEDS.length} (over 0.005: ${gaps.filter(g => g > 0.005).length})|mean gap ${r4(gaps.reduce((s, g) => s + g, 0) / gaps.length)}|dead sets differ ${deadDiffer}|births differ ${birthsDiffer}|pairs differ ${pairsDiffer}`);
  }
});

test('E. 61 seeds: a leader whose decisions move morale by the same amount every turn', () => {
  // The change lands after each turn's progression, as an event's outcome does.
  for (const cfg of [CONFIGS[0], CONFIGS[1]]) {
    for (const g of [0.3, 0.15, 0.057, 0.02, 0, -0.05, -0.15, -0.3]) {
      const finals: number[] = [];
      const ends: number[] = [];
      const years: number[] = [];
      let births = 0;
      let pairs = 0;
      let despair = 0;
      let deaths = 0;
      let psych = 0;
      withConfig(cfg, () => {
        for (const seed of SEEDS) {
          const kernel = new SimulationKernel(seed, ARIA, scenarioKeyPersonnel(marsScenario), { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
          for (const [turn, time] of TURNS) {
            const watch = (ctx: ProgressionHookContext) => { years.push(ctx.metrics?.morale as number); hook(ctx); };
            kernel.advanceTurn(turn, time, watch);
            if (g !== 0) kernel.applySystemDeltas({ morale: g });
            ends.push(kernel.getState().metrics.morale);
          }
          const s = kernel.getState();
          finals.push(s.metrics.morale);
          births += s.eventLog.filter(e => e.type === 'birth').length;
          pairs += s.eventLog.filter(e => e.type === 'relationship').length;
          deaths += s.eventLog.filter(e => e.type === 'death').length;
          despair += s.eventLog.filter(e => e.type === 'death' && e.cause === 'despair').length;
          const alive = s.agents.filter(a => a.health.alive);
          psych += alive.reduce((x, a) => x + a.health.psychScore, 0) / Math.max(1, alive.length);
        }
      });
      say(`E|${cfg.label}|${g >= 0 ? '+' : ''}${g} a turn|mean final ${r4(finals.reduce((s, x) => s + x, 0) / finals.length)}|final min ${r4(Math.min(...finals))} max ${r4(Math.max(...finals))}|turn ends at 1: ${ends.filter(atOne).length} of ${ends.length}|year starts min ${r4(Math.min(...years))} max ${r4(Math.max(...years))}|year starts under 0.7: ${years.filter(y => y < 0.7).length}, under 0.4: ${years.filter(y => y < 0.4).length}, of ${years.length}|births ${births}|pairs ${pairs}|deaths ${deaths}|despair ${despair}|mean final psych ${r4(psych / SEEDS.length)}`);
    }
  }
});

/** A run of one-year turns where every event gets an ordinary response: a conservative success at no modifier, each category in turn. */
function ordinary(label: string, sc: ScenarioPackage, tableOf: Record<string, Record<string, number>>, start: number, turns: number, cfg: Config, seed: number, respond: boolean): string {
  return withConfig(cfg, () => {
    const registry = new EffectRegistry(tableOf);
    const categories = Object.keys(tableOf);
    const kernel = new SimulationKernel(seed, ARIA, [], { startTime: start, initialPopulation: 30, scenario: sc });
    const ends: number[] = [];
    const starts: number[] = [];
    for (let turn = 1; turn <= turns; turn++) {
      const state = kernel.advanceTurn(turn, start + turn - 1, sc.hooks?.progressionHook);
      starts.push(state.metrics.morale);
      if (respond) {
        applyOutcomeEffects(kernel, registry, { category: categories[(turn - 1) % categories.length], outcome: 'conservative_success', modifiers: { personalityBonus: 0, noise: 0 }, turn, time: start + turn - 1 });
      }
      ends.push(kernel.getState().metrics.morale);
    }
    return `F|${label}|seed ${seed}|${cfg.label}|${respond ? 'an ordinary response each turn' : 'no decisions'}|starts ${starts.map(r4).join(',')}|ends ${ends.map(r4).join(',')}|at 1: ${ends.filter(atOne).length} of ${ends.length}`;
  });
}

test('F. the Moon and the deep-ocean station: one-year turns with an ordinary response each turn', () => {
  const lunarTables = lunarScenario.effects[0].categoryDefaults;
  const sub = JSON.parse(readFileSync(resolve(here, '../../scenarios/submarine.json'), 'utf-8')) as ScenarioPackage & { effects: unknown };
  const subTables = (Array.isArray(sub.effects) ? (sub.effects[0] as { categoryDefaults: Record<string, Record<string, number>> }).categoryDefaults : sub.effects) as Record<string, Record<string, number>>;
  const subStart = (sub.setup as { defaultStartTime?: number }).defaultStartTime ?? 2038;
  for (const cfg of [CONFIGS[0], CONFIGS[1]]) {
    for (const seed of [1200, 1, 2]) {
      say(ordinary('lunar-outpost', lunarScenario, lunarTables, 2030, 8, cfg, seed, true));
      say(ordinary('lunar-outpost', lunarScenario, lunarTables, 2030, 8, cfg, seed, false));
    }
    for (const seed of [200, 1, 2]) {
      say(ordinary('deep-ocean-station', sub as ScenarioPackage, subTables, subStart, 8, cfg, seed, true));
      say(ordinary('deep-ocean-station', sub as ScenarioPackage, subTables, subStart, 8, cfg, seed, false));
    }
  }
});

test('G. print', (t) => {
  t.diagnostic(out.join('\n'));
});
