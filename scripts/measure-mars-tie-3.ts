/**
 * Measurement for #234, last round: the supply reading as it would ship.
 *
 * The Mars scenario declares five supplies as sustaining its people (life
 * support capacity, water, power, pressurized volume, habitat modules), and
 * the yearly age and accident rates divide by the colony's supply level: the
 * geometric mean of those supplies against their landing-day amounts, within
 * a half and double. `supplyReading.on = false` runs master's rates beside it.
 *
 * Runs pairs of kernels the way a hosted pair run does (`new
 * SimulationKernel` with the Mars scenario and its preset roster, then
 * `advanceTurn` with its progression hook), holds each side's metrics after
 * every turn where the live runs' outcomes and adopted effects left them
 * (`applySystemDeltas`, the call both land in), and compares who died by
 * 2075. No model call. The same person rolls the same dice on both sides.
 * Nothing here is merged.
 */
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { dieTrace, supplyLevel, supplyReading, type DieRow } from '../src/engine/core/progression.js';
import { marsScenario } from '../src/engine/scenarios/index.js';
import { scenarioKeyPersonnel } from '../src/cli/sim-config.js';

const hook = marsScenario.hooks.progressionHook;
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';

/** What a side holds after each of the six turns, key by key. */
type Held = Record<string, number[]>;
type Promotion = [id: string, department: string, role: string];
interface Side { leader: string; held: Held; heads: Promotion[] }

// The live pair of 10 November 2026 (seed 950), `turn_done` metrics.
const L10_A: Held = {
  infrastructureModules: [4, 4, 4, 4, 4, 5],
  foodMonthsReserve: [19.22, 22.94, 29.34, 39.58, 47.59, 53.19],
  morale: [0.975, 0.892285, 1, 1, 1, 1],
  lifeSupportCapacity: [125, 120, 122.71, 118.71, 116.71, 121.71],
  powerKw: [498.66, 496.26, 478.06, 431.86, 466.94, 490.63],
  pressurizedVolumeM3: [3200, 3200, 3200, 3200, 3200, 3200],
  waterLitersPerDay: [900, 715.4, 625.4, 641.34, 571.34, 671.34],
  scienceOutput: [0, 8, 18, 29, 40, 51.52],
};
const L10_B: Held = {
  infrastructureModules: [4, 4, 4, 7.38, 9.79, 10.79],
  foodMonthsReserve: [19.19, 24.79, 35.49, 41.09, 54.802, 74.298],
  morale: [1, 0.873047, 1, 1, 1, 1],
  lifeSupportCapacity: [125, 125.67, 125.67, 139.15, 144.15, 149.15],
  powerKw: [518.07, 500.67, 438.27, 457.94, 467.8, 510.67],
  pressurizedVolumeM3: [3200, 3320, 3320, 3557.57, 3798.44, 3998.44],
  waterLitersPerDay: [900, 900, 960.06, 960.06, 960.06, 960.06],
  scienceOutput: [0, 8, 17, 25, 32, 46.29],
};
// The live pair of 8 November 2026 (seed 950, #221), `turn_done` metrics.
const L8_A: Held = {
  infrastructureModules: [4, 2.21, 3.21, 6.42, 8.42, 9.42],
  foodMonthsReserve: [19.22, 24.82, 30.484, 34.188, 46.786, 62.994],
  morale: [1, 1, 1, 1, 1, 1],
  lifeSupportCapacity: [125, 125, 130, 130, 130, 135],
  powerKw: [458.66, 403.9, 403.9, 470.06, 528.43, 586.42],
  pressurizedVolumeM3: [3200, 3021.47, 3021.47, 3242, 3292, 3492],
  waterLitersPerDay: [900, 900, 1008.89, 1008.89, 1008.89, 1008.89],
  scienceOutput: [0, 8, 16, 25, 33, 44.53],
};
const L8_B: Held = {
  infrastructureModules: [5, 7, 8, 11.22, 11.22, 11.22],
  foodMonthsReserve: [19.22, 23.9, 37.83, 53.03, 80.648, 103.576],
  morale: [1, 1, 1, 0.973047, 1, 1],
  lifeSupportCapacity: [125, 130.65, 130.65, 132.65, 132.65, 132.65],
  powerKw: [448.48, 429.08, 476.31, 536.32, 527.12, 579.91],
  pressurizedVolumeM3: [3200, 3320, 3320, 3542.36, 3542.36, 3542.36],
  waterLitersPerDay: [900, 809.49, 809.49, 809.49, 921.77, 921.77],
  scienceOutput: [1, 10, 19, 28, 38, 50.17],
};

