/**
 * Round 3 of the measurement for #221: the radiation channel with its two
 * gates opened, on the configurations of rounds 1 and 2.
 *
 * Round 2 found one person's dice independent of each other (the live
 * pair's two same-turn deaths were independent small dice), and the two
 * colonies' dead sets equal on every seed once both hold 4.5 modules or
 * more, where the habitat's shielding stops. This round measures, 61 seeds
 * each, the shielding without that stop (each module keeps out a quarter, or
 * a fifth, of the dose that reaches it) with the radiation hazard as it is
 * (0.004 a year for each sievert above 0.5) and as a linear hazard with no
 * threshold (0.003 a year for each sievert), and how much each changes the
 * built-in Lunar Outpost run, whose habitat shields its regolith exposure
 * with the same function and whose exposure the same radiation hazard reads.
 *
 * No model call. Prints one JSON line per reading and a table.
 */
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { SeededRng } from '../src/engine/core/rng.js';
import { causeHazards, radiationMeasurement } from '../src/engine/core/progression.js';
import { habitatDoseShare, shieldMeasurement } from '../src/engine/physics/mars-radiation-bone.js';
import { marsScenario, lunarScenario } from '../src/engine/scenarios/index.js';
import type { Agent } from '../src/engine/core/state.js';
import type { KeyPersonnel } from '../src/engine/core/agent-generator.js';

const hook = marsScenario.hooks.progressionHook;
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const SURFACE_MSV_PER_YEAR = 0.67 * 365;

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

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const die = (seed: number, turn: number, id: string, cause: string, step: number) =>
  SeededRng.forDraw(seed, turn, id, step === 0 ? cause : `${cause}@${step}`).next();

