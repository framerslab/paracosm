/**
 * Measurement for #221: two Mars leaders whose decisions left the colonies
 * far apart (modules 4 against 5 from turn 1, 9.42 against 11.22 at the end)
 * still lost the same 17 people.
 *
 * Runs pairs of kernels the way a pair run does (`new SimulationKernel` with
 * the Mars scenario, then `advanceTurn` with its progression hook, the calls
 * the orchestrator makes), holds each side's metrics at the values a run
 * reached after each turn (through `applySystemDeltas`, the call an outcome
 * and an adopted effect land in), and compares who died by 2075.
 *
 * Three readings, no model call:
 *
 * 1. REPLICA: seed 950 on the scenario's preset roster with the live pair's
 *    department heads and metric trajectories, listing each side's deaths
 *    with the year and the cause, the dice that fell between the two sides'
 *    radiation hazards, and whether the dead sets match the live pair's.
 * 2. MEASURE: over 61 seeds, how often the dead sets differ for each pair of
 *    trajectories (the live pair's, the earlier sweep's 3 against 4 modules,
 *    4 against 5 held all run), on the generator's roster (as the earlier
 *    sweep ran) and on the preset roster (as a hosted run does).
 * 3. HAZARDS: for each configuration, the yearly hazards summed over the
 *    person-years both sides share: radiation on each side and the gap
 *    between them, natural, accident. The gap is the expected number of
 *    people whose radiation die falls between the two sides' hazards, so
 *    `exp(-gap)` is about the share of seeds that tie.
 *
 * Prints one JSON line per reading and a table.
 */
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { SeededRng } from '../src/engine/core/rng.js';
import { causeHazards } from '../src/engine/core/progression.js';
import { habitatDoseShare } from '../src/engine/physics/mars-radiation-bone.js';
import { marsScenario } from '../src/engine/scenarios/index.js';
import type { Agent } from '../src/engine/core/state.js';
import type { KeyPersonnel } from '../src/engine/core/agent-generator.js';

const hook = marsScenario.hooks.progressionHook;
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const SURFACE_MSV_PER_YEAR = 0.67 * 365;

/** The scenario's own key people, as `scenarioKeyPersonnel` reads them for a hosted run. */
function presetPersonnel(): KeyPersonnel[] {
  const presets = (marsScenario as any).presets ?? [];
  const preset = presets.find((p: any) => p.id === 'default') ?? presets[0];
  return ((preset?.personnel ?? []) as any[]).map(p => ({
    name: p.name, department: p.department, role: p.role, specialization: p.specialization, age: p.age, featured: p.featured,
  }));
}

type Roster = 'generator' | 'preset';

