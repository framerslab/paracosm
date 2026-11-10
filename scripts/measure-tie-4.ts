/**
 * Measurement for #243: why three live Mars Genesis pairs at seed 950 lost
 * the same people under both leaders, how often two leaders' recorded
 * trajectories change who dies, and what candidate readings would do.
 *
 * Runs kernels the way a hosted pair run does (`new SimulationKernel` with
 * the Mars scenario and its preset roster, then `advanceTurn` with its
 * progression hook) and sets each side's metrics after every turn to what
 * the live run's `turn_done` reported (`applyPolicy` patches, which set
 * values outright). No model call. The same person rolls the same dice on
 * both sides. The six recorded sides (three live pairs) are compared in all
 * fifteen pairings: the three live pairs, the six other pairings of an Aria
 * Chen run with a Dietrich Voss run, and the six pairings of two runs of one
 * leader. Nothing here is merged.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { SeededRng } from '../src/engine/core/rng.js';
import { crisis, measure, outcomeSuccessChance, supplyLevel, type DieRow } from '../src/engine/core/progression.js';
import { EffectRegistry, type TurnOutcome } from '../src/engine/registries/effects.js';
import { marsScenario } from '../src/engine/scenarios/index.js';
import { scenarioKeyPersonnel } from '../src/cli/sim-config.js';
import type { Department } from '../src/engine/core/state.js';

const here = dirname(fileURLToPath(import.meta.url));
const hook = marsScenario.hooks.progressionHook;
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const PART = process.env.PART ?? 'base';

interface Outcome { turn: number; ei: number; category: string; outcome: string; riskProb: number; risky: boolean; deltas?: Record<string, number> }
interface Side {
  key: string; leader: string; pair: string;
  heads: Array<[string, string, string]>;
  held: Record<string, number[]>;
  outcomes: Outcome[];
  deaths: Array<[string, number, string]>;
  birthsPerTurn: number[];
  /** Each turn's metrics after the between-turn step, before the turn's decisions. */
  start?: Record<string, number[]>;
  hexaco?: { openness: number; conscientiousness: number };
}
const LIVE = JSON.parse(readFileSync(resolve(here, 'measure-tie-4-live.json'), 'utf-8')) as { sides: Record<string, Side> };
const flatSide = (key: string, held: Record<string, number>): Side => ({
  key, leader: 'Aria Chen', pair: 'held grid', heads: [], outcomes: [], deaths: [], birthsPerTurn: [],
  held: Object.fromEntries(Object.entries(held).map(([k, v]) => [k, TURNS.map(() => v)])),
});
const SIDES: Record<string, Side> = {
  ...LIVE.sides,
  // A colony nobody leads, and the held grids #242's tests sweep.
  IDLE: flatSide('IDLE', {}),
  U4: flatSide('U4', { lifeSupportCapacity: 96, waterLitersPerDay: 640, powerKw: 320, pressurizedVolumeM3: 2400 }),
  O4: flatSide('O4', { lifeSupportCapacity: 144, waterLitersPerDay: 960, powerKw: 480, pressurizedVolumeM3: 3600 }),
  UW: flatSide('UW', { waterLitersPerDay: 640 }),
  OW: flatSide('OW', { waterLitersPerDay: 960 }),
};
const LIVE_KEYS = ['A1', 'D1', 'A2', 'D2', 'A3', 'D3'];

interface Pairing { a: string; b: string; kind: 'live' | 'cross' | 'same' | 'grid' }
const PAIRINGS: Pairing[] = [];
for (let i = 0; i < LIVE_KEYS.length; i++) {
  for (let j = i + 1; j < LIVE_KEYS.length; j++) {
    const a = LIVE_KEYS[i], b = LIVE_KEYS[j];
    const kind = a[0] === b[0] ? 'same' : a[1] === b[1] ? 'live' : 'cross';
    // An Aria Chen run first, where the pairing has one.
    PAIRINGS.push(a[0] === 'D' && b[0] === 'A' ? { a: b, b: a, kind } : { a, b, kind });
  }
}
const GRID_PAIRINGS: Pairing[] = [{ a: 'U4', b: 'O4', kind: 'grid' }, { a: 'UW', b: 'OW', kind: 'grid' }];

type OutcomeMode = 'held' | 'redrawn';
interface RunOpt {
  heads: boolean; trace: boolean; outcomes: OutcomeMode;
  /** How the side's metrics are set after a turn: outright (a patch), or as the difference from what the kernel holds (`applySystemDeltas`, as the suite's tests do). */
  hold?: 'patch' | 'delta';
  outcomeAccident?: Record<string, number>; outcomeNatural?: Record<string, number>;
}

/**
 * The class an event's outcome has at `seed`: as the live run recorded it,
 * or redrawn on that seed's own outcome draw (`new SeededRng(seed)
 * .turnSeed(turn * 100 + eventIndex)`, the orchestrator's) against the
 * chosen option's chance. Every recorded decision was made with morale over
 * 0.7 and food over 12 months, which add 0.15 to the declared chance.
 */
function classOf(seed: number, o: Outcome, mode: OutcomeMode): string {
  if (mode === 'held') return o.outcome;
  const p = Math.max(0.1, Math.min(0.9, o.riskProb + 0.15));
  const chance = o.risky ? p : (1 + p) / 2;
  const success = new SeededRng(seed).turnSeed(o.turn * 100 + o.ei).next() < chance;
  return `${o.risky ? 'risky' : 'conservative'}_${success ? 'success' : 'failure'}`;
}
function outcomeDraw(seed: number, turn: number, ei: number): number {
  return new SeededRng(seed).turnSeed(turn * 100 + ei).next();
}