const HEAD_ENG: Promotion = ['col-bruno-morales', 'engineering', 'Chief Engineer'];
const HEAD_AGR: Promotion = ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'];
const HEAD_SVEN: Promotion = ['col-sven-kim', 'medical', 'Chief Medical Officer'];
const HEAD_CARLOS: Promotion = ['col-carlos-fernandez', 'medical', 'Chief Medical Officer'];
/** 10 November: both leaders named the same three heads. */
const L10_HEADS: Promotion[] = [HEAD_SVEN, HEAD_ENG, HEAD_AGR];
/** 8 November: Aria Chen named Carlos Fernandez to medical, Dietrich Voss Sven Kim. */
const L8_HEADS_A: Promotion[] = [HEAD_CARLOS, HEAD_ENG, HEAD_AGR];
const L8_HEADS_B: Promotion[] = [HEAD_SVEN, HEAD_ENG, HEAD_AGR];

/** Who the live runs lost, with the year and the cause: [id, year, cause]. */
type LiveDeath = [string, number, string];
const LIVE10: LiveDeath[] = [
  ['col-liam-nkomo', 2037, 'accident: airlock failure'], ['col-dr-yuki-tanaka', 2039, 'accident: vehicle rollover'],
  ['col-bruno-eriksson', 2042, 'accident: vehicle rollover'], ['col-bruno-ito', 2043, 'radiation cancer'],
  ['col-chen-osei', 2046, 'radiation cancer'], ['col-yuki-cruz', 2052, 'age-related complications'],
  ['col-bruno-nkomo', 2055, 'accident: EVA accident'], ['col-dr-priya-singh', 2057, 'radiation cancer'],
  ['col-chen-ibrahim', 2057, 'age-related complications'], ['col-tomas-ahmad', 2058, 'age-related complications'],
  ['col-bruno-morales', 2059, 'accident: EVA accident'], ['col-born-2037-1263', 2059, 'accident: EVA accident'],
  ['col-olga-bakker', 2061, 'natural causes'], ['col-carlos-costa', 2065, 'age-related complications'],
  ['col-rosa-voss', 2067, 'age-related complications'], ['col-viktor-herrera', 2067, 'natural causes'],
  ['col-sven-kim', 2071, 'natural causes'], ['col-sofia-kim', 2071, 'age-related complications'],
];

const flat = (key: string, value: number): Held => ({ [key]: TURNS.map(() => value) });
const modulesHeld = (m: number): Held => flat('infrastructureModules', m);

interface Death { id: string; name: string; time: number; turn: number; cause: string; dose: number }
interface SideRun {
  dead: Set<string>;
  founders: Set<string>;
  names: Map<string, string>;
  deaths: Death[];
  rows: DieRow[] | null;
  births: number;
  moraleAfterAdvance: number[];
  /** The colony's supply level as each turn ended, which the next turn's years begin from. */
  levelAfterTurn: number[];
}

let cacheVariant = '';
const cache = new Map<string, SideRun>();

