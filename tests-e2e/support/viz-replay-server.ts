/**
 * The dashboard server with one finished Mars Genesis pair run stored as a
 * session, on a port of its own, for the spec that opens the run in the Viz
 * tab (tests-e2e/specs/viz-living-grid.spec.ts).
 *
 * The run holds the frames the orchestrator emits for Aria Chen and Dietrich
 * Voss over the scenario's six turns of eight years from 2035:
 *
 * - The words are the hosted demo's own, from the pair it saved on 11
 *   November 2026 (tests/fixtures/mars-pair-chat-2026-11-11.json): each
 *   turn's event, each commander's decisions and their outcomes with the
 *   system changes the engine applied, the department reports and the
 *   colonists' reactions.
 * - The people are the engine's: each colony is a Mars Genesis kernel of 30
 *   people advanced turn by turn as the turn loop advances it, and each
 *   turn's turn_start, turn_done and systems_snapshot frames carry its
 *   births, its deaths with their causes, its metrics and its roster as the
 *   orchestrator builds them, each colonist's mood taken from that turn's
 *   reactions the way the orchestrator takes it.
 *
 * The two colonies run on seeds of their own, so their births and deaths
 * differ as two commanders' choices make them differ. The seeds are the first
 * pair from the scenario's default seed on in which Aria Chen's colony loses
 * people to a recorded cause after the first turn, and in which some turn has
 * fewer deaths than the turn before on one side while the two sides' changes
 * differ. The spec reads the turn banner and the highlight strip on those
 * turns, and reads which turns they are from the stored stream itself.
 *
 * A second stored run adds a third commander to the same two colonies: Yuki
 * Tanaka, a preset Mars Genesis leader, on a kernel seed of its own, speaking
 * Dietrich Voss's recorded words. With three actors the Viz opens on every
 * actor's panel and offers a pair view whose panels each pick their
 * commander; the spec changes a panel's commander there.
 *
 * GET /sessions lists the two stored runs; /sim?replay=<id> plays one through
 * the server's own /sessions/:id/replay.
 *
 * With VIZ_REPLAY_EVENT_STARTS=1 each commander's turn also carries the
 * event_start frame the orchestrator sends as the turn's first event begins
 * (src/runtime/orchestrator/index.ts): its title, description and category
 * are the turn_start's, which the orchestrator takes from that same event.
 * The hosted demo's recording keeps no event_start frames, so without them
 * the Viz tab draws no event row; the live replays draw one. The spec that
 * lays out the rows above the living grid on a phone
 * (tests-e2e/specs/viz-rows-type.spec.ts) reads the runs this way, from a
 * server of its own.
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { openSessionStore, type TimestampedEvent } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { ageInYears } from '../../src/engine/core/time-unit.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { systemsSnapshotTotals } from '../../src/runtime/orchestrator/outcome-effects.js';

/** Whether each turn carries its first event's event_start frame, as a live run's does. */
const EVENT_STARTS = process.env.VIZ_REPLAY_EVENT_STARTS === '1';
const HOSTED_CHROME = process.env.VIZ_REPLAY_HOSTED_CHROME === '1';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-e2e-viz-replay-'));
const runsDir = join(appDir, 'runs');
process.env.PARACOSM_OUTPUT_DIR = runsDir;

interface RecordedEvent {
  type: string;
  leader: string;
  data: Record<string, unknown>;
}

const recorded = (JSON.parse(
  readFileSync(new URL('../../tests/fixtures/mars-pair-chat-2026-11-11.json', import.meta.url), 'utf8'),
) as { events: RecordedEvent[] }).events;

const LEADERS = [
  { name: 'Aria Chen', archetype: 'The Visionary' },
  { name: 'Dietrich Voss', archetype: 'The Engineer' },
];
/** The third commander of the second stored run: a preset Mars Genesis leader (src/engine/presets/index.ts). */
const THIRD = { name: 'Yuki Tanaka', archetype: 'The Innovator' };
const TURNS = 6;
const POPULATION = 30;
const START = marsScenario.setup.defaultStartTime;
const YEARS_A_TURN = marsScenario.setup.defaultTimePerTurn ?? 8;

interface ColonyTurn {
  turn: number;
  time: number;
  births: number;
  deaths: number;
  deathCauses?: Record<string, number>;
  metrics: Record<string, number>;
  agents: Array<Record<string, unknown>>;
}

/** The mood each colonist who reacted under `leader` in `turn` gave, by agent id. */
function moodsFor(leader: string, turn: number): Map<string, string> {
  const moods = new Map<string, string>();
  for (const e of recorded) {
    if (e.type !== 'agent_reactions' || e.leader !== leader || e.data.turn !== turn) continue;
    for (const r of (e.data.reactions as Array<{ agentId?: string; mood?: string }> | undefined) ?? []) {
      if (r.agentId && r.mood) moods.set(r.agentId, r.mood);
    }
  }
  return moods;
}