interface Death { id: string; name: string; time: number; turn: number; cause: string }
interface SideRun {
  dead: Set<string>; founders: Set<string>; names: Map<string, string>;
  deaths: Death[]; records: Set<string>; born: Set<string>; living: Set<string>;
  rows: DieRow[] | null; birthsPerTurn: number[]; deathsPerTurn: number[]; levelAfterTurn: number[]; aliveAfterTurn: number[];
}

function worst(classes: string[], table: Record<string, number> | undefined): number {
  if (!table) return 1;
  return classes.reduce((m, c) => Math.max(m, table[c] ?? 1), 1);
}

/** Six Mars turns on the preset roster with the side's metrics set after each turn. */
function runSide(seed: number, side: Side, opt: RunOpt): SideRun {
  const kernel = new SimulationKernel(seed, side.leader, scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  const founders = new Set(kernel.getState().agents.map(a => a.core.id));
  if (opt.heads) for (const [id, department, role] of side.heads) kernel.promoteAgent(id, department as Department, role, side.leader);
  measure.rows = [];
  measure.trace = opt.trace;
  const levelAfterTurn: number[] = [];
  const aliveAfterTurn: number[] = [];
  TURNS.forEach(([turn, time], i) => {
    // The outcome reading acts on the years after the turn whose events it reads.
    const before = side.outcomes.filter(o => o.turn === turn - 1).map(o => classOf(seed, o, opt.outcomes));
    measure.outcomeAccident = worst(before, opt.outcomeAccident);
    measure.outcomeNatural = worst(before, opt.outcomeNatural);
    kernel.advanceTurn(turn, time, hook);
    measure.outcomeAccident = 1;
    measure.outcomeNatural = 1;
    if (crisis.mode !== 'off') {
      for (const o of side.outcomes.filter(x => x.turn === turn)) kernel.crisisCasualties(o.ei, o.category, classOf(seed, o, opt.outcomes));
    }
    const metrics: Record<string, number> = {};
    for (const [k, values] of Object.entries(side.held)) metrics[k] = values[i];
    if (opt.hold === 'delta') {
      const now = kernel.getState().metrics as Record<string, number>;
      kernel.applySystemDeltas(Object.fromEntries(Object.entries(metrics).map(([k, target]) => [k, target - now[k]])));
    } else if (Object.keys(metrics).length > 0) {
      kernel.applyPolicy({ description: 'held', patches: { metrics }, events: [] });
    }
    const after = kernel.getState();
    levelAfterTurn.push(supplyLevel(after.metrics as Record<string, unknown>, after.metadata.landingSupplies));
    aliveAfterTurn.push(after.agents.filter(a => a.health.alive).length);
  });
  measure.trace = false;
  const rows = opt.trace ? measure.rows : null;
  measure.rows = [];
  const state = kernel.getState();
  const byId = new Map(state.agents.map(a => [a.core.id, a]));
  const deaths: Death[] = state.eventLog.filter(e => e.type === 'death' && e.agentId).map(e => ({
    id: e.agentId!, name: byId.get(e.agentId!)?.core.name ?? e.agentId!, time: e.time, turn: e.turn, cause: String(e.cause),
  }));
  const count = (type: string) => TURNS.map(([turn]) => state.eventLog.filter(e => e.type === type && e.turn === turn).length);
  return {
    dead: new Set(state.agents.filter(a => !a.health.alive).map(a => a.core.id)),
    founders,
    names: new Map(state.agents.map(a => [a.core.id, a.core.name])),
    deaths,
    records: new Set(deaths.map(d => `${d.id}|${d.time}|${d.cause}`)),
    born: new Set(state.eventLog.filter(e => e.type === 'birth' && e.agentId).map(e => e.agentId!)),
    living: new Set(state.agents.filter(a => a.health.alive).map(a => a.core.id)),
    rows, birthsPerTurn: count('birth'), deathsPerTurn: count('death'), levelAfterTurn, aliveAfterTurn,
  };
}

function causeOf(deathCause: string): string {
  if (deathCause.startsWith('accident')) return 'accident';
  if (deathCause.startsWith('crisis')) return 'crisis';
  if (deathCause === 'natural causes' || deathCause === 'age-related complications') return 'natural';
  if (deathCause === 'radiation cancer') return 'radiation';
  return deathCause;
}
function tally(deaths: Death[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of deaths) out[causeOf(d.cause)] = (out[causeOf(d.cause)] ?? 0) + 1;
  return out;
}
const symdiff = (a: Set<string>, b: Set<string>) => [...a].filter(x => !b.has(x)).length + [...b].filter(x => !a.has(x)).length;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

const CAUSES = ['natural', 'radiation', 'accident'] as const;
interface Flip { turn: number; year: number; id: string; cause: string; u: number; hA: number; hB: number; deadA: boolean; deadB: boolean }
interface DiceStats {
  sums: Record<string, { a: number; b: number; gap: number; between: number }>;
  gapByTurn: Record<string, number>;
  shared: number;
  flips: Flip[];
}

/** Compare the two sides' dice: the same person, year and cause on both. */
function dice(a: SideRun, b: SideRun): DiceStats {
  const key = (r: DieRow) => `${r.turn}|${r.step}|${r.id}|${r.cause}`;
  const inB = new Map((b.rows ?? []).map(r => [key(r), r]));
  const stats: DiceStats = { sums: {}, gapByTurn: {}, shared: 0, flips: [] };
  for (const c of CAUSES) stats.sums[c] = { a: 0, b: 0, gap: 0, between: 0 };
  for (const ra of a.rows ?? []) {
    const rb = inB.get(key(ra));
    if (!rb) continue;
    if (ra.cause === 'accident') stats.shared++;
    const s = stats.sums[ra.cause];
    s.a += ra.h; s.b += rb.h;
    const lo = Math.min(ra.h, rb.h), hi = Math.max(ra.h, rb.h);
    if (hi > lo) {
      s.gap += hi - lo;
      stats.gapByTurn[String(ra.turn)] = (stats.gapByTurn[String(ra.turn)] ?? 0) + hi - lo;
      if (ra.u >= lo && ra.u < hi) {
        s.between++;
        stats.flips.push({
          turn: ra.turn, year: ra.step + 1, id: ra.id, cause: ra.cause, u: r6(ra.u), hA: r6(ra.h), hB: r6(rb.h),
          deadA: a.dead.has(ra.id), deadB: b.dead.has(ra.id),
        });
      }
    }
  }
  return stats;
}

interface Variant {
  name: string;
  hold?: 'patch' | 'delta';
  set?: () => void;
  outcomes?: OutcomeMode;
  outcomeAccident?: Record<string, number>;
  outcomeNatural?: Record<string, number>;
}

function reset(): void {
  measure.exp = 1; measure.lo = 0.5; measure.hi = 2; measure.per = 'none'; measure.food = false;
  measure.moraleK = 0; measure.birthExp = 0; measure.outcomeAccident = 1; measure.outcomeNatural = 1;
  measure.trace = false; measure.rows = []; measure.lifetime = false;
  crisis.mode = 'off';
  crisis.base = { conservative_failure: 0.04, risky_failure: 0.1 };
  crisis.count = { conservative_failure: 1, risky_failure: 2 };
}

interface Agg {
  differ: number; records: number; born: number; living: number; bothWays: number;
  deathsA: number; deathsB: number; onlyA: number; onlyB: number; ties: number[];
  gap: Record<string, number>; between: Record<string, number>; gapByTurn: Record<string, number>; flips: number; masked: number;
}
const newAgg = (): Agg => ({
  differ: 0, records: 0, born: 0, living: 0, bothWays: 0, deathsA: 0, deathsB: 0, onlyA: 0, onlyB: 0, ties: [],
  gap: {}, between: {}, gapByTurn: {}, flips: 0, masked: 0,
});

/**
 * One variant over the 61 seeds, no promotions: every pairing of the six
 * recorded sides, each side's deaths a run, and a colony nobody leads.
 */
function sweepVariant(v: Variant, trace: boolean, pairings: Pairing[] = PAIRINGS): void {
  reset();
  v.set?.();
  const opt: RunOpt = { heads: false, trace, outcomes: v.outcomes ?? 'held', outcomeAccident: v.outcomeAccident, outcomeNatural: v.outcomeNatural, hold: v.hold };
  const keys = [...new Set(pairings.flatMap(p => [p.a, p.b])), 'IDLE'];
  const aggs = new Map(pairings.map(p => [`${p.a}-${p.b}`, newAgg()]));
  const deathsBySide: Record<string, number> = {};
  const causesBySide: Record<string, Record<string, number>> = {};
  const birthsBySide: Record<string, number> = {};
  const perSeed: Record<string, number[]> = { live: [], cross: [], same: [] };
  const marginal: number[] = [];
  const started = Date.now();
  for (const seed of SEEDS) {
    const runs: Record<string, SideRun> = {};
    for (const k of keys) runs[k] = runSide(seed, SIDES[k], opt);
    for (const k of keys) {
      deathsBySide[k] = (deathsBySide[k] ?? 0) + runs[k].dead.size;
      birthsBySide[k] = (birthsBySide[k] ?? 0) + runs[k].born.size;
      causesBySide[k] ??= {};
      for (const [c, n] of Object.entries(tally(runs[k].deaths))) causesBySide[k][c] = (causesBySide[k][c] ?? 0) + n;
    }
    const seedCount: Record<string, number> = { live: 0, cross: 0, same: 0, grid: 0 };
    for (const p of pairings) {
      const a = runs[p.a], b = runs[p.b];
      const g = aggs.get(`${p.a}-${p.b}`)!;
      const onlyA = [...a.dead].filter(id => !b.dead.has(id)).length;
      const onlyB = [...b.dead].filter(id => !a.dead.has(id)).length;
      if (onlyA + onlyB > 0) { g.differ++; seedCount[p.kind]++; } else g.ties.push(seed);
      if (onlyA > 0 && onlyB > 0) g.bothWays++;
      if (symdiff(a.records, b.records) > 0) g.records++;
      if (symdiff(a.born, b.born) > 0) g.born++;
      if (symdiff(a.living, b.living) > 0) g.living++;
      g.deathsA += a.dead.size; g.deathsB += b.dead.size; g.onlyA += onlyA; g.onlyB += onlyB;
      if (trace) {
        const d = dice(a, b);
        for (const c of CAUSES) {
          g.gap[c] = (g.gap[c] ?? 0) + d.sums[c].gap;
          g.between[c] = (g.between[c] ?? 0) + d.sums[c].between;
        }
        for (const [t, x] of Object.entries(d.gapByTurn)) g.gapByTurn[t] = (g.gapByTurn[t] ?? 0) + x;
        g.flips += d.flips.length;
        g.masked += d.flips.filter(f => f.deadA && f.deadB).length;
      }
    }
    for (const kind of ['live', 'cross', 'same']) perSeed[kind].push(seedCount[kind]);
    if (trace) {
      // The dice that would change a fate somewhere in the band of supply
      // factors the live runs held (0.55 to 0.95): an age or accident die
      // whose value over the rate at a factor of 1 falls in the band.
      let n = 0;
      for (const k of LIVE_KEYS) {
        if (!runs[k]) continue;
        for (const row of runs[k].rows ?? []) {
          if (row.cause === 'radiation') continue;
          const critical = (row.u * row.f) / row.h;
          if (critical >= 0.55 && critical < 0.95) n++;
        }
      }
      marginal.push(r2(n / LIVE_KEYS.length));
    }
  }
  const n = SEEDS.length;
  const per = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, r3(x / n)]));
  for (const p of pairings) {
    const g = aggs.get(`${p.a}-${p.b}`)!;
    const row: Record<string, unknown> = {
      variant: v.name, pairing: `${p.a}-${p.b}`, kind: p.kind, differ: g.differ, records: g.records, born: g.born, living: g.living,
      bothWays: g.bothWays, deathsA: r2(g.deathsA / n), deathsB: r2(g.deathsB / n), onlyA: r2(g.onlyA / n), onlyB: r2(g.onlyB / n),
      tieAt950: g.ties.includes(950), ties: g.ties.length <= 16 ? g.ties : `${g.ties.length} seeds`,
    };
    if (trace) {
      const gapAll = Object.values(g.gap).reduce((s, x) => s + x, 0) / n;
      Object.assign(row, {
        gap: per(g.gap), gapAll: r3(gapAll), between: per(g.between), gapByTurn: per(g.gapByTurn),
        maskedShare: g.flips > 0 ? r3(g.masked / g.flips) : 0, expectedDiffer: r3(1 - Math.exp(-gapAll)),
      });
    }
    console.log('ROW ' + JSON.stringify(row));
  }
  const mean = (kind: string) => {
    const rows = pairings.filter(p => p.kind === kind).map(p => aggs.get(`${p.a}-${p.b}`)!.differ);
    return rows.length ? r2(rows.reduce((s, x) => s + x, 0) / rows.length) : null;
  };
  const meanOf = (kind: string, field: 'records' | 'born' | 'living') => {
    const rows = pairings.filter(p => p.kind === kind).map(p => aggs.get(`${p.a}-${p.b}`)![field]);
    return rows.length ? r2(rows.reduce((s, x) => s + x, 0) / rows.length) : null;
  };
  const at950 = (kind: string) => pairings.filter(p => p.kind === kind && !aggs.get(`${p.a}-${p.b}`)!.ties.includes(950)).length;
  console.log('SUM ' + JSON.stringify({
    variant: v.name, outcomes: opt.outcomes,
    live: pairings.filter(p => p.kind === 'live').map(p => aggs.get(`${p.a}-${p.b}`)!.differ),
    liveMean: mean('live'), crossMean: mean('cross'), sameMean: mean('same'),
    liveRecords: meanOf('live', 'records'), crossRecords: meanOf('cross', 'records'),
    liveBorn: meanOf('live', 'born'), crossBorn: meanOf('cross', 'born'),
    liveLiving: meanOf('live', 'living'), crossLiving: meanOf('cross', 'living'),
    at950: { live: at950('live'), cross: at950('cross'), same: at950('same') },
    deaths: Object.fromEntries(Object.entries(deathsBySide).map(([k, x]) => [k, r2(x / n)])),
    births: Object.fromEntries(Object.entries(birthsBySide).map(([k, x]) => [k, r2(x / n)])),
    seconds: Math.round((Date.now() - started) / 1000),
  }));
  console.log('CAUSES ' + JSON.stringify({
    variant: v.name,
    causes: Object.fromEntries(Object.entries(causesBySide).map(([k, o]) => [k, per(o)])),
  }));
  if (trace) {
    // For each seed, how many of the three live pairs, the six other Aria Chen
    // against Dietrich Voss pairings and the six same-leader pairings differ.
    console.log('PERSEED ' + JSON.stringify({ variant: v.name, seeds: SEEDS, live: perSeed.live, cross: perSeed.cross, same: perSeed.same, marginalDice: marginal }));
  }
}