/** Six Mars turns on the preset roster with `side.held` set after each turn. */
function runSide(seed: number, side: Side, trace: boolean, variant: string): SideRun {
  if (variant !== cacheVariant) { cache.clear(); cacheVariant = variant; }
  const key = JSON.stringify([seed, side.held, side.heads]);
  if (!trace) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const kernel = new SimulationKernel(seed, side.leader, scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  const founders = new Set(kernel.getState().agents.map(a => a.core.id));
  for (const [id, department, role] of side.heads) kernel.promoteAgent(id, department, role, side.leader);
  dieTrace.rows = [];
  dieTrace.on = trace;
  const moraleAfterAdvance: number[] = [];
  const levelAfterTurn: number[] = [];
  TURNS.forEach(([turn, time], i) => {
    const metrics = kernel.advanceTurn(turn, time, hook).metrics as Record<string, number>;
    moraleAfterAdvance.push(Math.round(metrics.morale * 1e4) / 1e4);
    const deltas: Record<string, number> = {};
    for (const [k, values] of Object.entries(side.held)) deltas[k] = values[i] - metrics[k];
    kernel.applySystemDeltas(deltas);
    const after = kernel.getState();
    levelAfterTurn.push(Math.round(supplyLevel(after.metrics as Record<string, unknown>, after.metadata.landingSupplies) * 1000) / 1000);
  });
  dieTrace.on = false;
  const rows = trace ? dieTrace.rows : null;
  dieTrace.rows = [];
  const state = kernel.getState();
  const byId = new Map(state.agents.map(a => [a.core.id, a]));
  const deaths: Death[] = state.eventLog.filter(e => e.type === 'death' && e.agentId).map(e => {
    const a = byId.get(e.agentId!);
    return {
      id: e.agentId!, name: a?.core.name ?? e.agentId!, time: e.time, turn: e.turn, cause: String(e.cause),
      dose: Math.round((a?.health.cumulativeRadiationMsv ?? 0) * 10) / 10,
    };
  });
  const result: SideRun = {
    dead: new Set(state.agents.filter(a => !a.health.alive).map(a => a.core.id)),
    founders,
    names: new Map(state.agents.map(a => [a.core.id, a.core.name])),
    deaths, rows,
    births: state.eventLog.filter(e => e.type === 'birth').length,
    moraleAfterAdvance, levelAfterTurn,
  };
  if (!trace) cache.set(key, result);
  return result;
}

const CAUSES = ['natural', 'radiation', 'starvation', 'despair', 'fracture', 'accident'] as const;
type Cause = typeof CAUSES[number];

function causeOf(deathCause: string): string {
  if (deathCause.startsWith('accident')) return 'accident';
  if (deathCause === 'natural causes' || deathCause === 'age-related complications') return 'natural';
  if (deathCause === 'radiation cancer') return 'radiation';
  if (deathCause === 'habitat failure') return 'hardship';
  if (deathCause === 'fatal fracture') return 'fracture';
  return deathCause;
}

function tally(deaths: Death[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of deaths) out[causeOf(d.cause)] = (out[causeOf(d.cause)] ?? 0) + 1;
  return out;
}

interface Flip { turn: number; year: number; id: string; cause: string; u: number; hA: number; hB: number; deadA: boolean; deadB: boolean }
interface DiceStats {
  /** For each cause: the yearly chances summed over the person-years both sides share, and the dice between them. */
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
    if (ra.cause === 'natural') stats.shared++;
    const s = stats.sums[ra.cause];
    s.a += ra.h; s.b += rb.h;
    const lo = Math.min(ra.h, rb.h), hi = Math.max(ra.h, rb.h);
    if (hi > lo) {
      s.gap += hi - lo;
      stats.gapByTurn[String(ra.turn)] = (stats.gapByTurn[String(ra.turn)] ?? 0) + hi - lo;
      if (ra.u >= lo && ra.u < hi) {
        s.between++;
        stats.flips.push({
          turn: ra.turn, year: ra.step + 1, id: ra.id, cause: ra.cause, u: Math.round(ra.u * 1e6) / 1e6,
          hA: Math.round(ra.h * 1e6) / 1e6, hB: Math.round(rb.h * 1e6) / 1e6, deadA: a.dead.has(ra.id), deadB: b.dead.has(ra.id),
        });
      }
    }
  }
  return stats;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

interface PairConfig { name: string; a: Side; b: Side }
interface SweepRow {
  variant: string; config: string; seeds: number; differ: number; ties: number[];
  deathsA: number; deathsB: number; causesA: Record<string, number>; causesB: Record<string, number>;
  symDiff: number; onlyA: number; onlyB: number; founderOnlyBSeeds: number;
  gap?: Record<string, number>; sumA?: Record<string, number>; sumB?: Record<string, number>;
  between?: Record<string, number>; gapByTurn?: Record<string, number>; maskedShare?: number;
}

/** A pair over the 61 seeds under the candidate in force. */
function sweep(variant: string, cfg: PairConfig, trace: boolean): SweepRow {
  const n = SEEDS.length;
  let differ = 0, deathsA = 0, deathsB = 0, sym = 0, onlyA = 0, onlyB = 0, founderOnlyBSeeds = 0, flips = 0, masked = 0;
  const ties: number[] = [];
  const causesA: Record<string, number> = {}, causesB: Record<string, number> = {};
  const gap: Record<string, number> = {}, sumA: Record<string, number> = {}, sumB: Record<string, number> = {};
  const between: Record<string, number> = {}, gapByTurn: Record<string, number> = {};
  for (const seed of SEEDS) {
    const a = runSide(seed, cfg.a, trace, variant);
    const b = runSide(seed, cfg.b, trace, variant);
    const oa = [...a.dead].filter(id => !b.dead.has(id));
    const ob = [...b.dead].filter(id => !a.dead.has(id));
    if (oa.length + ob.length > 0) differ++; else ties.push(seed);
    sym += oa.length + ob.length; onlyA += oa.length; onlyB += ob.length;
    if (ob.some(id => b.founders.has(id))) founderOnlyBSeeds++;
    deathsA += a.dead.size; deathsB += b.dead.size;
    for (const [c, k] of Object.entries(tally(a.deaths))) causesA[c] = (causesA[c] ?? 0) + k;
    for (const [c, k] of Object.entries(tally(b.deaths))) causesB[c] = (causesB[c] ?? 0) + k;
    if (trace) {
      const d = dice(a, b);
      for (const c of CAUSES) {
        gap[c] = (gap[c] ?? 0) + d.sums[c].gap; sumA[c] = (sumA[c] ?? 0) + d.sums[c].a; sumB[c] = (sumB[c] ?? 0) + d.sums[c].b;
        between[c] = (between[c] ?? 0) + d.sums[c].between;
      }
      for (const [t, g] of Object.entries(d.gapByTurn)) gapByTurn[t] = (gapByTurn[t] ?? 0) + g;
      flips += d.flips.length;
      masked += d.flips.filter(f => f.deadA && f.deadB).length;
    }
  }
  const per = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== 0).map(([k, v]) => [k, r3(v / n)]));
  const row: SweepRow = {
    variant, config: cfg.name, seeds: n, differ, ties,
    deathsA: r2(deathsA / n), deathsB: r2(deathsB / n), causesA: per(causesA), causesB: per(causesB),
    symDiff: r2(sym / n), onlyA: r2(onlyA / n), onlyB: r2(onlyB / n), founderOnlyBSeeds,
  };
  if (trace) {
    row.gap = per(gap); row.sumA = per(sumA); row.sumB = per(sumB); row.between = per(between); row.gapByTurn = per(gapByTurn);
    row.maskedShare = flips > 0 ? r3(masked / flips) : 0;
  }
  return row;
}

