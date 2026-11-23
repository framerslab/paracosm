/**
 * The dashboard server with three finished Mars Genesis runs stored as
 * sessions, of 3, 24 and 300 leaders, on a port of its own, for the cases of
 * tests-e2e/specs/sim-first-screen.spec.ts that open a run of 3 or more
 * leaders on the Sim tab.
 *
 * The server code is the real one, over HTTP. Each run holds one turn of
 * every leader's colony at the hosted demo's size of 30 people:
 *
 * - The people are the engine's: each colony is a Mars Genesis kernel on the
 *   scenario's default seed with the scenario's key people, advanced one
 *   turn as the turn loop advances it (tests-e2e/support/kernel-turn.ts),
 *   and its turn_start, turn_done and systems_snapshot frames carry that
 *   turn's births, deaths, metrics and roster.
 * - No model has spoken: the turn holds no event, no report and no decision,
 *   and every person's mood is neutral.
 *
 * The first three leaders are Mars Genesis's two written leaders and a
 * preset one; a larger run adds numbered ones.
 *
 * Each run is saved under its label as the scenario name, so a test finds
 * its id in the server's own GET /sessions; /sim?replay=<id> plays it
 * through the server's own /sessions/:id/replay. The run history is empty.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenarioKeyPersonnel } from '../../src/cli/sim-config.js';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { createMarsServer } from '../../src/server/server-app.js';
import { openSessionStore, type TimestampedEvent } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { advanceKernelTurn, quietTurnFrames } from './kernel-turn.js';
import { frame } from './run-frames.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-e2e-cohort-replay-'));
const runsDir = join(appDir, 'runs');
process.env.PARACOSM_OUTPUT_DIR = runsDir;

/** The sizes of the stored runs: the fewest leaders past a pair, dozens, and the most a run holds. */
const SIZES = [3, 24, 300] as const;
/** The label a run of `n` leaders is saved under, which GET /sessions answers as its scenario name. */
const labelOf = (n: number): string => `${marsScenario.labels.name} · ${n} leaders`;

const NAMED = [
  { name: 'Aria Chen', archetype: 'The Visionary' },
  { name: 'Dietrich Voss', archetype: 'The Engineer' },
  { name: 'Yuki Tanaka', archetype: 'The Innovator' },
];
/** The run's leaders: the three named ones, then numbered ones. */
const leadersOf = (n: number): Array<{ name: string; archetype: string }> =>
  Array.from({ length: n }, (_, i) => NAMED[i] ?? { name: `Planner ${i + 1}`, archetype: 'The Planner' });

const POPULATION = 30;
const START = marsScenario.setup.defaultStartTime;
const SEED = marsScenario.setup.defaultSeed;
const KEY_PEOPLE = scenarioKeyPersonnel(marsScenario);

/** One stored run: every leader's first turn, then the run's end. */
function runFrames(n: number): string[] {
  const leaders = leadersOf(n);
  const frames: string[] = [
    frame('active_scenario', { id: marsScenario.id, name: marsScenario.labels.name, runKey: `a-cohort-replay-run-of-${n}`, forkedFrom: null }),
    frame('status', { phase: 'starting', maxTurns: 1, customEvents: [] }),
    frame('status', { phase: 'parallel', actors: leaders }),
  ];
  for (const leader of leaders) {
    const kernel = new SimulationKernel(SEED, leader.name, KEY_PEOPLE, { startTime: START, initialPopulation: POPULATION, scenario: marsScenario });
    frames.push(...quietTurnFrames(leader.name, advanceKernelTurn(kernel, 1, START, marsScenario)));
  }
  frames.push(frame('complete', { timestamp: '2026-11-20T10:05:00.000Z' }));
  return frames;
}

const sessionStore = openSessionStore(join(appDir, 'data', 'sessions.db'));
const startTs = Date.parse('2026-11-20T10:00:00.000Z');

for (const n of SIZES) {
  const events: TimestampedEvent[] = runFrames(n).map((sse, i) => ({ ts: startTs + i * 250, sse }));
  await sessionStore.saveSession(events, {
    scenarioId: marsScenario.id,
    scenarioName: labelOf(n),
    leaderA: NAMED[0].name,
    leaderB: NAMED[1].name,
  });
}

mkdirSync(runsDir, { recursive: true });

const server = createMarsServer({
  env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore: createSqliteRunHistoryStore({ dbPath: join(appDir, 'runs.db') }),
  sessionStore,
  getDigitalTwinWorld: async () => null,
});
server.listen(Number(process.env.PORT ?? 3471));
