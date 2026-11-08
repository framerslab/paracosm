/**
 * Round 2 of the measurement for #221: two Mars leaders whose colonies
 * stayed apart all run (modules 4 against 5 from turn 1) still lost the same
 * 17 people, and two of them (Chen Osei, Dr. Priya Singh) died in the same
 * turn on both sides of different causes or at a dose a quarter as high.
 *
 * A. DICE. Whether one person's dice are independent of each other. For 201
 *    seeds, the six Mars turns, the preset roster and three causes, how often
 *    two dice both fall under 0.01 (and under 0.05), against the product of
 *    their rates (1 for independent dice), and the dice's correlation, for
 *    each kind of pair: two years of one cause in one turn, a turn's first
 *    year against a later one, two causes in one year, two causes in two
 *    years, one cause and year in two turns, and two people. Then every die
 *    of the two people the live pair lost in the same turn on both sides.
 *    Once with the dice as `SeededRng.forDraw` rolls them and once with the
 *    key's hash passed through a finalizer first.
 * B. VARIANTS. The round-1 configurations, 61 seeds each, under the current
 *    model and under each candidate change (the dice mixed through the
 *    finalizer; the habitat's shielding without its stop at 4.5 modules, as
 *    "each module keeps out a fifth of what reaches it" and as a curve that
 *    keeps today's share at 4 modules), with the seed-950 replica of the live
 *    pair for each, how many dice fell between the two sides' hazards and
 *    how many of those people died on both sides anyway.
 *
 * No model call. Prints one JSON line per reading and a table.
 */
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { SeededRng, forDrawMeasurement } from '../src/engine/core/rng.js';
import { causeHazards } from '../src/engine/core/progression.js';
import { habitatDoseShare, shieldMeasurement } from '../src/engine/physics/mars-radiation-bone.js';
import { marsScenario } from '../src/engine/scenarios/index.js';
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
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

// ---------------------------------------------------------------- A. DICE
const DICE_SEEDS = [950, ...Array.from({ length: 200 }, (_, i) => i + 1)];
const DICE_CAUSES = ['natural', 'radiation', 'accident'];
const STEPS = 8;
const ALL_CAUSES = ['natural', 'radiation', 'starvation', 'despair', 'fracture', 'accident'];
const die = (seed: number, turn: number, id: string, cause: string, step: number) =>
  SeededRng.forDraw(seed, turn, id, step === 0 ? cause : `${cause}@${step}`).next();

interface PairStat { pairs: number; joint01: number; joint05: number; sx: number; sy: number; sxy: number; sxx: number; syy: number }
const newStat = (): PairStat => ({ pairs: 0, joint01: 0, joint05: 0, sx: 0, sy: 0, sxy: 0, sxx: 0, syy: 0 });
function add(s: PairStat, x: number, y: number): void {
  s.pairs++;
  if (x < 0.01 && y < 0.01) s.joint01++;
  if (x < 0.05 && y < 0.05) s.joint05++;
  s.sx += x; s.sy += y; s.sxy += x * y; s.sxx += x * x; s.syy += y * y;
}