// ------------------------------------------------------------ B. VARIANTS
interface Trajectory { modules: number[]; food?: number[]; morale?: number[]; lifeSupport?: number[]; power?: number[]; volume?: number[] }
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
const LIVE_HEADS: Record<'A' | 'B', Array<[string, string, string]>> = {
  A: [['col-carlos-fernandez', 'medical', 'Chief Medical Officer'], ['col-bruno-morales', 'engineering', 'Chief Engineer'], ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture']],
  B: [['col-sven-kim', 'medical', 'Chief Medical Officer'], ['col-bruno-morales', 'engineering', 'Chief Engineer'], ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture']],
};
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

interface Death { id: string; name: string; turn: number; time: number; cause: string; dose: number }
function deaths(k: SimulationKernel): Death[] {
  const byId = new Map(k.getState().agents.map(a => [a.core.id, a]));
  return k.getState().eventLog.filter(e => e.type === 'death' && e.agentId).map(e => {
    const a = byId.get(e.agentId!)!;
    const m = /cumulative (\d+) mSv/.exec(e.description);
    return { id: a.core.id, name: a.core.name, turn: e.turn, time: e.time, cause: String(e.cause).replace(/^accident: .*/, 'accident'), dose: m ? Number(m[1]) : -1 };
  });
}

/** A die of the coming turn that falls between the two sides' radiation hazards. */
interface Flip { turn: number; year: number; id: string }
interface Sums { radA: number; radB: number; radGap: number; natural: number; accident: number }

function turnReadings(a: SimulationKernel, b: SimulationKernel, turn: number, years: number, seed: number, sums: Sums, flips: Flip[]): void {
  const sa = a.getState(), sb = b.getState();
  const byIdB = new Map(sb.agents.map(p => [p.core.id, p]));
  const perYearA = SURFACE_MSV_PER_YEAR * habitatDoseShare(sa.metrics as Record<string, unknown>);
  const perYearB = SURFACE_MSV_PER_YEAR * habitatDoseShare(sb.metrics as Record<string, unknown>);
  for (const pa of sa.agents) {
    const pb = byIdB.get(pa.core.id);
    if (!pa.health.alive || !pb?.health.alive) continue;
    for (let step = 0; step < years; step++) {
      const age = a.ageYears(pa) + step + 1;
      const doseA = (pa.health.cumulativeRadiationMsv ?? 0) + perYearA * (step + 1);
      const doseB = (pb.health.cumulativeRadiationMsv ?? 0) + perYearB * (step + 1);
      const hA = causeHazards({ ...pa, health: { ...pa.health, cumulativeRadiationMsv: doseA } }, sa.metrics as Record<string, unknown>, age, 1);
      const hB = causeHazards({ ...pb, health: { ...pb.health, cumulativeRadiationMsv: doseB } }, sb.metrics as Record<string, unknown>, age, 1);
      sums.radA += hA.radiation; sums.radB += hB.radiation; sums.radGap += Math.abs(hA.radiation - hB.radiation);
      sums.natural += hA.natural; sums.accident += hA.accident;
      const lo = Math.min(hA.radiation, hB.radiation), hi = Math.max(hA.radiation, hB.radiation);
      if (hi > lo) {
        const u = die(seed, turn, pa.core.id, 'radiation', step);
        if (u >= lo && u < hi) flips.push({ turn, year: step + 1, id: pa.core.id });
      }
    }
  }
}

interface PairResult { deathsA: Death[]; deathsB: Death[]; deadA: Set<string>; deadB: Set<string>; sums: Sums; flips: Flip[] }
function runPair(seed: number, roster: Roster, tA: Trajectory, tB: Trajectory, heads = false): PairResult {
  const a = mars(seed, roster, 'Aria Chen');
  const b = mars(seed, roster, 'Dietrich Voss');
  if (heads) {
    for (const [id, dept, role] of LIVE_HEADS.A) a.promoteAgent(id, dept as any, role, 'Aria Chen');
    for (const [id, dept, role] of LIVE_HEADS.B) b.promoteAgent(id, dept as any, role, 'Dietrich Voss');
  }
  const sums: Sums = { radA: 0, radB: 0, radGap: 0, natural: 0, accident: 0 };
  const flips: Flip[] = [];
  let prev = 2035;
  TURNS.forEach(([turn, time], i) => {
    if (time - prev > 0) turnReadings(a, b, turn, time - prev, seed, sums, flips);
    a.advanceTurn(turn, time, hook);
    b.advanceTurn(turn, time, hook);
    hold(a, tA, i);
    hold(b, tB, i);
    prev = time;
  });
  const deathsA = deaths(a), deathsB = deaths(b);
  return { deathsA, deathsB, deadA: new Set(deathsA.map(d => d.id)), deadB: new Set(deathsB.map(d => d.id)), sums, flips };
}

interface Variant { name: string; curve: 'cap' | 'fifth-of-rest' | 'quarter-of-rest'; model: 'threshold' | 'linear' }
const VARIANTS: Variant[] = [
  { name: 'current', curve: 'cap', model: 'threshold' },
  { name: 'cap, linear 0.003', curve: 'cap', model: 'linear' },
  { name: 'quarter of the rest, threshold', curve: 'quarter-of-rest', model: 'threshold' },
  { name: 'quarter of the rest, linear 0.003', curve: 'quarter-of-rest', model: 'linear' },
  { name: 'fifth of the rest, threshold', curve: 'fifth-of-rest', model: 'threshold' },
  { name: 'fifth of the rest, linear 0.003', curve: 'fifth-of-rest', model: 'linear' },
];
function use(v: Variant): void {
  shieldMeasurement.curve = v.curve;
  radiationMeasurement.model = v.model;
  radiationMeasurement.perSv = 0.003;
}
interface Config { name: string; roster: Roster; tA: Trajectory; tB: Trajectory }
const LIVE5_A: Trajectory = flat(3);
const LIVE5_B: Trajectory = { modules: [3, 3, 3, 5.29, 5.29, 5.29] };
const CONFIGS: Config[] = [
  { name: 'same both sides: 3 modules', roster: 'generator', tA: flat(3), tB: flat(3) },
  { name: 'same both sides: live A', roster: 'preset', tA: LIVE_A, tB: LIVE_A },
  { name: 'earlier sweep: 3 vs 4', roster: 'generator', tA: flat(3), tB: flat(4) },
  { name: '4 vs 5 held', roster: 'preset', tA: flat(4), tB: flat(5) },
  { name: '5 vs 11 held', roster: 'preset', tA: flat(5), tB: flat(11) },
  { name: '9.42 vs 11.22 held', roster: 'preset', tA: flat(9.42), tB: flat(11.22) },
  { name: 'live pair of 8 Nov', roster: 'preset', tA: LIVE_A, tB: LIVE_B },
  { name: 'live pair of 8 Nov', roster: 'generator', tA: LIVE_A, tB: LIVE_B },
  { name: 'live pair of 6 Nov: 3 vs 3, then 5.29 from turn 4', roster: 'preset', tA: LIVE5_A, tB: LIVE5_B },
];

function tally(ds: Death[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of ds) out[d.cause] = (out[d.cause] ?? 0) + 1;
  return out;
}

/** Lunar Outpost as a hosted demo runs it: 30 people, eight one-year turns from 2030, no leader moving its metrics. */
function lunarDead(seed: number): { dead: string[]; causes: Record<string, number>; exposure: number } {
  const k = new SimulationKernel(seed, 'Commander', [], { startTime: 2030, initialPopulation: 30, scenario: lunarScenario });
  for (let turn = 1; turn <= 8; turn++) k.advanceTurn(turn, 2030 + turn - 1, lunarScenario.hooks.progressionHook);
  const ds = deaths(k);
  const alive = k.getState().agents.filter(a => a.health.alive);
  const exposure = alive.length ? Math.max(...alive.map(a => a.health.cumulativeRadiationMsv ?? 0)) : 0;
  return { dead: ds.map(d => d.id).sort(), causes: tally(ds), exposure };
}

use(VARIANTS[0]);
const lunarCurrent = new Map(SEEDS.map(seed => [seed, lunarDead(seed)]));
const table: string[] = [];
for (const v of VARIANTS) {
  use(v);
  const started = Date.now();
  {
    const r = runPair(950, 'preset', LIVE_A, LIVE_B, true);
    const onlyA = [...r.deadA].filter(id => !r.deadB.has(id));
    const onlyB = [...r.deadB].filter(id => !r.deadA.has(id));
    const byB = new Map(r.deathsB.map(d => [d.id, d]));
    const differing = r.deathsA.filter(d => { const e = byB.get(d.id); return !e || e.time !== d.time || e.cause !== d.cause; })
      .map(d => { const e = byB.get(d.id); return `${d.name}: A ${d.time} ${d.cause}${d.dose >= 0 ? ` ${d.dose} mSv` : ''} | B ${e ? `${e.time} ${e.cause}${e.dose >= 0 ? ` ${e.dose} mSv` : ''}` : 'alive'}`; });
    for (const e of r.deathsB) if (!r.deadA.has(e.id)) differing.push(`${e.name}: A alive | B ${e.time} ${e.cause}`);
    console.log('REPLICA ' + JSON.stringify({
      variant: v.name, deadA: r.deadA.size, deadB: r.deadB.size, deadSetsDiffer: onlyA.length + onlyB.length > 0, onlyA, onlyB,
      causesA: tally(r.deathsA), causesB: tally(r.deathsB), flips: r.flips, radGap: r3(r.sums.radGap), differing,
    }));
  }
  for (const cfg of CONFIGS) {
    let differ = 0, differAnyTurn = 0, sym = 0, flipsAll = 0, flipsDeadBoth = 0, flipsSameTurn = 0, bSubsetA = 0;
    const ties: number[] = [];
    const cA: Record<string, number> = {}, cB: Record<string, number> = {};
    const sums: Sums = { radA: 0, radB: 0, radGap: 0, natural: 0, accident: 0 };
    for (const seed of SEEDS) {
      const r = runPair(seed, cfg.roster, cfg.tA, cfg.tB);
      const s = [...r.deadA].filter(id => !r.deadB.has(id)).length + [...r.deadB].filter(id => !r.deadA.has(id)).length;
      if (s > 0) differ++; else ties.push(seed);
      sym += s;
      if ([...r.deadB].every(id => r.deadA.has(id))) bSubsetA++;
      const turnA = new Map(r.deathsA.map(d => [d.id, d.turn])), turnB = new Map(r.deathsB.map(d => [d.id, d.turn]));
      const anyTurn = [...new Set([...turnA.keys(), ...turnB.keys()])].some(id => turnA.get(id) !== turnB.get(id));
      if (anyTurn) differAnyTurn++;
      for (const [c, n] of Object.entries(tally(r.deathsA))) cA[c] = (cA[c] ?? 0) + n;
      for (const [c, n] of Object.entries(tally(r.deathsB))) cB[c] = (cB[c] ?? 0) + n;
      for (const k of Object.keys(sums) as Array<keyof Sums>) sums[k] += r.sums[k];
      for (const f of r.flips) {
        flipsAll++;
        if (turnA.has(f.id) && turnB.has(f.id)) {
          flipsDeadBoth++;
          if (turnA.get(f.id) === turnB.get(f.id)) flipsSameTurn++;
        }
      }
    }
    const n = SEEDS.length;
    const row = {
      variant: v.name, config: cfg.name, roster: cfg.roster, seedsDiffer: differ, seedsDifferAtSomeTurn: differAnyTurn, of: n, ties, meanSymDiff: r2(sym / n), bSubsetOfA: bSubsetA,
      deathsPerSeedA: r2(Object.values(cA).reduce((x, y) => x + y, 0) / n), deathsPerSeedB: r2(Object.values(cB).reduce((x, y) => x + y, 0) / n),
      radiationPerSeedA: r2((cA['radiation cancer'] ?? 0) / n), radiationPerSeedB: r2((cB['radiation cancer'] ?? 0) / n),
      accidentPerSeedA: r2((cA['accident'] ?? 0) / n), naturalPerSeedA: r2(((cA['natural causes'] ?? 0) + (cA['age-related complications'] ?? 0)) / n),
      radA: r3(sums.radA / n), radB: r3(sums.radB / n), radGap: r3(sums.radGap / n), flipsPerSeed: r2(flipsAll / n), flipsDeadOnBothSides: flipsDeadBoth, flipsDeadSameTurn: flipsSameTurn, flips: flipsAll,
    };
    console.log('MEASURE ' + JSON.stringify(row));
    table.push(`${v.name} | ${cfg.name} | ${cfg.roster} | ${differ}/${n} | ${differAnyTurn}/${n} | ${r2(sym / n)} | ${row.deathsPerSeedA}/${row.deathsPerSeedB} | ${row.radiationPerSeedA}/${row.radiationPerSeedB} | ${row.radGap} | ${row.flipsPerSeed} | ${flipsDeadBoth}/${flipsAll} (${flipsSameTurn} same turn)`);
  }
  // Lunar Outpost under this variant against the current model, seed for seed.
  {
    let changed = 0, deaths = 0, radiation = 0, maxExposure = 0;
    const changedSeeds: number[] = [];
    for (const seed of SEEDS) {
      const now = lunarDead(seed), before = lunarCurrent.get(seed)!;
      if (now.dead.join(',') !== before.dead.join(',')) { changed++; changedSeeds.push(seed); }
      deaths += now.dead.length; radiation += now.causes['radiation cancer'] ?? 0; maxExposure = Math.max(maxExposure, now.exposure);
    }
    const base = [...lunarCurrent.values()];
    console.log('LUNAR ' + JSON.stringify({
      variant: v.name, seedsWhoseDeadChange: changed, of: SEEDS.length, changedSeeds: changedSeeds.slice(0, 20),
      deathsPerSeed: r2(deaths / SEEDS.length), radiationPerSeed: r2(radiation / SEEDS.length), maxExposureIndex: Math.round(maxExposure),
      currentDeathsPerSeed: r2(base.reduce((x, b) => x + b.dead.length, 0) / SEEDS.length), currentMaxExposureIndex: Math.round(Math.max(...base.map(b => b.exposure))),
    }));
  }
  console.log(`VARIANT_TIME ${v.name} ${Date.now() - started} ms`);
}
use(VARIANTS[0]);

console.log('\nvariant | config | roster | dead sets differ at the end | differ at some turn end | mean sym diff | deaths per seed A/B | radiation deaths per seed A/B | radiation gap | dice between per seed | of those, dead on both sides (same turn)');
for (const line of table) console.log(line);