/** One side at seed 950 with the heads its leader named, beside what the live run recorded. */
function replicaSide(key: string, hold: 'patch' | 'delta' = 'patch', set?: () => void): SideRun {
  reset();
  set?.();
  const side = SIDES[key];
  const run = runSide(950, side, { heads: true, trace: true, outcomes: 'held', hold });
  const got = [...run.records].sort();
  const want = side.deaths.map(([id, time, cause]) => `${id}|${time}|${cause}`).sort();
  const missing = want.filter(x => !got.includes(x));
  const extra = got.filter(x => !want.includes(x));
  console.log(`REPLICA_LIVE ${key} (${side.leader}, ${side.pair}): ${got.length} deaths here, ${want.length} live; same people, years and causes: ${missing.length === 0 && extra.length === 0}; live not here: ${JSON.stringify(missing)}; here not live: ${JSON.stringify(extra)}; births a turn here ${JSON.stringify(run.birthsPerTurn)} live ${JSON.stringify(side.birthsPerTurn)}; supply level after each turn ${JSON.stringify(run.levelAfterTurn.map(r4))}; alive after each turn ${JSON.stringify(run.aliveAfterTurn)}`);
  return run;
}

function replicaPair(a: string, b: string, ra: SideRun, rb: SideRun): void {
  const d = dice(ra, rb);
  const round = (o: DiceStats['sums']) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, { a: r3(x.a), b: r3(x.b), gap: r3(x.gap), between: x.between }]));
  console.log('REPLICA_PAIR ' + JSON.stringify({
    pairing: `${a}-${b}`, deadA: ra.dead.size, deadB: rb.dead.size,
    onlyA: [...ra.dead].filter(id => !rb.dead.has(id)).map(id => ra.names.get(id)),
    onlyB: [...rb.dead].filter(id => !ra.dead.has(id)).map(id => rb.names.get(id)),
    recordsDiffer: symdiff(ra.records, rb.records), bornDiffer: symdiff(ra.born, rb.born),
    sharedPersonYears: d.shared, sums: round(d.sums),
    gapAll: r3(Object.values(d.sums).reduce((s, x) => s + x.gap, 0)),
    gapByTurn: Object.fromEntries(Object.entries(d.gapByTurn).map(([k, x]) => [k, r3(x)])),
    flips: d.flips,
  }));
}