interface ReplicaOut {
  variant: string; config: string; deadA: number; deadB: number; onlyA: string[]; onlyB: string[];
  causesA: Record<string, number>; causesB: Record<string, number>; births: [number, number];
}

/** One pair at seed 950 with its department heads, as the live run named them. */
function replica(variant: string, cfg: PairConfig, verbose: boolean, live?: LiveDeath[]): ReplicaOut {
  const a = runSide(950, cfg.a, true, variant);
  const b = runSide(950, cfg.b, true, variant);
  const onlyA = [...a.dead].filter(id => !b.dead.has(id)).map(id => a.names.get(id) ?? id).sort();
  const onlyB = [...b.dead].filter(id => !a.dead.has(id)).map(id => b.names.get(id) ?? id).sort();
  const out: ReplicaOut = {
    variant, config: cfg.name, deadA: a.dead.size, deadB: b.dead.size, onlyA, onlyB,
    causesA: tally(a.deaths), causesB: tally(b.deaths), births: [a.births, b.births],
  };
  if (verbose) {
    const d = dice(a, b);
    const round = (o: Record<string, { a: number; b: number; gap: number; between: number }>) => Object.fromEntries(
      Object.entries(o).filter(([, v]) => v.a + v.b > 0).map(([k, v]) => [k, { a: r3(v.a), b: r3(v.b), gap: r3(v.gap), between: v.between }]),
    );
    console.log('REPLICA ' + JSON.stringify({
      ...out, sharedPersonYears: d.shared, sums: round(d.sums),
      gapByTurn: Object.fromEntries(Object.entries(d.gapByTurn).map(([k, v]) => [k, r3(v)])),
      flips: d.flips, moraleAfterAdvance: [a.moraleAfterAdvance, b.moraleAfterAdvance],
      supplyLevelAfterTurn: [a.levelAfterTurn, b.levelAfterTurn],
    }));
    const inB = new Map(b.deaths.map(x => [x.id, x]));
    for (const x of a.deaths) {
      const y = inB.get(x.id);
      const same = y && y.time === x.time && y.cause === x.cause;
      console.log(`REPLICA_DEATH ${cfg.name} ${same ? 'same' : 'DIFFERS'} A t${x.turn} ${x.time} ${x.name} ${x.cause} ${x.dose} mSv` + (y ? ` | B t${y.turn} ${y.time} ${y.cause} ${y.dose} mSv` : ' | B alive'));
    }
    for (const y of b.deaths) if (!a.dead.has(y.id)) console.log(`REPLICA_DEATH ${cfg.name} DIFFERS A alive | B t${y.turn} ${y.time} ${y.name} ${y.cause} ${y.dose} mSv`);
    if (live) {
      for (const [label, side] of [['A', a], ['B', b]] as const) {
        const got = side.deaths.map(x => `${x.id}|${x.time}|${x.cause}`).sort();
        const want = live.map(([id, time, cause]) => `${id}|${time}|${cause}`).sort();
        const missing = want.filter(x => !got.includes(x));
        const extra = got.filter(x => !want.includes(x));
        console.log(`REPLICA_LIVE ${cfg.name} side ${label}: ${got.length} deaths here, ${want.length} live; same people, years and causes: ${missing.length === 0 && extra.length === 0}; live not here: ${JSON.stringify(missing)}; here not live: ${JSON.stringify(extra)}`);
      }
    }
  }
  return out;
}

