/**
 * Runs of many actors for the forged tool view's tests, written from a seed
 * in the stream's own frame shape with no model call: a `status` starting
 * frame with `batch: true` and the actor count, a `status` parallel frame
 * with the actor list, each actor's `sim` frames tagged with its name, a
 * `result` frame an actor, and `complete`, as a batch run broadcasts them.
 *
 * A spec gives the totals (tools, forges, forges that passed) and the
 * generator places them: every actor's tools fit its registry of 50, a forge
 * before a tool's last one did not pass, and each department reports once
 * for a turn's event, listing the tools it forged or used there with their
 * history rows, as the orchestrator sends them. The same seed gives the same
 * frames.
 */
import { frame, sim, leaderTurn, tool, crewOf, systemsSnapshot } from './run-frames.js';
import { ARIA, DEPARTMENTS, DIETRICH, HABITAT, LANDING, LANDING_TEXT, SCENARIO, SHELTER_REASON, WATER, WATER_TEXT } from './pair-run.js';

export interface CohortRunSpec {
  label: string; seed: number; actors: number;
  tools: number; forges: number; passed: number; turns: number;
  departments: string[];                      // the five of scenarios/mars.json
  /** A1..An in order. `tools` and `didNotPass` fix that actor's counts, each of its tools forged once. */
  namedActors?: Array<{ name: string; archetype: string; tools?: number; didNotPass?: number }>;
  fullActor?: number;                         // slot whose registry holds 50 tools
  sharedName?: { name: string; actors: number };
  unreadableActor?: number;                   // slot whose forgedTools is a string
  reportOnly?: boolean;                       // no forge_attempt frames
}

/** The most tools one actor's registry holds. */
const REGISTRY_LIMIT = 50;
/** The fewest tools the generator gives an actor. */
const FEWEST_TOOLS = 3;
/** The most tools one department forges in one report. */
const TOOLS_A_REPORT = 3;

const FIRST_EIGHT = [
  { name: 'Aria Chen', archetype: 'The Visionary' },
  { name: 'Dietrich Voss', archetype: 'The Engineer' },
  { name: 'Mei Tanaka', archetype: 'The Diplomat' },
  { name: 'Omar Haddad', archetype: 'The Pragmatist' },
  { name: 'Lucia Ferrante', archetype: 'The Guardian' },
  { name: 'Kwame Mensah', archetype: 'The Pioneer' },
  { name: 'Ines Duarte', archetype: 'The Strategist' },
  { name: 'Tomas Novak', archetype: 'The Steward' },
];

/** 24 actors. Four hold "strat" in a name or an archetype: A7, A11, A15 and A19. */
export const DOZENS: CohortRunSpec = {
  label: 'Mars Genesis · 24 actors', seed: 24, actors: 24,
  tools: 286, forges: 331, passed: 268, turns: 4,
  departments: DEPARTMENTS,
  namedActors: [
    ...FIRST_EIGHT.slice(0, 6),
    { ...FIRST_EIGHT[6], tools: 14, didNotPass: 2 },
    FIRST_EIGHT[7],
    { name: 'Priya Raman', archetype: 'The Skeptic' },
    { name: 'Elias Lindqvist', archetype: 'The Builder' },
    { name: 'Mira Stratford', archetype: 'The Mediator' },
    { name: 'Santiago Ruiz', archetype: 'The Explorer' },
    { name: 'Hana Kobayashi', archetype: 'The Analyst' },
    { name: 'Farid Rahimi', archetype: 'The Caretaker' },
    { name: 'Jonas Keller', archetype: 'The Strategist' },
    { name: 'Amara Okoye', archetype: 'The Visionary' },
    { name: 'Viktor Sokolov', archetype: 'The Engineer' },
    { name: 'Leila Nasser', archetype: 'The Diplomat' },
    { name: 'Tobias Strathmore', archetype: 'The Pragmatist' },
    { name: 'Chloe Martin', archetype: 'The Guardian' },
    { name: 'Rafael Costa', archetype: 'The Pioneer' },
    { name: 'Sofia Petrova', archetype: 'The Steward' },
    { name: 'Daniel Abebe', archetype: 'The Skeptic' },
    { name: 'Yuki Mori', archetype: 'The Builder' },
  ],
  sharedName: { name: HABITAT, actors: 3 },
};

