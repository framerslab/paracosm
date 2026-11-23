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
 * turns (tests-e2e/support/pair-run.ts): Aria Chen's engineering department
 * forges mars_landing_site_score in turn 1 and uses it again in turn 2;
 * Dietrich Voss's medical department forges perchlorate_water_response_score
 * in turn 1; and ten more tools, some forged twice or not passing, ride
 * beside them. The server's own GET /sessions lists the one stored run, so a
 * test reads its id there.
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
import { ARIA, DIETRICH, pairRunFrames } from './pair-run.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-e2e-shared-run-'));
const runsDir = join(appDir, 'runs');
process.env.PARACOSM_OUTPUT_DIR = runsDir;

const frames = pairRunFrames();

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
