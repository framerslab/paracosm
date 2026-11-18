/**
 * The dashboard server with one finished Mars Genesis pair run that forged
 * tools, stored as the server stores a finished run, on a port of its own.
 *
 * The server code is the real one, over HTTP. The run's stream is saved in
 * the session store (APP_DIR/data/sessions.db), so /sim?replay=<id> plays it
 * through the server's own /sessions/:id/replay; and Aria Chen's run sits in
 * the run history with that session id beside it, as the server links them
 * after a run, so the Library lists it and its drawer offers to share it.
 *
 * The stream holds the frames the orchestrator emits for two leaders over two
 * turns: Aria Chen's engineering department forges mars_landing_site_score
 * in turn 1 and uses it again in turn 2; Dietrich Voss's medical department
 * forges perchlorate_water_response_score in turn 1. The server's own
 * GET /sessions lists the one stored run, so a test reads its id there.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { openSessionStore, type TimestampedEvent } from '../../src/server/stores/session.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { RunRecord } from '../../src/server/services/run-record.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-e2e-shared-run-'));
const runsDir = join(appDir, 'runs');
process.env.PARACOSM_OUTPUT_DIR = runsDir;

const ARIA = { name: 'Aria Chen', archetype: 'The Visionary' };
const DIETRICH = { name: 'Dietrich Voss', archetype: 'The Engineer' };

const frame = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const sim = (leader: string, type: string, data: Record<string, unknown>): string => frame('sim', { type, leader, data });

/** A forged tool as specialist_done carries it in forgedTools. */
function tool(name: string, description: string, department: string, firstForgedTurn: number, isNew: boolean, confidence: number) {
  return {
    name,
    description,
    mode: 'sandbox',
    approved: true,
    confidence,
    inputFields: ['radiation_msv_per_day', 'ice_index'],
    outputFields: ['score'],
    output: JSON.stringify({ score: 82 }),
    department,
    isNew,
    firstForgedTurn,
    firstForgedDepartment: department,
  };
}

/** forge_attempt as the orchestrator emits it when a department forges a tool. */
function forge(leader: string, turn: number, time: number, department: string, name: string, description: string, confidence: number): string {
  return sim(leader, 'forge_attempt', {
    turn, time, eventIndex: 0, department, name, description, mode: 'sandbox',
    approved: true, confidence,
    inputFields: ['radiation_msv_per_day', 'ice_index'], outputFields: ['score'],
    timestamp: '2026-11-16T01:52:10.000Z',
  });
}

/** One leader's turn: the event, one department's report with the tools it used, the decision and its outcome. */
function leaderTurn(
  leader: string,
  turn: number,
  department: string,
  forges: string[],
  tools: ReturnType<typeof tool>[],
): string[] {
  const time = 2035 + (turn - 1) * 8;
  const at = { turn, time };
  return [
    sim(leader, 'turn_start', { ...at, title: turn === 1 ? 'Landfall' : 'Dust Season', crisis: 'Choose where to build.', category: 'environmental', births: 0, deaths: 0, metrics: { population: 30, morale: 0.85 }, emergent: false, turnSummary: '', totalEvents: 1, pacing: 'normal' }),
    sim(leader, 'event_start', { ...at, eventIndex: 0, totalEvents: 1, title: turn === 1 ? 'Landfall' : 'Dust Season', description: 'Choose where to build.', category: 'environmental', emergent: false, turnSummary: '', pacing: 'normal' }),
    sim(leader, 'specialist_start', { ...at, department, eventIndex: 0 }),
    ...forges,
    sim(leader, 'specialist_done', { ...at, department, summary: `${department} report for turn ${turn}.`, eventIndex: 0, citations: 0, citationList: [], risks: [], forgedTools: tools, recommendedActions: [] }),
    sim(leader, 'decision_pending', { ...at, eventIndex: 0 }),
    sim(leader, 'decision_made', { ...at, decision: 'Build on the plains.', rationale: 'The plains are safer.', reasoning: 'The plains are safer.', selectedPolicies: [], eventIndex: 0 }),
    sim(leader, 'outcome', { ...at, outcome: 'conservative_success', category: 'environmental', emergent: false, systemDeltas: { morale: 0.02 }, eventIndex: 0 }),
    sim(leader, 'turn_done', { ...at, metrics: { population: 30, morale: 0.87 }, toolsForged: 1 }),
  ];
}