/** 300 actors, the most a run holds. A299's registry is full. */
export const MAXIMUM: CohortRunSpec = {
  label: 'Mars Genesis · 300 actors', seed: 300, actors: 300,
  tools: 3612, forges: 4207, passed: 3301, turns: 6,
  departments: DEPARTMENTS,
  namedActors: FIRST_EIGHT,
  fullActor: 299,
  sharedName: { name: HABITAT, actors: 40 },
};

/** The 24-actor run with A7's reports sent with their tools as a string. */
export const DOZENS_A7_UNREADABLE: CohortRunSpec = {
  ...DOZENS,
  label: 'Mars Genesis · 24 actors, A7 unreadable',
  unreadableActor: 7,
};

/** A saved run of an older shape: two tools in department reports, and no forge frame. */
export const REPORT_ONLY_PAIR: CohortRunSpec = {
  label: 'Mars Genesis · report-only pair', seed: 2, actors: 2,
  tools: 2, forges: 0, passed: 2, turns: 2,
  departments: DEPARTMENTS,
  namedActors: [ARIA, DIETRICH],
  reportOnly: true,
};

/** Two actors whose department reports name no tool. */
export const NO_FORGE_PAIR: CohortRunSpec = {
  label: 'Mars Genesis · no forge', seed: 2, actors: 2,
  tools: 0, forges: 0, passed: 0, turns: 2,
  departments: DEPARTMENTS,
  namedActors: [ARIA, DIETRICH],
};

// ── The seed ──────────────────────────────────────────────────────────

/** mulberry32: a small generator that gives the same numbers for the same seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const below = (rng: Rng, n: number): number => Math.floor(rng() * n);
const pick = <T>(rng: Rng, list: readonly T[]): T => list[below(rng, list.length)];
function shuffled<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── The actors ────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Ada', 'Bashir', 'Camila', 'Dmitri', 'Esi', 'Felix', 'Gwen', 'Hiro', 'Imani', 'Jorge',
  'Kalani', 'Liam', 'Marta', 'Nikhil', 'Oksana', 'Pablo', 'Quinn', 'Rosa', 'Sven', 'Thandi',
  'Uma', 'Vera', 'Wei', 'Ximena', 'Yusuf', 'Zofia', 'Anton', 'Bianca', 'Cedric', 'Dalia',
];
const LAST_NAMES = [
  'Adeyemi', 'Brandt', 'Castillo', 'Dvorak', 'Eriksen', 'Fontaine', 'Gallo', 'Hoang', 'Ivanova', 'Jensen',
  'Kimura', 'Lopez', 'Mbeki', 'Nakamura', 'Ortiz', 'Pereira', 'Qureshi', 'Rossi', 'Silva', 'Torres',
  'Ueda', 'Varga', 'Walker', 'Xu', 'Yilmaz', 'Zhang', 'Aguilar', 'Bose', 'Chavez', 'Diallo',
];
const ARCHETYPES = [
  'The Visionary', 'The Engineer', 'The Diplomat', 'The Pragmatist', 'The Guardian', 'The Pioneer',
  'The Strategist', 'The Steward', 'The Skeptic', 'The Builder', 'The Mediator', 'The Explorer',
];
const HEXACO = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'emotionality', 'honestyHumility'];

interface Actor {
  index: number;
  name: string;
  archetype: string;
  unit: string;
  hexaco: Record<string, number>;
  /** The name its `result` frame carries: the archetype in lower case, numbered when another actor has it. */
  tag: string;
}

function buildRoster(spec: CohortRunSpec, rng: Rng): Actor[] {
  const named = spec.namedActors ?? [];
  const taken = new Set(named.map(a => a.name));
  const spare = shuffled(rng, FIRST_NAMES.flatMap(first => LAST_NAMES.map(last => `${first} ${last}`))).filter(n => !taken.has(n));
  const tags = new Map<string, number>();
  return Array.from({ length: spec.actors }, (_, index) => {
    const given = named[index];
    const name = given?.name ?? spare[index];
    const archetype = given?.archetype ?? pick(rng, ARCHETYPES);
    const base = archetype.toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, '-');
    const seen = tags.get(base) ?? 0;
    tags.set(base, seen + 1);
    return {
      index, name, archetype,
      unit: `Colony ${index + 1}`,
      hexaco: Object.fromEntries(HEXACO.map(trait => [trait, round2(0.2 + rng() * 0.7)])),
      tag: seen === 0 ? base : `${base}-${seen + 1}`,
    };
  });
}