/**
 * Seed 950's dice near the rates: every age or accident die a side rolled
 * whose value is under 1.6 times the rate at a supply factor of 1 (the
 * person dies of that cause in that year at any factor above `critical`),
 * and every radiation die under three times its chance.
 */
function tieMap(key: string, run: SideRun): void {
  for (const row of run.rows ?? []) {
    const name = run.names.get(row.id) ?? row.id;
    if (row.cause === 'radiation') {
      if (row.u < 3 * row.h) console.log(`TIEMAP ${key} t${row.turn} y${row.step + 1} ${name} radiation u ${r6(row.u)} chance ${r6(row.h)} ${row.u < row.h ? 'DIES' : ''}`);
      continue;
    }
    const critical = (row.u * row.f) / row.h;
    if (critical < 1.6) console.log(`TIEMAP ${key} t${row.turn} y${row.step + 1} ${name} ${row.cause} u ${r6(row.u)} chance ${r6(row.h)} factor ${r4(row.f)} critical ${r4(critical)} ${row.u < row.h ? 'DIES' : ''}`);
  }
}

const UNBOUND = () => { measure.lo = 0.01; measure.hi = 100; };
const WIDE = () => { measure.lo = 0.25; measure.hi = 4; };

if (PART === 'base') {
  console.log('===== seed 950, each side with the heads its leader named, master rates =====');
  const reps: Record<string, SideRun> = {};
  for (const k of LIVE_KEYS) reps[k] = replicaSide(k);
  for (const p of PAIRINGS) replicaPair(p.a, p.b, reps[p.a], reps[p.b]);
  for (const k of ['A3', 'D3']) tieMap(k, reps[k]);
  console.log('===== the outcome draws at seed 950 and how each recorded event reads on them =====');
  for (const k of LIVE_KEYS) {
    for (const o of SIDES[k].outcomes) {
      const redrawn = classOf(950, o, 'redrawn');
      console.log(`OUTCOME ${k} t${o.turn} e${o.ei} ${o.category} risky ${o.risky} declared ${o.riskProb} draw ${r4(outcomeDraw(950, o.turn, o.ei))} recorded ${o.outcome} redrawn ${redrawn} ${redrawn === o.outcome ? 'same' : 'DIFFERS'}`);
    }
  }
  console.log('===== 61 seeds, no promotions, master rates =====');
  sweepVariant({ name: 'master' }, true);
  sweepVariant({ name: 'master, held grids of the sweeps' }, true, GRID_PAIRINGS);
}