/** One colony's six turns, advanced and read as the orchestrator's turn loop advances and reads them. */
function colony(seed: number, leader: string): ColonyTurn[] {
  const kernel = new SimulationKernel(seed, leader, [], { startTime: START, initialPopulation: POPULATION, scenario: marsScenario });
  const turns: ColonyTurn[] = [];
  for (let turn = 1; turn <= TURNS; turn++) {
    const time = START + (turn - 1) * YEARS_A_TURN;
    kernel.advanceTurn(turn, time, marsScenario.hooks?.progressionHook);
    const after = kernel.getState();
    const thisTurn = after.eventLog.filter(e => e.turn === turn);
    const births = thisTurn.filter(e => e.type === 'birth').length;
    const deathEvents = thisTurn.filter(e => e.type === 'death');
    // The orchestrator's roll-up: accident sub-types count as 'accident'.
    const deathCauses: Record<string, number> = {};
    for (const d of deathEvents) {
      const raw = d.cause ?? 'unknown';
      const key = raw.startsWith('accident:') ? 'accident' : raw;
      deathCauses[key] = (deathCauses[key] ?? 0) + 1;
    }
    // Generation as the orchestrator computes it: 0 for the Earth-born, one
    // more than the deepest parent for the born here.
    const byId = new Map(after.agents.map(a => [a.core.id, a]));
    const generations = new Map<string, number>();
    const generation = (id: string, depth = 0): number => {
      if (depth > 10) return depth;
      const known = generations.get(id);
      if (known !== undefined) return known;
      const agent = byId.get(id);
      if (!agent) return 0;
      if (!agent.core.marsborn) {
        generations.set(id, 0);
        return 0;
      }
      const parents = after.agents.filter(p => p.social.childrenIds.includes(id));
      const gen = parents.length === 0 ? 1 : Math.max(...parents.map(p => generation(p.core.id, depth + 1))) + 1;
      generations.set(id, gen);
      return gen;
    };
    const moods = moodsFor(leader, turn);
    turns.push({
      turn,
      time,
      births,
      deaths: deathEvents.length,
      deathCauses: Object.keys(deathCauses).length > 0 ? deathCauses : undefined,
      metrics: { ...after.metrics } as Record<string, number>,
      agents: after.agents.map(a => ({
        agentId: a.core.id,
        name: a.core.name,
        department: a.core.department,
        role: a.core.role,
        rank: a.career.rank,
        alive: a.health.alive,
        marsborn: a.core.marsborn,
        psychScore: a.health.psychScore,
        age: Math.max(0, Math.floor(ageInYears(a, time, kernel.yearsPerUnit))),
        generation: generation(a.core.id),
        partnerId: a.social.partnerId,
        childrenIds: a.social.childrenIds,
        featured: a.narrative.featured,
        mood: moods.get(a.core.id) ?? 'neutral',
        shortTermMemory: (a.memory?.shortTerm ?? []).slice(-2).map(m => m.content),
      })),
    });
  }
  return turns;
}

/** True when some turn has fewer deaths than the turn before on one side while the two sides' changes differ. */
function deathsFallOnOneSide(a: ColonyTurn[], b: ColonyTurn[]): boolean {
  for (let i = 1; i < TURNS; i++) {
    const changeA = a[i].deaths - a[i - 1].deaths;
    const changeB = b[i].deaths - b[i - 1].deaths;
    if (changeA !== changeB && Math.min(changeA, changeB) < 0) return true;
  }
  return false;
}

function pickColonies(): [ColonyTurn[], ColonyTurn[]] {
  const base = marsScenario.setup.defaultSeed;
  for (let seedA = base; seedA < base + 50; seedA++) {
    const a = colony(seedA, LEADERS[0].name);
    if (!a.some(t => t.turn > 1 && t.deathCauses)) continue;
    for (let seedB = seedA + 1; seedB < seedA + 200; seedB++) {
      const b = colony(seedB, LEADERS[1].name);
      if (deathsFallOnOneSide(a, b)) return [a, b];
    }
  }
  throw new Error('No pair of Mars Genesis seeds near the default gives the deaths the Viz spec reads.');
}

const frame = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sim = (leader: string, type: string, data: Record<string, unknown>): string => frame('sim', { type, leader, data });

/**
 * One commander's turn: the recorded event, reports, decisions, outcomes and
 * reactions, between the engine's frames. `wordsOf` names the recorded
 * commander whose words the turn carries; it is the commander's own unless a
 * commander has no recording.
 */