// ── The tools ─────────────────────────────────────────────────────────

const SUBJECTS = [
  'regolith', 'greenhouse', 'reactor', 'airlock', 'rover', 'aquifer', 'solar_array', 'radiation', 'dust_storm', 'crew',
  'oxygen', 'water', 'nutrient', 'thermal', 'comms', 'medbay', 'hull', 'battery', 'soil', 'seed_bank',
  'sleep', 'isolation', 'supply', 'landing_pad', 'drill', 'ice', 'perchlorate', 'bone_density', 'morale', 'shift',
  'council', 'ration', 'power_grid', 'pressure', 'algae', 'co2', 'shelter', 'transit', 'signal', 'habitat',
];
const MEASURES = [
  'load', 'risk', 'yield', 'reserve', 'margin', 'drift', 'decay', 'demand', 'exposure', 'recovery',
  'capacity', 'stress', 'balance', 'throughput', 'fatigue', 'leakage', 'coverage', 'latency', 'variance', 'stability',
  'turnover', 'uptake', 'wear', 'quota', 'buffer', 'dose', 'flux', 'range', 'tempo', 'cost',
];
const KINDS: ReadonlyArray<readonly [kind: string, verb: string]> = [
  ['index', 'Indexes'], ['forecast', 'Forecasts'], ['score', 'Scores'], ['model', 'Models'], ['estimate', 'Estimates'], ['budget', 'Budgets'],
];
const REASONS = [
  SHELTER_REASON,
  'Execution error: await. Forged code here is synchronous: define a plain function execute(input) that returns its result.',
  'The output did not match the declared output schema: a required field is missing.',
  'A test case returned a value outside the range the output schema declares.',
];
const EVENT_TITLES = [
  ['Landfall', 'Seal Breach', 'First Census'],
  ['Dust Season', 'Crop Blight', 'Signal Loss'],
  ['Water Table', 'Reactor Trip', 'Council Vote'],
  ['Solar Flare', 'Supply Window', 'Night Shift'],
  ['Long Winter', 'Rover Recall', 'Quarantine'],
  ['Second Landing', 'Ice Run', 'Charter Day'],
];

/** One department's report for one event of one turn. */
interface Call { turn: number; eventIndex: number; department: string }

interface ToolPlan {
  name: string;
  description: string;
  department: string;
  inputField: string;
  outputField: string;
  output: string;
  confidence: number;
  /** Its forges in order: the call each ran in, and whether it passed. */
  attempts: Array<{ call: number; approved: boolean }>;
  /** The later calls that used it without forging it again. */
  uses: number[];
}

/** How many tools each actor holds: the fixed ones, then the rest shared out and moved about by the seed. */
function planToolCounts(spec: CohortRunSpec, rng: Rng): number[] {
  const counts: number[] = new Array(spec.actors).fill(-1);
  if (spec.fullActor) counts[spec.fullActor - 1] = REGISTRY_LIMIT;
  (spec.namedActors ?? []).forEach((a, i) => { if (a.tools !== undefined && i < spec.actors) counts[i] = a.tools; });
  const free = counts.flatMap((c, i) => (c < 0 ? [i] : []));
  const left = spec.tools - counts.reduce((sum, c) => sum + Math.max(c, 0), 0);
  const base = Math.floor(left / free.length);
  free.forEach((actor, k) => { counts[actor] = base + (k < left - base * free.length ? 1 : 0); });
  for (let k = 0; k < free.length * 6; k++) {
    const from = pick(rng, free);
    const to = pick(rng, free);
    const moved = 1 + below(rng, 3);
    if (from !== to && counts[from] - moved >= FEWEST_TOOLS && counts[to] + moved < REGISTRY_LIMIT) {
      counts[from] -= moved;
      counts[to] += moved;
    }
  }
  if (counts.some((c, i) => c < 1 || c > REGISTRY_LIMIT || (c === REGISTRY_LIMIT && i !== (spec.fullActor ?? 0) - 1))) {
    throw new Error(`${spec.label}: ${spec.tools} tools do not fit ${spec.actors} actors`);
  }
  return counts;
}