if (PART === 'dose') {
  // How strongly must the age and accident rates read the supply level for most pairings to differ?
  for (const exp of [0.5, 1, 1.5, 2, 3, 4, 6]) {
    sweepVariant({ name: `level^-${exp}, no bounds`, set: () => { measure.exp = exp; UNBOUND(); } }, true);
  }
}

if (PART === 'supply') {
  const variants: Variant[] = [
    { name: 'master' },
    { name: 'level^-2 within 0.5 and 2', set: () => { measure.exp = 2; } },
    { name: 'level^-2 within 0.25 and 4', set: () => { measure.exp = 2; WIDE(); } },
    { name: 'level^-3 within 0.25 and 4', set: () => { measure.exp = 3; WIDE(); } },
    { name: 'per living person', set: () => { measure.per = 'alive'; } },
    { name: 'per person the roster ever held', set: () => { measure.per = 'roster'; } },
    { name: 'per living person, level^-2 within 0.25 and 4', set: () => { measure.per = 'alive'; measure.exp = 2; WIDE(); } },
    { name: 'per person the roster ever held, level^-2 within 0.25 and 4', set: () => { measure.per = 'roster'; measure.exp = 2; WIDE(); } },
    { name: 'food as a sixth supply', set: () => { measure.food = true; } },
    { name: 'food as a sixth supply, within 0.25 and 4', set: () => { measure.food = true; WIDE(); } },
    { name: 'food as a sixth supply, per person the roster ever held, within 0.25 and 4', set: () => { measure.food = true; measure.per = 'roster'; WIDE(); } },
    { name: 'morale reading, k 2', set: () => { measure.moraleK = 2; } },
    { name: 'morale reading, k 5', set: () => { measure.moraleK = 5; } },
  ];
  for (const v of variants) sweepVariant(v, false);
}

