/**
 * MEASUREMENT ONLY. Not for merge.
 *
 * Prints what a birth rate that reads morale would do to runs (issue #239).
 * Every line starts with `MR|`. No section asserts: each prints, and a
 * section that throws prints an `MR|ERR|` line and the rest go on.
 *
 * The base birth rate is multiplied by a lift, a function of the colony's
 * morale in the year of the roll. The dice and their keys stay as they are.
 * `src/engine/core/progression.ts` on this branch reads the lift from
 * `globalThis.__birthLift`; this file sets it for each candidate. Without
 * it the branch applies the second candidate below, so the rest of the
 * suite shows which tests that candidate moves.
 */
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { SeededRng } from '../../src/engine/core/rng.js';
import { classifyOutcomeById } from '../../src/engine/core/progression.js';
import type { SimulationState } from '../../src/engine/core/state.js';
import { EffectRegistry } from '../../src/engine/registries/effects.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import type { ProgressionHookContext, ScenarioPackage } from '../../src/engine/types.js';
import { applyOutcomeEffects } from '../../src/runtime/orchestrator/outcome-effects.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { scenarioKeyPersonnel } from '../../src/cli/sim-config.js';
import { differingStateRows, formatScoreValue, scenarioScoreRows } from '../../src/cli/verdict-scores.js';

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = resolve(here, '../../scenarios');
const hook = marsScenario.hooks.progressionHook!;
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const ARIA = 'Aria Chen';

interface Candidate { label: string; lift: (morale: number) => number }
/** 1 at or under 0.9, rising in a line to `1 + most` at morale 1. */
const above = (most: number) => (morale: number) => 1 + most * Math.max(0, morale - 0.9) / (1 - 0.9);
const MASTER: Candidate = { label: 'master', lift: () => 1 };
const QUARTER: Candidate = { label: 'above 0.9, a quarter more at 1', lift: above(0.25) };
const HALF: Candidate = { label: 'above 0.9, a half more at 1', lift: above(0.5) };
const DOUBLE: Candidate = { label: 'above 0.9, double at 1', lift: above(1) };
const PROPORTION: Candidate = { label: 'morale over 0.9 at every level, at least a half', lift: morale => Math.max(0.5, morale / 0.9) };
const SLOPE: Candidate = { label: '1 + 2.5 x (morale - 0.9) at every level, at least a half', lift: morale => Math.max(0.5, 1 + 2.5 * (morale - 0.9)) };
const CANDIDATES: Candidate[] = [MASTER, QUARTER, HALF, DOUBLE, PROPORTION, SLOPE];

const out: string[] = [];
const say = (line: string) => { out.push(`MR|${line}`); console.log(`MR|${line}`); };
const r4 = (x: number) => Math.round(x * 10000) / 10000;

function withLift<T>(c: Candidate, fn: () => T): T {
  const g = globalThis as unknown as { __birthLift?: (morale: number) => number };
  g.__birthLift = c.lift;
  try {
    return fn();
  } finally {
    g.__birthLift = undefined;
  }
}

function section(name: string, fn: () => void): void {
  const began = Date.now();
  try {
    fn();
  } catch (err) {
    say(`ERR|${name}|${err instanceof Error ? `${err.message} | ${String(err.stack).split('\n').slice(1, 4).join(' / ')}` : String(err)}`);
  }
  say(`T|${name}|${Date.now() - began} ms`);
}

/** Each birth of a run as `time|parent ids`, so a child's own id and name, which the turn's shared stream gives, do not count. */
function birthKeys(s: SimulationState): string[] {
  const parents = new Map<string, string[]>();
  for (const a of s.agents) {
    for (const child of a.social.childrenIds ?? []) {
      const list = parents.get(child) ?? [];
      list.push(a.core.id);
      parents.set(child, list);
    }
  }
  return s.eventLog
    .filter(e => e.type === 'birth' && e.agentId)
    .map(e => `${e.time}|${(parents.get(e.agentId!) ?? []).slice().sort().join('+')}`)
    .sort();
}

interface Sum { births: number; pairs: number; deaths: number; despair: number; alive: number; morale: number; keys: string; records: string; dead: string }