/** The actors that forge the shared name, spread evenly through the launch order. */
function sharedNameHolders(spec: CohortRunSpec): Set<number> {
  const holders = new Set<number>();
  const count = spec.sharedName?.actors ?? 0;
  for (let i = 0; i < count; i++) holders.add((Math.floor((i * spec.actors) / count) + 2) % spec.actors);
  return holders;
}

function describe(rng: Rng, name: string, subject: string, measure: string, kind: readonly [string, string], department: string): Omit<ToolPlan, 'attempts' | 'uses'> {
  return {
    name,
    description: `${kind[1]} ${subject.replace(/_/g, ' ')} ${measure} from the turn's readings.`,
    department,
    inputField: `${subject}_reading`,
    outputField: kind[0],
    output: JSON.stringify({ [kind[0]]: 20 + below(rng, 75) }),
    confidence: round2(0.8 + rng() * 0.19),
  };
}

// ── The frames ────────────────────────────────────────────────────────

const timeOf = (turn: number): number => 2035 + (turn - 1) * 8;
const titleOf = (turn: number, eventIndex: number): string => EVENT_TITLES[(turn - 1) % EVENT_TITLES.length][eventIndex % 3];

/** A run of two actors in the pair's frame shape: the stored pair's two tools as reports alone, or no tool at all. */
function pairShapedRun(spec: CohortRunSpec): string[] {
  if (spec.forges !== 0 || (spec.tools !== 0 && !spec.reportOnly)) {
    throw new Error(`${spec.label}: a pair run with forges is the stored pair run of pair-run.ts`);
  }
  const [a, b] = buildRoster(spec, mulberry32(spec.seed));
  const reports = spec.reportOnly === true;
  // leaderTurn's turns report a population of 30.
  const snapshots = (turn: number) => [a, b].map(actor => systemsSnapshot(actor.name, turn, timeOf(turn), crewOf(actor.name, turn, spec.departments, 30)));
  return [
    frame('active_scenario', { id: SCENARIO.id, name: SCENARIO.name, runKey: runKeyOf(spec), forkedFrom: null }),
    frame('status', { phase: 'starting', maxTurns: spec.turns, customEvents: [] }),
    frame('status', { phase: 'parallel', actors: [a, b].map(({ name, archetype }) => ({ name, archetype })) }),
    ...leaderTurn(a.name, 1, 'engineering', [], reports ? [tool(LANDING, LANDING_TEXT, 'engineering', 1, true, 0.98)] : []),
    ...leaderTurn(b.name, 1, 'medical', [], reports ? [tool(WATER, WATER_TEXT, 'medical', 1, true, 0.97)] : []),
    ...snapshots(1),
    ...leaderTurn(a.name, 2, 'engineering', [], reports ? [tool(LANDING, LANDING_TEXT, 'engineering', 1, false, 0.98)] : []),
    ...leaderTurn(b.name, 2, 'medical', [], []),
    ...snapshots(2),
    frame('complete', { timestamp: '2026-11-16T01:55:39.000Z' }),
  ];
}

/** The run's key. The A7-unreadable run keeps the dozens run's: it is that run but for A7's reports. */
const runKeyOf = (spec: CohortRunSpec): string => `generated-${spec.actors}-actors-${spec.tools}-tools-seed-${spec.seed}`;