function mars(seed: number, roster: Roster, leader = 'Aria Chen'): SimulationKernel {
  const keyPersonnel = roster === 'preset' ? presetPersonnel() : [];
  return new SimulationKernel(seed, leader, keyPersonnel, { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
}

/** Metric values a side reached at each turn's end (index 0 = after turn 1). */
interface Trajectory {
  modules: number[];
  food?: number[];
  morale?: number[];
  lifeSupport?: number[];
  power?: number[];
  volume?: number[];
}

/** The live pair of 8 November 2026 (run_b1d843da, seed 950), turn_done metrics. */
const LIVE_A: Trajectory = {
  modules: [4, 2.21, 3.21, 6.42, 8.42, 9.42],
  food: [19.22, 24.82, 30.48, 34.19, 46.79, 62.99],
  morale: [1, 1, 1, 1, 1, 1],
  lifeSupport: [125, 125, 130, 130, 130, 135],
  power: [458.66, 403.9, 403.9, 470.06, 528.43, 586.42],
  volume: [3200, 3021.47, 3021.47, 3242, 3292, 3492],
};
const LIVE_B: Trajectory = {
  modules: [5, 7, 8, 11.22, 11.22, 11.22],
  food: [19.22, 23.9, 37.83, 53.03, 80.65, 103.58],
  morale: [1, 1, 1, 0.973, 1, 1],
  lifeSupport: [125, 130.65, 130.65, 132.65, 132.65, 132.65],
  power: [448.48, 429.08, 476.31, 536.32, 527.12, 579.91],
  volume: [3200, 3320, 3320, 3542.36, 3542.36, 3542.36],
};
const flat = (v: number): Trajectory => ({ modules: [v, v, v, v, v, v] });

/** The live pair's department heads: a promotion changes the accident weight. */
const LIVE_HEADS: Record<string, Array<[string, string, string]>> = {
  A: [['col-carlos-fernandez', 'medical', 'Chief Medical Officer'], ['col-bruno-morales', 'engineering', 'Chief Engineer'], ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture']],
  B: [['col-sven-kim', 'medical', 'Chief Medical Officer'], ['col-bruno-morales', 'engineering', 'Chief Engineer'], ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture']],
};

/** The 17 people the live pair lost on both sides. */
const LIVE_DEAD = ['col-bruno-eriksson', 'col-bruno-morales', 'col-bruno-nkomo', 'col-carlos-costa', 'col-chen-ibrahim', 'col-chen-osei', 'col-dr-priya-singh', 'col-dr-yuki-tanaka', 'col-liam-nkomo', 'col-olga-bakker', 'col-rosa-voss', 'col-sofia-kim', 'col-sol-tanaka', 'col-sven-kim', 'col-tomas-ahmad', 'col-viktor-herrera', 'col-yuki-cruz'];

function hold(k: SimulationKernel, t: Trajectory, i: number): void {
  const m = k.getState().metrics as Record<string, number>;
  const want: Record<string, number> = { infrastructureModules: t.modules[i] };
  if (t.food) want.foodMonthsReserve = t.food[i];
  if (t.morale) want.morale = t.morale[i];
  if (t.lifeSupport) want.lifeSupportCapacity = t.lifeSupport[i];
  if (t.power) want.powerKw = t.power[i];
  if (t.volume) want.pressurizedVolumeM3 = t.volume[i];
  const deltas: Record<string, number> = {};
  for (const [key, v] of Object.entries(want)) deltas[key] = v - m[key];
  k.applySystemDeltas(deltas);
}

function deadIds(k: SimulationKernel): Set<string> {
  return new Set(k.getState().agents.filter(a => !a.health.alive).map(a => a.core.id));
}

interface Death { id: string; name: string; time: number; cause: string; dose: number; age: number }
function deaths(k: SimulationKernel): Death[] {
  const byId = new Map(k.getState().agents.map(a => [a.core.id, a]));
  return k.getState().eventLog.filter(e => e.type === 'death' && e.agentId).map(e => {
    const a = byId.get(e.agentId!)!;
    const m = /cumulative (\d+) mSv/.exec(e.description);
    return { id: a.core.id, name: a.core.name, time: e.time, cause: String(e.cause), dose: m ? Number(m[1]) : Math.round(a.health.cumulativeRadiationMsv ?? 0), age: Math.floor(k.ageYears(a)) };
  }).sort((x, y) => x.time - y.time || x.id.localeCompare(y.id));
}

function causeTally(ds: Death[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of ds) {
    const c = d.cause.replace(/^accident: .*/, 'accident');
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

/** Hazards over the eight years of the coming turn, for the people alive on both sides at its start. */
interface HazardSums { radA: number; radB: number; radGap: number; natural: number; accidentA: number; accidentB: number; personYears: number }

function hazardsForTurn(a: SimulationKernel, b: SimulationKernel, years: number): HazardSums {
  const sa = a.getState(), sb = b.getState();
  const byIdB = new Map(sb.agents.map(p => [p.core.id, p]));
  const perYearA = SURFACE_MSV_PER_YEAR * habitatDoseShare(sa.metrics as Record<string, unknown>);
  const perYearB = SURFACE_MSV_PER_YEAR * habitatDoseShare(sb.metrics as Record<string, unknown>);
  const sums: HazardSums = { radA: 0, radB: 0, radGap: 0, natural: 0, accidentA: 0, accidentB: 0, personYears: 0 };
  for (const pa of sa.agents) {
    const pb = byIdB.get(pa.core.id);
    if (!pa.health.alive || !pb?.health.alive) continue;
    for (let y = 1; y <= years; y++) {
      const age = a.ageYears(pa) + y;
      const atA: Agent = { ...pa, health: { ...pa.health, cumulativeRadiationMsv: (pa.health.cumulativeRadiationMsv ?? 0) + perYearA * y } };
      const atB: Agent = { ...pb, health: { ...pb.health, cumulativeRadiationMsv: (pb.health.cumulativeRadiationMsv ?? 0) + perYearB * y } };
      const hA = causeHazards(atA, sa.metrics as Record<string, unknown>, age, 1);
      const hB = causeHazards(atB, sb.metrics as Record<string, unknown>, age, 1);
      sums.radA += hA.radiation; sums.radB += hB.radiation; sums.radGap += Math.abs(hA.radiation - hB.radiation);
      sums.natural += hA.natural; sums.accidentA += hA.accident; sums.accidentB += hB.accident;
      sums.personYears += 1;
    }
  }
  return sums;
}

/** The radiation dice of the coming turn that fall between the two sides' hazards. */
interface Flip { turn: number; year: number; id: string; name: string; u: number; hA: number; hB: number; doseA: number; doseB: number }
function flipsForTurn(a: SimulationKernel, b: SimulationKernel, turn: number, years: number, seed: number): Flip[] {
  const sa = a.getState(), sb = b.getState();
  const byIdB = new Map(sb.agents.map(p => [p.core.id, p]));
  const perYearA = SURFACE_MSV_PER_YEAR * habitatDoseShare(sa.metrics as Record<string, unknown>);
  const perYearB = SURFACE_MSV_PER_YEAR * habitatDoseShare(sb.metrics as Record<string, unknown>);
  const out: Flip[] = [];
  for (const pa of sa.agents) {
    const pb = byIdB.get(pa.core.id);
    if (!pa.health.alive || !pb?.health.alive) continue;
    for (let step = 0; step < years; step++) {
      const age = a.ageYears(pa) + step + 1;
      const doseA = (pa.health.cumulativeRadiationMsv ?? 0) + perYearA * (step + 1);
      const doseB = (pb.health.cumulativeRadiationMsv ?? 0) + perYearB * (step + 1);
      const hA = causeHazards({ ...pa, health: { ...pa.health, cumulativeRadiationMsv: doseA } }, sa.metrics as Record<string, unknown>, age, 1).radiation;
      const hB = causeHazards({ ...pb, health: { ...pb.health, cumulativeRadiationMsv: doseB } }, sb.metrics as Record<string, unknown>, age, 1).radiation;
      const lo = Math.min(hA, hB), hi = Math.max(hA, hB);
      if (hi <= lo) continue;
      const u = SeededRng.forDraw(seed, turn, pa.core.id, step === 0 ? 'radiation' : `radiation@${step}`).next();
      if (u >= lo && u < hi) out.push({ turn, year: step + 1, id: pa.core.id, name: pa.core.name, u: Math.round(u * 1e6) / 1e6, hA: Math.round(hA * 1e6) / 1e6, hB: Math.round(hB * 1e6) / 1e6, doseA: Math.round(doseA), doseB: Math.round(doseB) });
    }
  }
  return out;
}

interface PairResult {
  deadA: Set<string>; deadB: Set<string>; deathsA: Death[]; deathsB: Death[]; firstTurn: number | null;
  hazards: HazardSums; flips: Flip[]; minPsychA: number; minPsychB: number; minBoneA: number; minBoneB: number;
}

function runPair(seed: number, roster: Roster, tA: Trajectory, tB: Trajectory, heads?: typeof LIVE_HEADS, flips = false): PairResult {
  const a = mars(seed, roster, 'Aria Chen');
  const b = mars(seed, roster, 'Dietrich Voss');
  if (heads) {
    for (const [id, dept, role] of heads.A) a.promoteAgent(id, dept as any, role, 'Aria Chen');
    for (const [id, dept, role] of heads.B) b.promoteAgent(id, dept as any, role, 'Dietrich Voss');
  }
  const hazards: HazardSums = { radA: 0, radB: 0, radGap: 0, natural: 0, accidentA: 0, accidentB: 0, personYears: 0 };
  const flipList: Flip[] = [];
  let firstTurn: number | null = null;
  let prevTime = 2035;
  TURNS.forEach(([turn, time], i) => {
    const years = time - prevTime;
    if (years > 0) {
      const h = hazardsForTurn(a, b, years);
      for (const key of Object.keys(hazards) as Array<keyof HazardSums>) hazards[key] += h[key];
      if (flips) flipList.push(...flipsForTurn(a, b, turn, years, seed));
    }
    a.advanceTurn(turn, time, hook);
    b.advanceTurn(turn, time, hook);
    hold(a, tA, i);
    hold(b, tB, i);
    if (firstTurn === null) {
      const da = deadIds(a), db = deadIds(b);
      if (da.size !== db.size || [...da].some(id => !db.has(id))) firstTurn = turn;
    }
    prevTime = time;
  });
  const minOf = (k: SimulationKernel, f: (p: Agent) => number) => Math.min(...k.getState().agents.filter(p => p.health.alive).map(f));
  return {
    deadA: deadIds(a), deadB: deadIds(b), deathsA: deaths(a), deathsB: deaths(b), firstTurn, hazards, flips: flipList,
    minPsychA: minOf(a, p => p.health.psychScore), minPsychB: minOf(b, p => p.health.psychScore),
    minBoneA: minOf(a, p => p.health.boneDensityPct ?? 100), minBoneB: minOf(b, p => p.health.boneDensityPct ?? 100),
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

// 1. The replica of the live pair.
{
  const k = mars(950, 'preset');
  const roster = k.getState().agents.map(a => ({ id: a.core.id, age: Math.floor(k.ageYears(a)), dept: a.core.department })).sort((x, y) => x.age - y.age || x.id.localeCompare(y.id));
  console.log('REPLICA_ROSTER ' + JSON.stringify(roster));
  const r = runPair(950, 'preset', LIVE_A, LIVE_B, LIVE_HEADS, true);
  const sym = [...[...r.deadA].filter(id => !r.deadB.has(id)), ...[...r.deadB].filter(id => !r.deadA.has(id))].sort();
  const liveDead = new Set(LIVE_DEAD);
  const sameAsLive = r.deadA.size === liveDead.size && [...r.deadA].every(id => liveDead.has(id));
  console.log('REPLICA ' + JSON.stringify({
    deadA: r.deadA.size, deadB: r.deadB.size, symmetricDifference: sym, firstDivergenceTurn: r.firstTurn,
    deadSetMatchesLivePair: sameAsLive, notInLive: [...r.deadA].filter(id => !liveDead.has(id)), liveNotHere: LIVE_DEAD.filter(id => !r.deadA.has(id)),
    causesA: causeTally(r.deathsA), causesB: causeTally(r.deathsB),
    hazards: Object.fromEntries(Object.entries(r.hazards).map(([k, v]) => [k, r3(v)])),
    flips: r.flips, minPsych: [r3(r.minPsychA), r3(r.minPsychB)], minBone: [r2(r.minBoneA), r2(r.minBoneB)],
  }));
  const byIdB = new Map(r.deathsB.map(d => [d.id, d]));
  for (const d of r.deathsA) {
    const e = byIdB.get(d.id);
    const same = e && e.time === d.time && e.cause === d.cause;
    console.log(`REPLICA_DEATH ${same ? 'same' : 'DIFFERS'} A ${d.time} ${d.name} (${d.age}) ${d.cause}${/radiation/.test(d.cause) ? ` ${d.dose} mSv` : ''}` + (e ? ` | B ${e.time} ${e.cause}${/radiation/.test(e.cause) ? ` ${e.dose} mSv` : ''}` : ' | B alive'));
  }
  for (const e of r.deathsB) if (!r.deadA.has(e.id)) console.log(`REPLICA_DEATH DIFFERS A alive | B ${e.time} ${e.name} (${e.age}) ${e.cause}`);
}

// 2 and 3. The sweep over seeds.
interface Config { name: string; roster: Roster; tA: Trajectory; tB: Trajectory }
const CONFIGS: Config[] = [
  { name: 'baseline vs baseline (3 modules)', roster: 'generator', tA: flat(3), tB: flat(3) },
  { name: 'earlier sweep: 3 vs 4 modules from turn 1', roster: 'generator', tA: flat(3), tB: flat(4) },
  { name: 'earlier sweep: 3 vs 4 modules from turn 1', roster: 'preset', tA: flat(3), tB: flat(4) },
  { name: 'live turn-1 gap held: 4 vs 5 modules', roster: 'generator', tA: flat(4), tB: flat(5) },
  { name: 'live turn-1 gap held: 4 vs 5 modules', roster: 'preset', tA: flat(4), tB: flat(5) },
  { name: 'both at the cap: 5 vs 11 modules', roster: 'generator', tA: flat(5), tB: flat(11) },
  { name: 'live pair trajectories (all metrics)', roster: 'generator', tA: LIVE_A, tB: LIVE_B },
  { name: 'live pair trajectories (all metrics)', roster: 'preset', tA: LIVE_A, tB: LIVE_B },
  { name: 'live pair modules only', roster: 'generator', tA: { modules: LIVE_A.modules }, tB: { modules: LIVE_B.modules } },
];

interface Row {
  config: string; roster: Roster; seeds: number; seedsDiffer: number; tieSeeds: number[]; meanSymDiff: number; firstDivergenceTurns: Record<string, number>;
  deathsA: number; deathsB: number; causesA: Record<string, number>; causesB: Record<string, number>;
  radA: number; radB: number; radGap: number; expTieFromGap: number; natural: number; accidentA: number; accidentB: number; personYears: number;
  bSubsetOfA: number; minPsych: number; minBone: number;
}
const rows: Row[] = [];
for (const cfg of CONFIGS) {
  let seedsDiffer = 0, symSum = 0, deathsA = 0, deathsB = 0, bSubsetOfA = 0;
  const first: Record<string, number> = {};
  const causesA: Record<string, number> = {}, causesB: Record<string, number> = {};
  const hz: HazardSums = { radA: 0, radB: 0, radGap: 0, natural: 0, accidentA: 0, accidentB: 0, personYears: 0 };
  let minPsych = 1, minBone = 100;
  const ties: number[] = [];
  for (const seed of SEEDS) {
    const r = runPair(seed, cfg.roster, cfg.tA, cfg.tB);
    const sym = [...r.deadA].filter(id => !r.deadB.has(id)).length + [...r.deadB].filter(id => !r.deadA.has(id)).length;
    if (sym > 0) seedsDiffer++; else ties.push(seed);
    symSum += sym;
    if ([...r.deadB].every(id => r.deadA.has(id))) bSubsetOfA++;
    if (r.firstTurn !== null) first[String(r.firstTurn)] = (first[String(r.firstTurn)] ?? 0) + 1;
    deathsA += r.deadA.size; deathsB += r.deadB.size;
    for (const [c, n] of Object.entries(causeTally(r.deathsA))) causesA[c] = (causesA[c] ?? 0) + n;
    for (const [c, n] of Object.entries(causeTally(r.deathsB))) causesB[c] = (causesB[c] ?? 0) + n;
    for (const key of Object.keys(hz) as Array<keyof HazardSums>) hz[key] += r.hazards[key];
    minPsych = Math.min(minPsych, r.minPsychA, r.minPsychB); minBone = Math.min(minBone, r.minBoneA, r.minBoneB);
  }
  const n = SEEDS.length;
  rows.push({
    config: cfg.name, roster: cfg.roster, seeds: n, seedsDiffer, tieSeeds: ties, meanSymDiff: r2(symSum / n), firstDivergenceTurns: first,
    deathsA, deathsB, causesA, causesB,
    radA: r3(hz.radA / n), radB: r3(hz.radB / n), radGap: r3(hz.radGap / n), expTieFromGap: r3(Math.exp(-hz.radGap / n)),
    natural: r3(hz.natural / n), accidentA: r3(hz.accidentA / n), accidentB: r3(hz.accidentB / n), personYears: r2(hz.personYears / n),
    bSubsetOfA, minPsych: r3(minPsych), minBone: r2(minBone),
  });
}
for (const row of rows) console.log('MEASURE ' + JSON.stringify(row));
console.log('\nconfig | roster | seeds differ | ties | mean sym diff | deaths A/B | radiation deaths A/B | yearly hazard sums per seed: rad A / rad B / gap (exp(-gap)) / natural / accident A / B');
for (const row of rows) {
  console.log(`${row.config} | ${row.roster} | ${row.seedsDiffer}/${row.seeds} | ${row.tieSeeds.join(',') || 'none'} | ${row.meanSymDiff} | ${row.deathsA}/${row.deathsB} | ${row.causesA['radiation cancer'] ?? 0}/${row.causesB['radiation cancer'] ?? 0} | ${row.radA} / ${row.radB} / ${row.radGap} (${row.expTieFromGap}) / ${row.natural} / ${row.accidentA} / ${row.accidentB}`);
}