function leaderTurn(leader: string, t: ColonyTurn, wordsOf = leader): string[] {
  const mine = recorded.filter(e => e.leader === wordsOf && e.data.turn === t.turn);
  const start = mine.find(e => e.type === 'turn_start' && e.data.title !== 'Director generating...');
  const between = mine.filter(e => e.type !== 'turn_start' && e.type !== 'systems_snapshot');
  const outcomes = between.filter(e => e.type === 'outcome').length;
  const at = { turn: t.turn, time: t.time };
  // The recording omits usage. Use fixture totals in the per-leader
  // cumulative shape the dashboard consumes from a completed turn.
  const usage = HOSTED_CHROME ? {
    _cost: { totalTokens: t.turn * 15_000, totalCostUSD: t.turn * 0.02, llmCalls: t.turn * 10 },
  } : {};
  // The first event's event_start, as the orchestrator sends it after the turn_start.
  const eventStart = EVENT_STARTS && start?.data.title
    ? [sim(leader, 'event_start', {
        ...at,
        eventIndex: 0,
        totalEvents: outcomes,
        title: start.data.title,
        description: start.data.crisis ?? '',
        category: start.data.category ?? '',
        emergent: start.data.emergent ?? false,
        turnSummary: start.data.turnSummary ?? '',
        pacing: start.data.pacing ?? 'normal',
      })]
    : [];
  return [
    sim(leader, 'turn_start', {
      ...at,
      title: start?.data.title ?? '',
      crisis: start?.data.crisis ?? '',
      category: start?.data.category ?? '',
      births: t.births,
      deaths: t.deaths,
      metrics: t.metrics,
      emergent: start?.data.emergent ?? false,
      turnSummary: start?.data.turnSummary ?? '',
      totalEvents: outcomes,
      pacing: start?.data.pacing ?? 'normal',
    }),
    ...eventStart,
    ...between.map(e => sim(leader, e.type, { ...e.data, ...at })),
    sim(leader, 'turn_done', { ...at, metrics: t.metrics, toolsForged: 0, totalEvents: outcomes, ...usage, ...(t.deathCauses ? { deathCauses: t.deathCauses } : {}) }),
    sim(leader, 'systems_snapshot', { ...at, agents: t.agents, ...systemsSnapshotTotals(t.metrics), births: t.births, deaths: t.deaths }),
  ];
}

const [colonyA, colonyB] = pickColonies();
const frames: string[] = [
  frame('active_scenario', { id: marsScenario.id, name: marsScenario.labels.name, runKey: 'a-viz-replay-pair-run', forkedFrom: null }),
  frame('status', { phase: 'starting', maxTurns: TURNS, customEvents: [] }),
  frame('status', { phase: 'parallel', actors: LEADERS }),
];
for (let i = 0; i < TURNS; i++) {
  frames.push(...leaderTurn(LEADERS[0].name, colonyA[i]), ...leaderTurn(LEADERS[1].name, colonyB[i]));
}
frames.push(frame('complete', { timestamp: '2026-11-11T09:51:00.000Z' }));

const startTs = Date.parse('2026-11-11T09:41:00.000Z');
const events: TimestampedEvent[] = frames.map((sse, i) => ({ ts: startTs + i * 250, sse }));

const sessionStore = openSessionStore(join(appDir, 'data', 'sessions.db'));
await sessionStore.saveSession(events, {
  scenarioId: marsScenario.id,
  scenarioName: marsScenario.labels.name,
  leaderA: LEADERS[0].name,
  leaderB: LEADERS[1].name,
}, { pinned: HOSTED_CHROME });

// The second stored run: the same two colonies and a third, Yuki Tanaka's, on
// the first seed past the pair's search, with Dietrich Voss's words.
const colonyC = colony(marsScenario.setup.defaultSeed + 250, THIRD.name);
const cohortFrames: string[] = [
  frame('active_scenario', { id: marsScenario.id, name: marsScenario.labels.name, runKey: 'a-viz-replay-cohort-run', forkedFrom: null }),
  frame('status', { phase: 'starting', maxTurns: TURNS, customEvents: [] }),
  frame('status', { phase: 'parallel', actors: [...LEADERS, THIRD] }),
];
for (let i = 0; i < TURNS; i++) {
  cohortFrames.push(
    ...leaderTurn(LEADERS[0].name, colonyA[i]),
    ...leaderTurn(LEADERS[1].name, colonyB[i]),
    ...leaderTurn(THIRD.name, colonyC[i], LEADERS[1].name),
  );
}
cohortFrames.push(frame('complete', { timestamp: '2026-11-11T10:21:00.000Z' }));
const cohortStartTs = Date.parse('2026-11-11T10:11:00.000Z');
await sessionStore.saveSession(cohortFrames.map((sse, i) => ({ ts: cohortStartTs + i * 250, sse })), {
  scenarioId: marsScenario.id,
  scenarioName: marsScenario.labels.name,
  leaderA: LEADERS[0].name,
  leaderB: LEADERS[1].name,
}, { pinned: HOSTED_CHROME });

mkdirSync(runsDir, { recursive: true });
const runHistoryStore = createSqliteRunHistoryStore({ dbPath: join(appDir, 'runs.db') });

const server = createMarsServer({
  // Platform mode wins over the hosted demo (src/server/server-mode.ts), so a
  // PARACOSM_PLATFORM_API set in the shell is cleared here.
  env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_PLATFORM_API: '', PARACOSM_HOSTED_DEMO: HOSTED_CHROME ? 'true' : '' },
  siteAnalyticsIds: HOSTED_CHROME ? { ga: 'G-E2E0TEST00', clarity: 'e2econsent' } : undefined,
  maxSimsPerDay: 0,
  runHistoryStore,
  sessionStore,
  getDigitalTwinWorld: async () => null,
});
server.listen(Number(process.env.PORT ?? 3466));