const L10: PairConfig = { name: 'live pair of 10 Nov', a: { leader: ARIA, held: L10_A, heads: [] }, b: { leader: DIETRICH, held: L10_B, heads: [] } };
const L8: PairConfig = { name: 'live pair of 8 Nov', a: { leader: ARIA, held: L8_A, heads: [] }, b: { leader: DIETRICH, held: L8_B, heads: [] } };
/** Carlos Fernandez is one of the preset's five named people, so every seed has him. */
const L8_CMO: PairConfig = { name: 'live pair of 8 Nov, Aria names Carlos Fernandez to medical', a: { leader: ARIA, held: L8_A, heads: [HEAD_CARLOS] }, b: { leader: DIETRICH, held: L8_B, heads: [] } };
const L10_REPLICA: PairConfig = { name: 'replica of 10 Nov (seed 950, its heads)', a: { leader: ARIA, held: L10_A, heads: L10_HEADS }, b: { leader: DIETRICH, held: L10_B, heads: L10_HEADS } };
const L8_REPLICA: PairConfig = { name: 'replica of 8 Nov (seed 950, its heads)', a: { leader: ARIA, held: L8_A, heads: L8_HEADS_A }, b: { leader: DIETRICH, held: L8_B, heads: L8_HEADS_B } };

function gridConfigs(): PairConfig[] {
  const out: PairConfig[] = [];
  for (let m = 3; m <= 11; m++) {
    out.push({ name: `${m} against ${m + 1} modules`, a: { leader: ARIA, held: modulesHeld(m), heads: [] }, b: { leader: DIETRICH, held: modulesHeld(m + 1), heads: [] } });
  }
  out.push({ name: '5 against 11 modules', a: { leader: ARIA, held: modulesHeld(5), heads: [] }, b: { leader: DIETRICH, held: modulesHeld(11), heads: [] } });
  return out;
}