function diceReading(mix: 'fnv' | 'fmix'): void {
  forDrawMeasurement.mix = mix;
  const ids = mars(950, 'preset').getState().agents.map(a => a.core.id);
  const nT = TURNS.length, nI = ids.length, nC = DICE_CAUSES.length;
  // D[seed][turn][id][cause][step]
  const D = new Float64Array(DICE_SEEDS.length * nT * nI * nC * STEPS);
  const at = (s: number, t: number, i: number, c: number, k: number) => ((((s * nT + t) * nI + i) * nC + c) * STEPS + k);
  let under01 = 0, under001 = 0, total = 0;
  DICE_SEEDS.forEach((seed, s) => {
    for (let t = 0; t < nT; t++) for (let i = 0; i < nI; i++) for (let c = 0; c < nC; c++) for (let k = 0; k < STEPS; k++) {
      const u = die(seed, TURNS[t][0], ids[i], DICE_CAUSES[c], k);
      D[at(s, t, i, c, k)] = u;
      total++; if (u < 0.01) under01++; if (u < 0.001) under001++;
    }
  });
  const p01 = under01 / total, p05Count = (() => { let n = 0; for (let x = 0; x < D.length; x++) if (D[x] < 0.05) n++; return n; })();
  const p05 = p05Count / total;
  const kinds: Record<string, PairStat> = {
    'two years of one cause (steps 1-7)': newStat(),
    'first year against a later one': newStat(),
    'two causes in one year': newStat(),
    'two causes in two years': newStat(),
    'two turns, same cause and year': newStat(),
    'two people, same cause and year': newStat(),
  };
  for (let s = 0; s < DICE_SEEDS.length; s++) for (let t = 0; t < nT; t++) for (let i = 0; i < nI; i++) {
    for (let c = 0; c < nC; c++) {
      for (let j = 1; j < STEPS; j++) for (let k = j + 1; k < STEPS; k++) add(kinds['two years of one cause (steps 1-7)'], D[at(s, t, i, c, j)], D[at(s, t, i, c, k)]);
      for (let k = 1; k < STEPS; k++) add(kinds['first year against a later one'], D[at(s, t, i, c, 0)], D[at(s, t, i, c, k)]);
      if (t + 1 < nT) for (let k = 0; k < STEPS; k++) add(kinds['two turns, same cause and year'], D[at(s, t, i, c, k)], D[at(s, t + 1, i, c, k)]);
      if (i + 1 < nI) for (let k = 0; k < STEPS; k++) add(kinds['two people, same cause and year'], D[at(s, t, i, c, k)], D[at(s, t, i + 1, c, k)]);
    }
    for (let a = 0; a < nC; a++) for (let b = a + 1; b < nC; b++) {
      for (let k = 0; k < STEPS; k++) add(kinds['two causes in one year'], D[at(s, t, i, a, k)], D[at(s, t, i, b, k)]);
      for (let j = 0; j < STEPS; j++) for (let k = 0; k < STEPS; k++) if (j !== k) add(kinds['two causes in two years'], D[at(s, t, i, a, j)], D[at(s, t, i, b, k)]);
    }
  }
  console.log('DICE_MARGINALS ' + JSON.stringify({ mix, dice: total, under001: r6(under001 / total), under01: r6(p01), under05: r6(p05) }));
  for (const [kind, st] of Object.entries(kinds)) {
    const n = st.pairs;
    const cov = st.sxy / n - (st.sx / n) * (st.sy / n);
    const r = cov / Math.sqrt((st.sxx / n - (st.sx / n) ** 2) * (st.syy / n - (st.sy / n) ** 2));
    console.log('DICE_PAIRS ' + JSON.stringify({
      mix, kind, pairs: n,
      bothUnder01: st.joint01, expected01: r2(n * p01 * p01), ratio01: r2(st.joint01 / (n * p01 * p01)),
      bothUnder05: st.joint05, expected05: r2(n * p05 * p05), ratio05: r2(st.joint05 / (n * p05 * p05)),
      correlation: r3(r),
    }));
  }
  // The two people the live pair lost in the same turn on both sides.
  for (const [id, turn] of [['col-chen-osei', 3], ['col-dr-priya-singh', 4]] as Array<[string, number]>) {
    const table: Record<string, number[]> = {};
    for (const cause of ALL_CAUSES) table[cause] = Array.from({ length: STEPS }, (_, k) => r6(die(950, turn, id, cause, k)));
    console.log('DICE_PERSON ' + JSON.stringify({ mix, seed: 950, id, turn, dice: table }));
  }
  forDrawMeasurement.mix = 'fnv';
}

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

interface Variant { name: string; mix: 'fnv' | 'fmix'; curve: 'cap' | 'fifth-of-rest' | 'match-at-4' }
const VARIANTS: Variant[] = [
  { name: 'current', mix: 'fnv', curve: 'cap' },
  { name: 'dice mixed', mix: 'fmix', curve: 'cap' },
  { name: 'shield: a fifth of the rest', mix: 'fnv', curve: 'fifth-of-rest' },
  { name: 'shield: matched at 4', mix: 'fnv', curve: 'match-at-4' },
  { name: 'dice mixed + a fifth of the rest', mix: 'fmix', curve: 'fifth-of-rest' },
  { name: 'dice mixed + matched at 4', mix: 'fmix', curve: 'match-at-4' },
];
interface Config { name: string; roster: Roster; tA: Trajectory; tB: Trajectory }
const CONFIGS: Config[] = [
  { name: 'same trajectory both sides: 3 modules', roster: 'generator', tA: flat(3), tB: flat(3) },
  { name: 'same trajectory both sides: live A', roster: 'preset', tA: LIVE_A, tB: LIVE_A },
  { name: 'earlier sweep: 3 vs 4 from turn 1', roster: 'generator', tA: flat(3), tB: flat(4) },
  { name: '4 vs 5 held', roster: 'preset', tA: flat(4), tB: flat(5) },
  { name: '5 vs 11 held', roster: 'preset', tA: flat(5), tB: flat(11) },
  { name: '9.42 vs 11.22 held', roster: 'preset', tA: flat(9.42), tB: flat(11.22) },
  { name: 'live pair trajectories', roster: 'preset', tA: LIVE_A, tB: LIVE_B },
  { name: 'live pair trajectories', roster: 'generator', tA: LIVE_A, tB: LIVE_B },
];

function tally(ds: Death[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of ds) out[d.cause] = (out[d.cause] ?? 0) + 1;
  return out;
}

const table: string[] = [];
diceReading('fnv');
diceReading('fmix');