if (PART === 'events') {
  const variants: Variant[] = [{ name: 'master' }];
  for (const outcomes of ['held', 'redrawn'] as OutcomeMode[]) {
    variants.push(
      { name: `accident x2 after a safe failure, x3 after a risky one (${outcomes})`, outcomes, outcomeAccident: { conservative_failure: 2, risky_failure: 3 } },
      { name: `accident and age x1.5 after a safe failure, x2.5 after a risky one (${outcomes})`, outcomes, outcomeAccident: { conservative_failure: 1.5, risky_failure: 2.5 }, outcomeNatural: { conservative_failure: 1.5, risky_failure: 2.5 } },
      { name: `crisis chance 0.04 safe failure, 0.10 risky failure (${outcomes})`, outcomes, set: () => { crisis.mode = 'chance'; } },
      { name: `crisis chance 0.08 safe failure, 0.20 risky failure (${outcomes})`, outcomes, set: () => { crisis.mode = 'chance'; crisis.base = { conservative_failure: 0.08, risky_failure: 0.2 }; } },
      { name: `crisis count 1 safe failure, 2 risky failure (${outcomes})`, outcomes, set: () => { crisis.mode = 'count'; } },
      { name: `crisis count 2 safe failure, 4 risky failure (${outcomes})`, outcomes, set: () => { crisis.mode = 'count'; crisis.count = { conservative_failure: 2, risky_failure: 4 }; } },
    );
  }
  variants.push(
    { name: 'births x level', set: () => { measure.birthExp = 1; } },
    { name: 'births x level^2', set: () => { measure.birthExp = 2; } },
    { name: 'per person the roster ever held, with births x level', set: () => { measure.per = 'roster'; measure.birthExp = 1; } },
    { name: 'per person the roster ever held, crisis count 1 and 2 (held)', outcomes: 'held', set: () => { measure.per = 'roster'; crisis.mode = 'count'; } },
    { name: 'per person the roster ever held, crisis count 1 and 2 (redrawn)', outcomes: 'redrawn', set: () => { measure.per = 'roster'; crisis.mode = 'count'; } },
  );
  for (const v of variants) sweepVariant(v, false);
  // How often each seed's own outcome draws fail a recorded event.
  let failures = 0, events = 0, seedsWithNone = 0;
  for (const seed of SEEDS) {
    let any = false;
    for (const k of LIVE_KEYS) for (const o of SIDES[k].outcomes) {
      events++;
      if (classOf(seed, o, 'redrawn').endsWith('failure')) { failures++; any = true; }
    }
    if (!any) seedsWithNone++;
  }
  console.log('REDRAWN ' + JSON.stringify({ events, failures, share: r3(failures / events), seedsWithNoFailureOnAnySide: seedsWithNone }));
}

if (PART === 'pins') {
  // The numbers the suite's own method gives (`applySystemDeltas` to each
  // turn_done value, as tests/engine/mars-supplies-reach-who-lives.test.ts
  // holds a side), for the pairs a test would pin.
  console.log('===== seed 950 with heads, held by applySystemDeltas =====');
  const reps: Record<string, SideRun> = {};
  for (const k of LIVE_KEYS) reps[k] = replicaSide(k, 'delta');
  for (const [a, b] of [['A1', 'D1'], ['A2', 'D2'], ['A3', 'D3']]) {
    replicaPair(a, b, reps[a], reps[b]);
    for (const k of [a, b]) console.log(`PIN_DEAD ${k}: ${reps[k].dead.size} dead: ${[...reps[k].dead].map(id => reps[k].names.get(id)).sort().join(', ')}`);
  }
  console.log('===== 61 seeds, no promotions, held by applySystemDeltas =====');
  sweepVariant({ name: 'master, held by applySystemDeltas', hold: 'delta' }, false);
}

if (PART === 'life') {
  console.log('===== one die for a life for each cause, seed 950 with heads =====');
  const reps: Record<string, SideRun> = {};
  for (const k of LIVE_KEYS) reps[k] = replicaSide(k, 'patch', () => { measure.lifetime = true; });
  for (const p of PAIRINGS) {
    const a = reps[p.a], b = reps[p.b];
    const inB = new Map(b.deaths.map(d => [d.id, d]));
    const moved = a.deaths.filter(d => inB.has(d.id) && (inB.get(d.id)!.time !== d.time || inB.get(d.id)!.cause !== d.cause))
      .map(d => `${d.name} ${d.time} ${d.cause} | ${inB.get(d.id)!.time} ${inB.get(d.id)!.cause}`);
    console.log('LIFE_PAIR ' + JSON.stringify({
      pairing: `${p.a}-${p.b}`, kind: p.kind, deadA: a.dead.size, deadB: b.dead.size,
      onlyA: [...a.dead].filter(id => !b.dead.has(id)).map(id => a.names.get(id)),
      onlyB: [...b.dead].filter(id => !a.dead.has(id)).map(id => b.names.get(id)),
      sameDeadDifferentYearOrCause: moved,
    }));
  }
  console.log('===== 61 seeds, no promotions =====');
  sweepVariant({ name: 'master' }, false);
  sweepVariant({ name: 'one die for a life for each cause', set: () => { measure.lifetime = true; } }, false);
}