/** The trajectories #225's tests hold: six keys, water and science left to the kernel. */
const SIX = ['infrastructureModules', 'foodMonthsReserve', 'morale', 'lifeSupportCapacity', 'powerKw', 'pressurizedVolumeM3'];
const six = (held: Held): Held => Object.fromEntries(SIX.map(k => [k, held[k]]));
const T225: PairConfig = { name: "#225's test: the 8 Nov trajectories, six keys, no promotions", a: { leader: ARIA, held: six(L8_A), heads: [] }, b: { leader: DIETRICH, held: six(L8_B), heads: [] } };
const T225_REPLICA: PairConfig = { name: "#225's test: the 8 Nov pair at seed 950, six keys, its heads", a: { leader: ARIA, held: six(L8_A), heads: L8_HEADS_A }, b: { leader: DIETRICH, held: six(L8_B), heads: L8_HEADS_B } };

/** A colony that holds one supply a fifth under its landing level all run, against one that holds it there. */
function fifthUnder(key: string, landing: number): PairConfig {
  return {
    name: `${key} held at ${Math.round(landing * 0.8 * 100) / 100} against ${landing}, nothing else held`,
    a: { leader: ARIA, held: flat(key, landing * 0.8), heads: [] },
    b: { leader: DIETRICH, held: flat(key, landing), heads: [] },
  };
}

function line(tag: string, row: SweepRow): void {
  console.log(`${tag} ` + JSON.stringify(row));
}