for (const v of VARIANTS) {
  forDrawMeasurement.mix = v.mix;
  shieldMeasurement.curve = v.curve;
  const started = Date.now();
  // The replica of the live pair: seed 950, preset roster, live heads, live trajectories.
  {
    const r = runPair(950, 'preset', LIVE_A, LIVE_B, true);
    const onlyA = [...r.deadA].filter(id => !r.deadB.has(id));
    const onlyB = [...r.deadB].filter(id => !r.deadA.has(id));
    const live = new Set(LIVE_DEAD);
    const byB = new Map(r.deathsB.map(d => [d.id, d]));
    const differing = r.deathsA.filter(d => { const e = byB.get(d.id); return !e || e.time !== d.time || e.cause !== d.cause; })
      .map(d => { const e = byB.get(d.id); return `${d.name}: A ${d.time} ${d.cause}${d.dose >= 0 ? ` ${d.dose} mSv` : ''} | B ${e ? `${e.time} ${e.cause}${e.dose >= 0 ? ` ${e.dose} mSv` : ''}` : 'alive'}`; });
    for (const e of r.deathsB) if (!r.deadA.has(e.id)) differing.push(`${e.name}: A alive | B ${e.time} ${e.cause}`);
    console.log('REPLICA ' + JSON.stringify({
      variant: v.name, deadA: r.deadA.size, deadB: r.deadB.size, deadSetsDiffer: onlyA.length + onlyB.length > 0, onlyA, onlyB,
      sameAsLivePairA: r.deadA.size === live.size && [...r.deadA].every(id => live.has(id)),
      causesA: tally(r.deathsA), causesB: tally(r.deathsB), flips: r.flips, radGap: r3(r.sums.radGap), differing,
    }));
  }
  for (const cfg of CONFIGS) {
    let differ = 0, sym = 0, flipsAll = 0, flipsDeadBoth = 0, flipsSameTurn = 0;
    const ties: number[] = [];
    const cA: Record<string, number> = {}, cB: Record<string, number> = {};
    const sums: Sums = { radA: 0, radB: 0, radGap: 0, natural: 0, accident: 0 };
    for (const seed of SEEDS) {
      const r = runPair(seed, cfg.roster, cfg.tA, cfg.tB);
      const s = [...r.deadA].filter(id => !r.deadB.has(id)).length + [...r.deadB].filter(id => !r.deadA.has(id)).length;
      if (s > 0) differ++; else ties.push(seed);
      sym += s;
      for (const [c, n] of Object.entries(tally(r.deathsA))) cA[c] = (cA[c] ?? 0) + n;
      for (const [c, n] of Object.entries(tally(r.deathsB))) cB[c] = (cB[c] ?? 0) + n;
      for (const k of Object.keys(sums) as Array<keyof Sums>) sums[k] += r.sums[k];
      const turnA = new Map(r.deathsA.map(d => [d.id, d.turn])), turnB = new Map(r.deathsB.map(d => [d.id, d.turn]));
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
      variant: v.name, config: cfg.name, roster: cfg.roster, seedsDiffer: differ, of: n, ties, meanSymDiff: r2(sym / n),
      deathsPerSeedA: r2(Object.values(cA).reduce((x, y) => x + y, 0) / n), deathsPerSeedB: r2(Object.values(cB).reduce((x, y) => x + y, 0) / n),
      radiationPerSeedA: r2((cA['radiation cancer'] ?? 0) / n), radiationPerSeedB: r2((cB['radiation cancer'] ?? 0) / n),
      accidentPerSeedA: r2((cA['accident'] ?? 0) / n), naturalPerSeedA: r2(((cA['natural causes'] ?? 0) + (cA['age-related complications'] ?? 0)) / n),
      radA: r3(sums.radA / n), radB: r3(sums.radB / n), radGap: r3(sums.radGap / n), expTie: r3(Math.exp(-sums.radGap / n)),
      flipsPerSeed: r2(flipsAll / n), flipsDeadOnBothSides: flipsDeadBoth, flipsDeadSameTurn: flipsSameTurn, flips: flipsAll,
    };
    console.log('MEASURE ' + JSON.stringify(row));
    table.push(`${v.name} | ${cfg.name} | ${cfg.roster} | ${differ}/${n} | ${r2(sym / n)} | ${row.deathsPerSeedA}/${row.deathsPerSeedB} | ${row.radiationPerSeedA}/${row.radiationPerSeedB} | ${row.radGap} | ${row.flipsPerSeed} | ${flipsDeadBoth}/${flipsAll} (${flipsSameTurn} same turn)`);
  }
  console.log(`VARIANT_TIME ${v.name} ${Date.now() - started} ms`);
}
forDrawMeasurement.mix = 'fnv';
shieldMeasurement.curve = 'cap';

console.log('\nvariant | config | roster | seeds differ | mean sym diff | deaths per seed A/B | radiation deaths per seed A/B | radiation gap | dice between per seed | of those, dead on both sides (same turn)');
for (const line of table) console.log(line);