/** SSE frames, deterministic for a seed. */
export function generateCohortRun(spec: CohortRunSpec): string[] {
  if (spec.actors === 2) return pairShapedRun(spec);

  const rng = mulberry32(spec.seed);
  const roster = buildRoster(spec, rng);
  const counts = planToolCounts(spec, rng);
  const holders = sharedNameHolders(spec);
  const reforges = spec.forges - spec.tools;
  const endNotPassed = spec.forges - spec.passed - reforges;
  /** The actor that holds a tool forged twice, its first forge not passing: the full one, else A1. */
  const witness = (spec.fullActor ?? 1) - 1;
  const fixed = new Set((spec.namedActors ?? []).flatMap((a, i) => (a.didNotPass !== undefined ? [i] : [])));

  // Every name but the shared one is one actor's alone.
  const names = shuffled(rng, SUBJECTS.flatMap(s => MEASURES.flatMap(m => KINDS.map(k => [s, m, k] as const))))
    .filter(([s, m, k]) => `${s}_${m}_${k[0]}` !== spec.sharedName?.name);
  let nextName = 0;

  // Each actor's events a turn, its calls in stream order, and its tools placed in them.
  const plans = roster.map((actor) => {
    const eventsIn = Array.from({ length: spec.turns }, () => {
      const r = rng();
      return spec.turns >= 6 && r < 0.06 ? 3 : r < 0.24 ? 2 : 1;
    });
    const calls: Call[] = [];
    for (let turn = 1; turn <= spec.turns; turn++) {
      for (let eventIndex = 0; eventIndex < eventsIn[turn - 1]; eventIndex++) {
        for (const department of spec.departments) calls.push({ turn, eventIndex, department });
      }
    }
    const callsOf = new Map(spec.departments.map(d => [d, calls.flatMap((c, i) => (c.department === d ? [i] : []))]));
    const load: number[] = new Array(calls.length).fill(0);

    const tools: ToolPlan[] = [];
    for (let t = 0; t < counts[actor.index]; t++) {
      // The shared name is the second tool of each actor that holds it.
      const shared = holders.has(actor.index) && t === 1 && spec.sharedName;
      const [subject, measure, kind] = names[nextName];
      if (!shared) nextName++;
      let department = pick(rng, spec.departments);
      let open = callsOf.get(department)!.filter(c => load[c] < TOOLS_A_REPORT);
      for (let k = 0; open.length === 0 && k < spec.departments.length; k++) {
        department = spec.departments[k];
        open = callsOf.get(department)!.filter(c => load[c] < TOOLS_A_REPORT);
      }
      if (open.length === 0) throw new Error(`${spec.label}: ${actor.name} has no report left for a tool`);
      const first = pick(rng, open);
      load[first]++;
      tools.push({
        ...(shared
          ? describe(rng, shared.name, 'habitat', 'pressure', ['check', 'Checks'], department)
          : describe(rng, `${subject}_${measure}_${kind[0]}`, subject, measure, kind, department)),
        attempts: [{ call: first, approved: true }],
        uses: [],
      });
    }
    return { actor, eventsIn, calls, callsOf, tools };
  });

  // Earlier forges of a name: each did not pass. The witness's first tool holds one; the seed places the rest.
  const sharedTool = (p: typeof plans[number], t: number) => holders.has(p.actor.index) && t === 1 && !!spec.sharedName;
  const candidates = shuffled(rng, plans.flatMap(p => p.tools.flatMap((plan, t) => (
    fixed.has(p.actor.index) || sharedTool(p, t) || (p.actor.index === witness && t === 0) ? [] : [{ p, plan }]
  ))));
  const earlier = new Map<ToolPlan, number>();
  let toPlace = reforges;
  if (toPlace > 0) {
    earlier.set(plans[witness].tools[0], 1);
    toPlace--;
  }
  for (let i = 0; toPlace > 0; i++) {
    if (i >= candidates.length) throw new Error(`${spec.label}: ${reforges} re-forges do not fit ${spec.tools} tools`);
    const twice = toPlace >= 2 && rng() < 0.2 ? 2 : 1;
    earlier.set(candidates[i].plan, twice);
    toPlace -= twice;
  }

  // Tools whose last forge did not pass: the fixed actors' counts, then the seed's choice among the rest.
  const notPassed = new Set<ToolPlan>();
  for (const i of fixed) {
    for (const plan of shuffled(rng, plans[i].tools).slice(0, spec.namedActors![i].didNotPass)) notPassed.add(plan);
  }
  for (const { plan } of shuffled(rng, candidates)) {
    if (notPassed.size >= endNotPassed) break;
    notPassed.add(plan);
  }
  if (notPassed.size !== endNotPassed) throw new Error(`${spec.label}: ${endNotPassed} tools cannot end not passed`);

  for (const p of plans) {
    for (const plan of p.tools) {
      const mine = p.callsOf.get(plan.department)!;
      const later = (call: number): number | undefined => mine[mine.indexOf(call) + 1];
      const passed = !notPassed.has(plan);
      const attempts: ToolPlan['attempts'] = [];
      let call = plan.attempts[0].call;
      const total = (earlier.get(plan) ?? 0) + 1;
      for (let n = 0; n < total; n++) {
        // A forge after one that did not pass is a retry in the same report, or a forge in the department's next report.
        if (n > 0 && rng() < 0.4) call = later(call) ?? call;
        attempts.push({ call, approved: n === total - 1 ? passed : false });
      }
      plan.attempts = attempts;
      if (passed) {
        const r = rng();
        let used = call;
        for (let n = r < 0.06 ? 2 : r < 0.28 ? 1 : 0; n > 0; n--) {
          const next = later(used);
          if (next === undefined) break;
          plan.uses.push(next);
          used = next;
        }
      }
    }
  }

  // The frames: the run's head, then every actor's frames before the next actor's.
  const frames: string[] = [
    frame('active_scenario', { id: SCENARIO.id, name: SCENARIO.name, runKey: runKeyOf(spec), forkedFrom: null }),
    frame('status', { phase: 'starting', maxTurns: spec.turns, customEvents: [], batch: true, actorCount: spec.actors }),
    frame('status', { phase: 'parallel', batch: true, actors: roster.map(({ name, archetype, unit, hexaco }) => ({ name, archetype, unit, hexaco })) }),
  ];
  const firstForge = Date.parse('2026-11-16T02:00:00.000Z');
  let forgeCount = 0;

  for (const p of plans) {
    const leader = p.actor.name;
    const unreadable = spec.unreadableActor === p.actor.index + 1;
    const forging = new Map<number, ToolPlan[]>();
    const using = new Map<number, ToolPlan[]>();
    for (const plan of p.tools) {
      for (const call of new Set(plan.attempts.map(a => a.call))) forging.set(call, [...(forging.get(call) ?? []), plan]);
      for (const call of plan.uses) using.set(call, [...(using.get(call) ?? []), plan]);
    }
    /** What the actor's registry knows of a tool so far: where it was first forged, and its history rows. */
    const ledger = new Map<ToolPlan, { turn: number; eventIndex: number; history: Array<Record<string, unknown>> }>();
    // A small population keeps a run of hundreds of actors light: the living grid draws one cell a member.
    const population = spec.actors > 50 ? 6 : 12;
    const morale = round2(0.6 + rng() * 0.3);
    let approvedTools = 0;

    for (let turn = 1; turn <= spec.turns; turn++) {
      const time = timeOf(turn);
      const at = { turn, time };
      const totalEvents = p.eventsIn[turn - 1];
      frames.push(sim(leader, 'turn_start', { ...at, title: titleOf(turn, 0), crisis: 'Choose how the colony answers.', category: 'environmental', births: 0, deaths: 0, metrics: { population, morale }, emergent: false, turnSummary: '', totalEvents, pacing: 'normal' }));

      for (let eventIndex = 0; eventIndex < totalEvents; eventIndex++) {
        const title = titleOf(turn, eventIndex);
        frames.push(sim(leader, 'event_start', { ...at, eventIndex, totalEvents, title, description: 'Choose how the colony answers.', category: 'environmental', emergent: false, turnSummary: '', pacing: 'normal' }));

        const here = p.calls.flatMap((c, i) => (c.turn === turn && c.eventIndex === eventIndex ? [i] : []));
        const busy = here.filter(c => forging.has(c) || using.has(c));
        // An event with no tool still hears from one department.
        const reporting = busy.length > 0 ? busy : [here[(turn + eventIndex + p.actor.index) % here.length]];
        for (const call of reporting) {
          const { department } = p.calls[call];
          frames.push(sim(leader, 'specialist_start', { ...at, department, eventIndex }));
          const records: Array<Record<string, unknown>> = [];

          for (const plan of forging.get(call) ?? []) {
            // The report lists the tool as its last forge in this call left it, with that forge's reason.
            let last = plan.attempts[0];
            let reason: string | undefined;
            for (const attempt of plan.attempts) {
              if (attempt.call !== call) continue;
              last = attempt;
              reason = attempt.approved ? undefined : REASONS[forgeCount % REASONS.length];
              if (!spec.reportOnly) {
                frames.push(sim(leader, 'forge_attempt', {
                  ...at, eventIndex, department, name: plan.name, description: plan.description, mode: 'sandbox',
                  approved: attempt.approved, confidence: attempt.approved ? plan.confidence : 0,
                  inputFields: [plan.inputField, 'days_elapsed'], outputFields: [plan.outputField],
                  ...(reason ? { errorReason: reason } : {}),
                  timestamp: new Date(firstForge + forgeCount * 4000).toISOString(),
                }));
              }
              forgeCount++;
            }
            const isNew = !ledger.has(plan);
            if (isNew) ledger.set(plan, { turn, eventIndex, history: [] });
            if (last.approved && !ledger.get(plan)!.history.some(h => h.rejected === false)) approvedTools++;
            records.push(record(plan, ledger.get(plan)!, { ...at, eventIndex, title, department }, isNew, last.approved, true, reason));
          }
          for (const plan of using.get(call) ?? []) {
            records.push(record(plan, ledger.get(plan)!, { ...at, eventIndex, title, department }, false, true, false, undefined));
          }
          frames.push(sim(leader, 'specialist_done', {
            ...at, department, summary: `${department} report for turn ${turn}.`, eventIndex, citations: 0, citationList: [], risks: [],
            // A list the page cannot read: the tools as one string.
            forgedTools: unreadable ? JSON.stringify(records) : records,
            recommendedActions: [],
          }));
        }

        frames.push(sim(leader, 'decision_pending', { ...at, eventIndex }));
        frames.push(sim(leader, 'decision_made', { ...at, decision: 'Hold the safe line.', rationale: 'The reserve covers it.', reasoning: 'The reserve covers it.', selectedPolicies: [], eventIndex }));
        frames.push(sim(leader, 'outcome', { ...at, outcome: 'conservative_success', category: 'environmental', emergent: false, systemDeltas: { morale: 0.02 }, eventIndex }));
      }

      frames.push(systemsSnapshot(leader, turn, time, crewOf(leader, turn, spec.departments, population), morale));
      frames.push(sim(leader, 'turn_done', { ...at, metrics: { population, morale }, toolsForged: approvedTools }));
    }

    frames.push(frame('result', {
      leader: p.actor.tag,
      actorIndex: p.actor.index,
      summary: { population, morale, toolsForged: approvedTools, citations: 0 },
      fingerprint: null,
    }));
  }

  frames.push(frame('complete', { timestamp: new Date(firstForge + forgeCount * 4000 + 60_000).toISOString() }));

  if (!spec.reportOnly && forgeCount !== spec.forges) {
    throw new Error(`${spec.label}: wrote ${forgeCount} forges, the spec holds ${spec.forges}`);
  }
  return frames;
}