function sum(s: SimulationState): Sum {
  const deaths = s.eventLog.filter(e => e.type === 'death');
  return {
    births: s.eventLog.filter(e => e.type === 'birth').length,
    pairs: s.eventLog.filter(e => e.type === 'relationship').length,
    deaths: deaths.length,
    despair: deaths.filter(e => e.cause === 'despair').length,
    alive: s.agents.filter(a => a.health.alive).length,
    morale: s.metrics.morale,
    keys: birthKeys(s).join('\n'),
    records: deaths.map(e => `${e.agentId}|${e.time}|${e.cause}`).sort().join('\n'),
    dead: deaths.map(e => String(e.agentId)).sort().join('\n'),
  };
}

/** Six Mars turns of eight years, 30 people, the preset roster; morale moved by `gain` after each turn's progression. */
function led(seed: number, gain: number): { state: SimulationState; years: number[] } {
  const kernel = new SimulationKernel(seed, ARIA, scenarioKeyPersonnel(marsScenario), { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
  const years: number[] = [];
  const watch = (ctx: ProgressionHookContext) => { years.push(ctx.metrics?.morale as number); hook(ctx); };
  for (const [turn, time] of TURNS) {
    kernel.advanceTurn(turn, time, watch);
    if (gain !== 0) kernel.applySystemDeltas({ morale: gain });
  }
  return { state: kernel.getState(), years };
}

const GAINS = [0.3, 0.15, 0.057, 0.02, 0, -0.05, -0.15, -0.3];
const GAIN_PAIRS: Array<[number, number]> = [[-0.15, 0.3], [0, 0.3], [0, 0.15], [0.057, 0.15], [0.02, 0.057], [0.15, 0.3], [-0.15, -0.05], [-0.05, 0], [-0.3, -0.15]];

test('E. 61 seeds: a leader whose decisions move morale by the same amount every turn, each candidate', () => {
  for (const c of CANDIDATES) {
    section(`E|${c.label}`, () => withLift(c, () => {
      const by = new Map<number, Sum[]>();
      for (const g of GAINS) {
        const sums: Sum[] = [];
        const years: number[] = [];
        for (const seed of SEEDS) {
          const r = led(seed, g);
          sums.push(sum(r.state));
          years.push(...r.years);
        }
        by.set(g, sums);
        const total = (k: 'births' | 'pairs' | 'deaths' | 'despair' | 'alive' | 'morale') => sums.reduce((x, s) => x + s[k], 0);
        say(`E|${c.label}|${g >= 0 ? '+' : ''}${g} a turn|mean final morale ${r4(total('morale') / SEEDS.length)}|year starts over 0.9: ${years.filter(y => y > 0.9).length}, under 0.4: ${years.filter(y => y < 0.4).length}, of ${years.length}|births ${total('births')}|pairs ${total('pairs')}|deaths ${total('deaths')}|despair ${total('despair')}|mean living at the end ${r4(total('alive') / SEEDS.length)}`);
      }
      for (const [lo, hi] of GAIN_PAIRS) {
        const a = by.get(lo)!;
        const b = by.get(hi)!;
        let counts = 0;
        let sets = 0;
        let records = 0;
        let dead = 0;
        let more = 0;
        let fewer = 0;
        a.forEach((x, i) => {
          const y = b[i];
          if (x.births !== y.births) counts++;
          if (x.keys !== y.keys) sets++;
          if (x.records !== y.records) records++;
          if (x.dead !== y.dead) dead++;
          if (y.births > x.births) more++;
          if (y.births < x.births) fewer++;
        });
        say(`P|${c.label}|${lo} against ${hi} a turn|births (who and when) differ on ${sets} of ${SEEDS.length} seeds|birth counts differ on ${counts} (more under the higher on ${more}, fewer on ${fewer})|births ${a.reduce((s, x) => s + x.births, 0)} against ${b.reduce((s, x) => s + x.births, 0)}|death records differ on ${records}|dead sets differ on ${dead}`);
      }
    }));
  }
});

test('F. 61 seeds: the first year after two colonies part in morale alone, each candidate', () => {
  for (const c of CANDIDATES) {
    section(`F|${c.label}`, () => withLift(c, () => {
      let missing = 0;
      let lowFirst = 0;
      let highFirst = 0;
      let lowTurn = 0;
      let highTurn = 0;
      let onlyLow = 0;
      let seen = '';
      for (const seed of SEEDS) {
        const side = (delta: number) => {
          const kernel = new SimulationKernel(seed, ARIA, scenarioKeyPersonnel(marsScenario), { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
          kernel.advanceTurn(1, 2035, hook);
          kernel.applySystemDeltas({ morale: delta });
          const before = kernel.getState().metrics.morale;
          return { before, keys: birthKeys(kernel.advanceTurn(2, 2043, hook)) };
        };
        const low = side(-0.15);
        const high = side(0.3);
        if (seed === 950) seen = `${r4(low.before)} against ${r4(high.before)}`;
        const first = (keys: string[]) => keys.filter(k => k.startsWith('2036|'));
        const lf = first(low.keys);
        const hf = new Set(first(high.keys));
        if (lf.some(k => !hf.has(k))) missing++;
        lowFirst += lf.length;
        highFirst += hf.size;
        lowTurn += low.keys.length;
        highTurn += high.keys.length;
        const all = new Set(high.keys);
        onlyLow += low.keys.filter(k => !all.has(k)).length;
      }
      say(`F|${c.label}|morale as turn 2 begins, seed 950: ${seen}|births in 2036: ${lowFirst} in the lower colony, ${highFirst} in the higher|seeds where a 2036 birth of the lower colony is missing in the higher: ${missing} of ${SEEDS.length}|births in turn 2: ${lowTurn} against ${highTurn}, ${onlyLow} of the lower colony's not in the higher`);
    }));
  }
});

/** Each turn's morale, living, deaths and births. */
type TurnRow = [morale: number, alive: number, deaths: number, births: number];

/** A scenario's kernel with no decisions: each turn's row. */
function unled(sc: ScenarioPackage, seed: number, population: number, turns: number, unitsPerTurn: number, preset: boolean): TurnRow[] {
  const start = sc.setup?.defaultStartTime ?? 1;
  const kernel = new SimulationKernel(seed, ARIA, preset ? scenarioKeyPersonnel(sc) : [], { startTime: start, initialPopulation: population, scenario: sc });
  const rows: TurnRow[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const state = kernel.advanceTurn(turn, start + (turn - 1) * unitsPerTurn, sc.hooks?.progressionHook);
    const mine = state.eventLog.filter(e => e.turn === turn);
    rows.push([
      state.metrics.morale,
      state.agents.filter(a => a.health.alive).length,
      mine.filter(e => e.type === 'death').length,
      mine.filter(e => e.type === 'birth').length,
    ]);
  }
  return rows;
}

test('U. the pinned rows of colonies nobody leads, each candidate', () => {
  const disk = loadDiskCustomScenarios(scenariosDir);
  const atlasLab = disk.get('atlas-lab')!.scenario as ScenarioPackage;
  const station = disk.get('deep-ocean-station')!.scenario as ScenarioPackage;
  const twin = JSON.parse(readFileSync(resolve(scenariosDir, 't2d-glp1-protocol.json'), 'utf-8')) as ScenarioPackage;
  const pinned: Record<string, TurnRow[]> = {
    ...JSON.parse(readFileSync(resolve(here, '../fixtures/short-turns-before-yearly-morale.json'), 'utf-8')).runs,
    ...JSON.parse(readFileSync(resolve(here, '../fixtures/supplies-unmarked-and-untouched.json'), 'utf-8')).runs,
  };
  for (const c of CANDIDATES) {
    section(`U|${c.label}`, () => withLift(c, () => {
      const seen: Record<string, TurnRow[]> = {
        'atlas-lab, seed 11, 480 people, 12 monthly turns': unled(atlasLab, 11, 480, 12, 1, false),
        'digital twin, seed 11, 1 person, 26 two-week turns': unled(twin, 11, 1, 26, 2, false),
        'mars-genesis, seed 101, 100 people, 17 one-year turns': unled(marsScenario, 101, 100, 17, 1, false),
        'mars-genesis, seed 950, 30 people, 17 one-year turns': unled(marsScenario, 950, 30, 17, 1, false),
      };
      for (const seed of [950, 1, 2, 3]) {
        seen[`mars-genesis, seed ${seed}, 30 people, 6 eight-year turns`] = unled(marsScenario, seed, 30, 6, 8, true);
        seen[`lunar-outpost, seed ${seed}, 30 people, 8 one-year turns`] = unled(lunarScenario, seed, 30, 8, 1, true);
        seen[`deep-ocean-station, seed ${seed}, 30 people, 8 one-year turns`] = unled(station, seed, 30, 8, 1, true);
      }
      const keys = Object.keys(seen);
      const births = (rows: TurnRow[] | undefined) => (rows ?? []).reduce((s, r) => s + r[3], 0);
      const moved = keys.filter(k => JSON.stringify(seen[k]) !== JSON.stringify(pinned[k]));
      const unknown = keys.filter(k => !pinned[k]);
      const highest = Math.max(...keys.flatMap(k => seen[k].map(r => r[0])));
      say(`U|${c.label}|pinned runs that keep every row: ${keys.length - moved.length} of ${keys.length}|runs with no pinned rows: ${unknown.length}|highest morale in any row ${r4(highest)}|moved: ${moved.map(k => `${k} (births ${births(pinned[k])} to ${births(seen[k])}, living at the end ${pinned[k]?.at(-1)?.[1]} to ${seen[k].at(-1)?.[1]})`).join('; ') || 'none'}`);
    }));
  }
});

type Stream = 'bold' | 'safe';
interface Shape { population: number; turns: number }
interface StreamEvent {
  category: string;
  options: Array<{ id: string; isRisky: boolean }>;
  riskyOptionId: string;
  riskSuccessProbability: number;
}

/** The event of one turn, as tests/runtime/scenario-leaders-end-differently.test.ts gives it. */
function eventFor(sc: ScenarioPackage, registry: EffectRegistry, seed: number, turn: number, maxTurns: number): StreamEvent {
  const milestone = sc.hooks?.getMilestoneEvent?.(turn, maxTurns) as StreamEvent | null | undefined;
  if (milestone) {
    const keys = Object.keys(sc.knowledge?.categoryMapping ?? {});
    const category = keys.length > 0 ? (turn === 1 ? keys[0] : keys[keys.length - 1]) : milestone.category;
    return { category, options: milestone.options, riskyOptionId: milestone.riskyOptionId, riskSuccessProbability: milestone.riskSuccessProbability };
  }
  const tables = registry.categories();
  const pool = tables.length > 0 ? tables : ['general'];
  return {
    category: pool[new SeededRng(seed).turnSeed(turn * 100 + 77).int(0, pool.length - 1)],
    options: [{ id: 'option_a', isRisky: false }, { id: 'option_b', isRisky: true }],
    riskyOptionId: 'option_b',
    riskSuccessProbability: 0.5,
  };
}

/** One run of a scenario under one decision stream, as that test runs it; also each year's morale. */
function stream(sc: ScenarioPackage, seed: number, shape: Shape, which: Stream): { state: SimulationState; years: number[] } {
  const start = sc.setup?.defaultStartTime ?? 1;
  const unitsPerTurn = sc.setup?.defaultTimePerTurn ?? 1;
  const kernel = new SimulationKernel(seed, 'Leader', scenarioKeyPersonnel(sc), { startTime: start, initialPopulation: shape.population, scenario: sc });
  const registry = EffectRegistry.forScenario(sc);
  const years: number[] = [];
  const progression = sc.hooks?.progressionHook;
  const watch = (ctx: ProgressionHookContext) => { years.push(ctx.metrics?.morale as number); progression?.(ctx); };
  for (let turn = 1; turn <= shape.turns; turn++) {
    const time = start + (turn - 1) * unitsPerTurn;
    kernel.advanceTurn(turn, time, watch);
    const event = eventFor(sc, registry, seed, turn, shape.turns);
    const optionId = which === 'bold' ? event.riskyOptionId : (event.options.find(o => !o.isRisky) ?? event.options[0]).id;
    const outcome = classifyOutcomeById(optionId, event.options, event.riskSuccessProbability, kernel.getState().metrics, new SeededRng(seed).turnSeed(turn * 100));
    applyOutcomeEffects(kernel, registry, {
      category: event.category,
      outcome,
      modifiers: { personalityBonus: 0, noise: new SeededRng(seed).turnSeed(turn * 100 + 50).next() * 0.2 - 0.1 },
      turn,
      time,
      politicsHook: sc.hooks?.politicsHook,
    });
  }
  return { state: kernel.getState(), years };
}

test('G. 61 seeds: a leader who always takes the bold option against one who always takes a safe one, each scenario, three candidates', () => {
  const disk = loadDiskCustomScenarios(scenariosDir);
  const get = (id: string) => disk.get(id)!.scenario as ScenarioPackage;
  const hosted = (sc: ScenarioPackage): Shape => ({ population: Math.min(sc.setup?.defaultPopulation ?? 30, 30), turns: Math.min(sc.setup?.defaultTurns ?? 6, 6) });
  const own = (sc: ScenarioPackage): Shape => ({ population: sc.setup?.defaultPopulation ?? 30, turns: sc.setup?.defaultTurns ?? 6 });
  const station = get('deep-ocean-station');
  const rows: Array<[string, ScenarioPackage, Shape]> = [
    ['Mars Genesis', marsScenario, hosted(marsScenario)],
    ['Lunar Outpost', lunarScenario, hosted(lunarScenario)],
    ['the deep-ocean station', station, hosted(station)],
    ['Atlas Lab', get('atlas-lab'), hosted(get('atlas-lab'))],
    ['Q-Scope Corp', get('corporate-quarterly'), hosted(get('corporate-quarterly'))],
    ['the Dual Superintelligence Council', get('dual-superintelligence-council'), hosted(get('dual-superintelligence-council'))],
    ['Lunar Outpost at its own size', lunarScenario, own(lunarScenario)],
    ['the deep-ocean station at its own size', station, own(station)],
  ];
  for (const c of [MASTER, QUARTER, PROPORTION]) {
    for (const [label, sc, shape] of rows) {
      section(`G|${c.label}|${label}`, () => withLift(c, () => {
        const declaredIds = new Set((Array.isArray(sc.metrics) ? sc.metrics : []).map(m => m.id));
        let declared = 0;
        let scores = 0;
        let records = 0;
        let dead = 0;
        let births = 0;
        let birthsBold = 0;
        let birthsSafe = 0;
        let deathsBold = 0;
        let deathsSafe = 0;
        const years: number[] = [];
        for (const seed of SEEDS) {
          const a = stream(sc, seed, shape, 'bold');
          const b = stream(sc, seed, shape, 'safe');
          years.push(...a.years, ...b.years);
          const differing = scenarioScoreRows(sc, [a.state, b.state]).filter(r => formatScoreValue(r.values[0], r.format) !== formatScoreValue(r.values[1], r.format));
          if (differing.some(r => declaredIds.has(r.id))) declared++;
          if (differing.length > 0 || differingStateRows(sc, [a.state, b.state]).length > 0) scores++;
          const x = sum(a.state);
          const y = sum(b.state);
          if (x.records !== y.records) records++;
          if (x.dead !== y.dead) dead++;
          if (x.keys !== y.keys) births++;
          birthsBold += x.births;
          birthsSafe += y.births;
          deathsBold += x.deaths;
          deathsSafe += y.deaths;
        }
        say(`G|${c.label}|${label}, ${shape.population} people, ${shape.turns} turns|a declared score differs on ${declared} of ${SEEDS.length} seeds, the score block on ${scores}, the death records on ${records}, the dead on ${dead}, the births (who and when) on ${births}|births ${birthsBold} bold, ${birthsSafe} safe|deaths ${deathsBold} bold, ${deathsSafe} safe|year starts over 0.9: ${years.filter(m => m > 0.9).length} of ${years.length}`);
      }));
    }
  }
});

test('Z. print', (t) => {
  t.diagnostic(out.join('\n'));
});