if (PART === 'gapfam') {
  // Two colonies that build alike: one holds every one of the five supplies
  // `g` above the other at every turn end, everything else equal.
  const SUPPLIES = ['lifeSupportCapacity', 'waterLitersPerDay', 'powerKw', 'pressurizedVolumeM3', 'infrastructureModules'];
  const scaled = (base: string, g: number): Side => {
    const from = SIDES[base];
    const held = Object.fromEntries(Object.entries(from.held).map(([k, values]) => [k, SUPPLIES.includes(k) ? values.map(x => x * (1 + g)) : values]));
    return { ...from, key: `${base}+${g}`, held };
  };
  for (const base of ['A3', 'D3', 'D2']) {
    for (const g of [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1]) {
      SIDES[`${base}+${g}`] = scaled(base, g);
    }
    const pairings: Pairing[] = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1].map(g => ({ a: base, b: `${base}+${g}`, kind: 'grid' as const }));
    sweepVariant({ name: `builders alike: ${base} against ${base} with every supply g higher` }, true, pairings);
    // At seed 950 with the heads the leader named.
    reset();
    const a = runSide(950, SIDES[base], { heads: true, trace: false, outcomes: 'held' });
    for (const g of [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1]) {
      const b = runSide(950, SIDES[`${base}+${g}`], { heads: true, trace: false, outcomes: 'held' });
      console.log(`GAP950 ${base} against ${base}+${g}: dead ${a.dead.size} and ${b.dead.size}; only under the lower ${JSON.stringify([...a.dead].filter(id => !b.dead.has(id)).map(id => a.names.get(id)))}; only under the higher ${JSON.stringify([...b.dead].filter(id => !a.dead.has(id)).map(id => b.names.get(id)))}; level after each turn ${JSON.stringify(b.levelAfterTurn.map(r4))}`);
    }
  }
}