/**
 * A tool as a department's report lists it, with the registry's history of it
 * up to this report. The report adds one history row: a forge row when the
 * department forged the tool in this call, else a use row.
 */
function record(
  plan: ToolPlan,
  known: { turn: number; eventIndex: number; history: Array<Record<string, unknown>> },
  at: { turn: number; time: number; eventIndex: number; title: string; department: string },
  isNew: boolean,
  approved: boolean,
  forgedHere: boolean,
  reason: string | undefined,
): Record<string, unknown> {
  const output = approved ? plan.output : null;
  const confidence = approved ? plan.confidence : 0;
  known.history.push({
    turn: at.turn, time: at.time, eventIndex: at.eventIndex, eventTitle: at.title, department: at.department,
    output, isReforge: forgedHere, rejected: !approved, confidence,
  });
  return {
    name: plan.name,
    mode: 'sandbox',
    confidence,
    description: plan.description,
    output,
    inputFields: [plan.inputField, 'days_elapsed'],
    outputFields: [plan.outputField],
    department: at.department,
    crisis: at.title,
    approved,
    ...(reason ? { errorReason: reason } : {}),
    isNew,
    firstForgedTurn: known.turn,
    firstForgedDepartment: plan.department,
    firstForgedEventIndex: known.eventIndex,
    firstForgedEventTitle: titleOf(known.turn, known.eventIndex),
    inputSchema: {
      type: 'object',
      properties: {
        [plan.inputField]: { type: 'number', description: `The latest ${plan.inputField.replace(/_/g, ' ')}.` },
        days_elapsed: { type: 'integer', description: 'Days since landfall.' },
      },
      required: [plan.inputField],
    },
    outputSchema: { type: 'object', properties: { [plan.outputField]: { type: 'number' } }, required: [plan.outputField] },
    reuseCount: Math.max(0, known.history.length - 1),
    history: [...known.history],
  };
}