for (const on of [false, true]) {
  supplyReading.on = on;
  const mode = on ? 'supply reading' : 'master rates';
  console.log(`\n===== ${mode} =====`);
  replica(mode, L10_REPLICA, true, LIVE10);
  replica(mode, L8_REPLICA, true);
  replica(mode, T225_REPLICA, true);
  line('ROW', sweep(mode, L10, true));
  line('ROW', sweep(mode, L8, true));
  line('ROW', sweep(mode, T225, true));
  for (const cfg of gridConfigs()) line('GRID', sweep(mode, cfg, true));
  line('SAME', sweep(mode, { name: '5 against 5 modules', a: { leader: ARIA, held: modulesHeld(5), heads: [] }, b: { leader: DIETRICH, held: modulesHeld(5), heads: [] } }, false));
  line('IDLE', sweep(mode, { name: 'nothing held (three modules, no decisions)', a: { leader: ARIA, held: {}, heads: [] }, b: { leader: DIETRICH, held: {}, heads: [] } }, false));
  for (const key of Object.keys(L10_A)) {
    line('ONLY', sweep(mode, {
      name: `10 Nov pair, only ${key} differs (the rest as Aria Chen held it)`,
      a: { leader: ARIA, held: L10_A, heads: [] },
      b: { leader: DIETRICH, held: { ...L10_A, [key]: L10_B[key] }, heads: [] },
    }, true));
  }
  for (const key of Object.keys(L8_A)) {
    line('ONLY', sweep(mode, {
      name: `8 Nov pair, only ${key} differs (the rest as Aria Chen held it)`,
      a: { leader: ARIA, held: L8_A, heads: [] },
      b: { leader: DIETRICH, held: { ...L8_A, [key]: L8_B[key] }, heads: [] },
    }, true));
  }
  for (const cfg of [fifthUnder('lifeSupportCapacity', 120), fifthUnder('waterLitersPerDay', 800), fifthUnder('powerKw', 400), fifthUnder('pressurizedVolumeM3', 3000), fifthUnder('infrastructureModules', 3)]) {
    line('FIFTH', sweep(mode, cfg, true));
  }
  // The failing tests the brief names, at the numbers they will pin.
  line('TEST', sweep(mode, { name: '5 against 5 modules, water 640 against 800', a: { leader: ARIA, held: { infrastructureModules: TURNS.map(() => 5), waterLitersPerDay: TURNS.map(() => 640) }, heads: [] }, b: { leader: DIETRICH, held: { infrastructureModules: TURNS.map(() => 5), waterLitersPerDay: TURNS.map(() => 800) }, heads: [] } }, true));
  for (const [key, low, high] of [['lifeSupportCapacity', 96, 144], ['waterLitersPerDay', 640, 960], ['powerKw', 320, 480], ['pressurizedVolumeM3', 2400, 3600]] as Array<[string, number, number]>) {
    line('TEST', sweep(mode, { name: `${key} held at ${low} against ${high}, nothing else held`, a: { leader: ARIA, held: flat(key, low), heads: [] }, b: { leader: DIETRICH, held: flat(key, high), heads: [] } }, true));
  }
  line('TEST', sweep(mode, { name: 'all four of life support, water, power and volume a fifth under landing against a fifth over, nothing else held', a: { leader: ARIA, held: { lifeSupportCapacity: TURNS.map(() => 96), waterLitersPerDay: TURNS.map(() => 640), powerKw: TURNS.map(() => 320), pressurizedVolumeM3: TURNS.map(() => 2400) }, heads: [] }, b: { leader: DIETRICH, held: { lifeSupportCapacity: TURNS.map(() => 144), waterLitersPerDay: TURNS.map(() => 960), powerKw: TURNS.map(() => 480), pressurizedVolumeM3: TURNS.map(() => 3600) }, heads: [] } }, true));
  line('TEST', sweep(mode, { name: '10 Nov pair with every supply but the modules as live (modules 4 on both sides)', a: { leader: ARIA, held: L10_A, heads: [] }, b: { leader: DIETRICH, held: { ...L10_B, infrastructureModules: L10_A.infrastructureModules }, heads: [] } }, true));
  line('LATE', sweep(mode, {
    name: 'modules 4 all run against 4, 4, 4, 7.38, 9.79, 10.79, nothing else held',
    a: { leader: ARIA, held: { infrastructureModules: L10_A.infrastructureModules }, heads: [] },
    b: { leader: DIETRICH, held: { infrastructureModules: L10_B.infrastructureModules }, heads: [] },
  }, true));
  // Each key a decision moves, alone, across the range the two live pairs reached, held all run.
  const RANGES: Array<[string, number, number]> = [
    ['infrastructureModules', 2.21, 11.22], ['foodMonthsReserve', 19.19, 103.576], ['morale', 0.873047, 1],
    ['lifeSupportCapacity', 116.71, 149.15], ['powerKw', 403.9, 586.42], ['pressurizedVolumeM3', 3021.47, 3998.44],
    ['waterLitersPerDay', 571.34, 1008.89], ['scienceOutput', 0, 51.52],
  ];
  for (const [key, low, high] of RANGES) {
    line('CHANNEL', sweep(mode, {
      name: `${key} held at ${low} against ${high}, nothing else held`,
      a: { leader: ARIA, held: flat(key, low), heads: [] },
      b: { leader: DIETRICH, held: flat(key, high), heads: [] },
    }, true));
  }
}