const LANDING = 'mars_landing_site_score';
const LANDING_TEXT = 'Scores a landing site on radiation and subsurface ice.';
const WATER = 'perchlorate_water_response_score';
const WATER_TEXT = 'Scores the water supply response to a perchlorate reading.';

const frames: string[] = [
  frame('active_scenario', { id: marsScenario.id, name: marsScenario.labels.name, runKey: 'a-shared-pair-run', forkedFrom: null }),
  frame('status', { phase: 'starting', maxTurns: 2, customEvents: [] }),
  frame('status', { phase: 'parallel', actors: [ARIA, DIETRICH] }),
  ...leaderTurn(ARIA.name, 1, 'engineering', [forge(ARIA.name, 1, 2035, 'engineering', LANDING, LANDING_TEXT, 0.98)], [tool(LANDING, LANDING_TEXT, 'engineering', 1, true, 0.98)]),
  ...leaderTurn(DIETRICH.name, 1, 'medical', [forge(DIETRICH.name, 1, 2035, 'medical', WATER, WATER_TEXT, 0.97)], [tool(WATER, WATER_TEXT, 'medical', 1, true, 0.97)]),
  ...leaderTurn(ARIA.name, 2, 'engineering', [], [tool(LANDING, LANDING_TEXT, 'engineering', 1, false, 0.98)]),
  ...leaderTurn(DIETRICH.name, 2, 'medical', [], []),
  frame('complete', { timestamp: '2026-11-16T01:55:39.000Z' }),
];

const startTs = Date.parse('2026-11-16T01:51:55.000Z');
const events: TimestampedEvent[] = frames.map((sse, i) => ({ ts: startTs + i * 250, sse }));

const sessionStore = openSessionStore(join(appDir, 'data', 'sessions.db'));
const { id: sessionId } = await sessionStore.saveSession(events, { scenarioId: marsScenario.id, scenarioName: marsScenario.labels.name, leaderA: ARIA.name, leaderB: DIETRICH.name });

// Aria Chen's run as the run history holds it, linked to the stored stream.
const start = marsScenario.setup.defaultStartTime;
const kernel = new SimulationKernel(950, 'leader-a', [], { startTime: start, scenario: marsScenario });
const snapshots = [kernel.toSnapshot(marsScenario.id)];
for (let turn = 1; turn <= 2; turn++) {
  kernel.advanceTurn(turn, start + turn, marsScenario.hooks?.progressionHook);
  snapshots.push(kernel.toSnapshot(marsScenario.id));
}
mkdirSync(runsDir, { recursive: true });
const runId = 'run_shared_aria';
const artifactPath = join(runsDir, `v3-${runId}.json`);
writeFileSync(artifactPath, JSON.stringify({
  metadata: {
    runId,
    scenario: { id: marsScenario.id, name: marsScenario.labels.name },
    mode: 'turn-loop',
    seed: 950,
    startedAt: '2026-11-16T01:51:55.000Z',
    completedAt: '2026-11-16T01:55:39.000Z',
  },
  decisions: snapshots.slice(1).map(s => ({ time: s.time, actor: 'leader-a', choice: 'safe', rationale: '', outcome: 'conservative_success' })),
  scenarioExtensions: { kernelSnapshotsPerTurn: snapshots.slice(1) },
}));
const runHistoryStore = createSqliteRunHistoryStore({ dbPath: join(appDir, 'runs.db') });
const record: RunRecord = {
  runId,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  scenarioId: marsScenario.id,
  scenarioVersion: '0.9.0',
  actorConfigHash: `leaders:${runId}`,
  economicsProfile: 'balanced',
  sourceMode: 'local_demo',
  createdBy: 'anonymous',
  artifactPath,
  mode: 'turn-loop',
  actorName: ARIA.name,
  sessionId,
};
await runHistoryStore.insertRun(record);

const server = createMarsServer({
  env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore,
  sessionStore,
  getDigitalTwinWorld: async () => null,
});
server.listen(Number(process.env.PORT ?? 3462));