if (PART === 'choice') {
  // What the one thing a commander decides (the risky option or a safe one)
  // does on master: the recorded events and the recorded adopted effects of
  // a side, with each event's outcome drawn on the seed's own draw against
  // the chosen option's chance and its effects taken from the scenario's
  // tables (`EffectRegistry.applyOutcome`), as the orchestrator does. The
  // tool modifiers a live run adds are left out on every side.
  const registry = EffectRegistry.forScenario(marsScenario);
  const POLICY_KEYS = ['infrastructureModules', 'foodMonthsReserve', 'morale', 'lifeSupportCapacity', 'powerKw', 'pressurizedVolumeM3', 'waterLitersPerDay', 'scienceOutput'];
  type Choice = 'recorded' | 'risky' | 'safe' | 'half';
  const bonus = (h: { openness: number; conscientiousness: number }, risky: boolean) =>
    (h.openness - 0.5) * 0.2 + (h.conscientiousness - 0.5) * 0.12 + ((risky ? h.openness : h.conscientiousness) - 0.5) * 0.1;
  interface ChoiceRun extends SideRun { classes: string[]; finalMetrics: Record<string, number> }
  const runChoice = (seed: number, side: Side, choice: Choice, heads: boolean): ChoiceRun => {
    const kernel = new SimulationKernel(seed, side.leader, scenarioKeyPersonnel(marsScenario), { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
    const founders = new Set(kernel.getState().agents.map(a => a.core.id));
    if (heads) for (const [id, department, role] of side.heads) kernel.promoteAgent(id, department as Department, role, side.leader);
    const levelAfterTurn: number[] = [];
    const aliveAfterTurn: number[] = [];
    const classes: string[] = [];
    TURNS.forEach(([turn, time], i) => {
      kernel.advanceTurn(turn, time, hook);
      const mine = side.outcomes.filter(o => o.turn === turn);
      // The adopted effects the live run recorded for the turn: what it ended with, less where the between-turn step left it, less what its outcomes moved.
      const policy: Record<string, number> = {};
      for (const k of POLICY_KEYS) {
        const moved = mine.reduce((sum, o) => sum + (o.deltas?.[k] ?? 0), 0);
        const d = side.held[k][i] - side.start![k][i] - moved;
        if (Math.abs(d) > 1e-9) policy[k] = d;
      }
      kernel.applySystemDeltas(policy);
      for (const o of mine) {
        const risky = choice === 'recorded' ? o.risky : choice === 'risky' ? true : choice === 'safe' ? false : turn % 2 === 1;
        const chance = outcomeSuccessChance(risky, o.riskProb, kernel.getState().metrics);
        const success = new SeededRng(seed).turnSeed(turn * 100 + o.ei).next() < chance;
        const cls = `${risky ? 'risky' : 'conservative'}_${success ? 'success' : 'failure'}` as TurnOutcome;
        classes.push(cls);
        const noise = new SeededRng(seed).turnSeed(turn * 100 + o.ei + 50).next() * 0.2 - 0.1;
        kernel.applySystemDeltas(registry.applyOutcome(o.category, cls, { personalityBonus: bonus(side.hexaco!, risky), noise }));
      }
      const after = kernel.getState();
      levelAfterTurn.push(supplyLevel(after.metrics as Record<string, unknown>, after.metadata.landingSupplies));
      aliveAfterTurn.push(after.agents.filter(a => a.health.alive).length);
    });
    const state = kernel.getState();
    const byId = new Map(state.agents.map(a => [a.core.id, a]));
    const deaths: Death[] = state.eventLog.filter(e => e.type === 'death' && e.agentId).map(e => ({
      id: e.agentId!, name: byId.get(e.agentId!)?.core.name ?? e.agentId!, time: e.time, turn: e.turn, cause: String(e.cause),
    }));
    const count = (type: string) => TURNS.map(([turn]) => state.eventLog.filter(e => e.type === type && e.turn === turn).length);
    return {
      dead: new Set(state.agents.filter(a => !a.health.alive).map(a => a.core.id)), founders,
      names: new Map(state.agents.map(a => [a.core.id, a.core.name])), deaths,
      records: new Set(deaths.map(d => `${d.id}|${d.time}|${d.cause}`)),
      born: new Set(state.eventLog.filter(e => e.type === 'birth' && e.agentId).map(e => e.agentId!)),
      living: new Set(state.agents.filter(a => a.health.alive).map(a => a.core.id)),
      rows: null, birthsPerTurn: count('birth'), deathsPerTurn: count('death'), levelAfterTurn, aliveAfterTurn, classes,
      finalMetrics: Object.fromEntries(POLICY_KEYS.map(k => [k, r2((state.metrics as Record<string, number>)[k])])),
    };
  };
  reset();
  console.log('===== seed 950 with heads: the computed trajectories beside the recorded ones =====');
  for (const k of LIVE_KEYS) {
    for (const choice of ['recorded', 'safe', 'half', 'risky'] as Choice[]) {
      const r = runChoice(950, SIDES[k], choice, true);
      console.log(`CHOICE950 ${k} ${choice}: dead ${r.dead.size}; level after each turn ${JSON.stringify(r.levelAfterTurn.map(r4))}; classes ${JSON.stringify(r.classes.map(c => c.replace('conservative', 'safe')))}; final ${JSON.stringify(r.finalMetrics)}`);
    }
    console.log(`CHOICE950 ${k} recorded turn ends give level ${JSON.stringify(TURNS.map((_, i) => r4(supplyLevel(Object.fromEntries(Object.entries(SIDES[k].held).map(([key, values]) => [key, values[i]])), { powerKw: 400, waterLitersPerDay: 800, pressurizedVolumeM3: 3000, infrastructureModules: 3, lifeSupportCapacity: 120 }))))}`);
  }
  console.log('===== 61 seeds, no promotions =====');
  const pairs: Array<[string, Choice, string, Choice]> = [];
  for (const n of ['1', '2', '3']) {
    pairs.push(
      [`A${n}`, 'recorded', `D${n}`, 'recorded'],
      [`A${n}`, 'risky', `D${n}`, 'recorded'],
      [`A${n}`, 'half', `D${n}`, 'recorded'],
      [`A${n}`, 'risky', `D${n}`, 'safe'],
      [`A${n}`, 'risky', `A${n}`, 'safe'],
      [`A${n}`, 'half', `A${n}`, 'safe'],
      [`D${n}`, 'risky', `D${n}`, 'safe'],
    );
  }
  const cache = new Map<string, ChoiceRun>();
  const get = (seed: number, key: string, choice: Choice) => {
    const id = `${seed}|${key}|${choice}`;
    let r = cache.get(id);
    if (!r) { r = runChoice(seed, SIDES[key], choice, false); cache.set(id, r); }
    return r;
  };
  for (const [ka, ca, kb, cb] of pairs) {
    let differ = 0, onlyA = 0, onlyB = 0, deathsA = 0, deathsB = 0, levelA = 0, levelB = 0, failA = 0, failB = 0, bothWays = 0;
    const ties: number[] = [];
    for (const seed of SEEDS) {
      const a = get(seed, ka, ca), b = get(seed, kb, cb);
      const oa = [...a.dead].filter(id => !b.dead.has(id)).length;
      const ob = [...b.dead].filter(id => !a.dead.has(id)).length;
      if (oa + ob > 0) differ++; else ties.push(seed);
      if (oa > 0 && ob > 0) bothWays++;
      onlyA += oa; onlyB += ob; deathsA += a.dead.size; deathsB += b.dead.size;
      levelA += a.levelAfterTurn[4]; levelB += b.levelAfterTurn[4];
      failA += a.classes.filter(c => c.endsWith('failure')).length; failB += b.classes.filter(c => c.endsWith('failure')).length;
    }
    const n = SEEDS.length;
    console.log('CHOICE ' + JSON.stringify({
      a: `${ka} ${ca}`, b: `${kb} ${cb}`, differ, bothWays, tieAt950: ties.includes(950),
      deathsA: r2(deathsA / n), deathsB: r2(deathsB / n), onlyA: r2(onlyA / n), onlyB: r2(onlyB / n),
      levelAfterTurn5A: r3(levelA / n), levelAfterTurn5B: r3(levelB / n), failuresA: r2(failA / n), failuresB: r2(failB / n),
    }));
  }
}
