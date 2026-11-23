/**
 * The dashboard server with three stored runs in its Library, on a port of
 * its own.
 *
 * The server code is the real one, over HTTP: its run history is the SQLite
 * store in a temporary folder, and each run's artifact file sits in its runs
 * directory (PARACOSM_OUTPUT_DIR), so the Library lists the runs, the drawer
 * reads each artifact and Replay runs the server's own replay against Mars
 * Genesis. The artifacts hold Mars Genesis kernel snapshots taken as the
 * turn loop takes them, with no model:
 *
 * - "Recorded run": the snapshots as taken, so replay matches it;
 * - "Changed run": the same, with the morale its second between-turn step
 *   left changed to 0.123456789, so replay names that value;
 * - "Older run": end-of-turn snapshots alone, as a run saved before replay
 *   could verify one holds, so replay answers that it cannot verify it.
 *
 * A replay here changes this server's replay counters and nobody else's.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createSqliteRunHistoryStore } from '../../src/server/stores/sqlite-run-history.js';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import type { KernelSnapshot } from '../../src/engine/core/snapshot.js';
import type { RunRecord } from '../../src/server/services/run-record.js';

const appDir = mkdtempSync(join(tmpdir(), 'paracosm-e2e-library-replay-'));
const runsDir = join(appDir, 'runs');
// The routes read an artifact file only inside the runs directory.
process.env.PARACOSM_OUTPUT_DIR = runsDir;

/** The state before turn 1, then the state after each turn's between-turn step, three turns. */
function marsSnapshots(seed: number): KernelSnapshot[] {
  const start = marsScenario.setup.defaultStartTime;
  const kernel = new SimulationKernel(seed, 'leader-a', [], { startTime: start, scenario: marsScenario });
  const snapshots: KernelSnapshot[] = [kernel.toSnapshot(marsScenario.id)];
  for (let turn = 1; turn <= 3; turn++) {
    kernel.advanceTurn(turn, start + turn, marsScenario.hooks?.progressionHook);
    snapshots.push(kernel.toSnapshot(marsScenario.id));
  }
  return snapshots;
}

/**
 * A turn-loop artifact whose turns changed nothing after their steps, so
 * each turn ends in the state its step left. Each decision carries its
 * turn's time, which replay matches with the state saved after that
 * turn's step.
 */
function artifact(runId: string, snaps: KernelSnapshot[], withStepSnapshots: boolean): Record<string, unknown> {
  return {
    metadata: {
      runId,
      scenario: { id: marsScenario.id, name: marsScenario.labels.name },
      mode: 'turn-loop',
      seed: 42,
      startedAt: '2026-11-12T00:00:00.000Z',
      completedAt: '2026-11-12T00:01:00.000Z',
    },
    decisions: snaps.slice(1).map(s => ({ time: s.time, actor: 'leader-a', choice: 'safe', rationale: '', outcome: 'conservative_success' })),
    scenarioExtensions: withStepSnapshots
      ? { kernelSnapshotsPerTurn: snaps.slice(1), kernelSnapshotAtStart: snaps[0], kernelSnapshotsAfterProgression: snaps.slice(1) }
      : { kernelSnapshotsPerTurn: snaps.slice(1) },
  };
}

const recorded = marsSnapshots(42);
const changed = JSON.parse(JSON.stringify(recorded)) as KernelSnapshot[];
(changed[2].state as unknown as { metrics: Record<string, number> }).metrics.morale = 0.123456789;

const runs: Array<{ runId: string; actorName: string; body: Record<string, unknown>; minutesAgo: number }> = [
  { runId: 'run_library_recorded', actorName: 'Recorded run', body: artifact('run_library_recorded', recorded, true), minutesAgo: 3 },
  { runId: 'run_library_changed', actorName: 'Changed run', body: artifact('run_library_changed', changed, true), minutesAgo: 2 },
  { runId: 'run_library_older', actorName: 'Older run', body: artifact('run_library_older', recorded, false), minutesAgo: 1 },
];

const store = createSqliteRunHistoryStore({ dbPath: join(appDir, 'runs.db') });
mkdirSync(runsDir, { recursive: true });
for (const run of runs) {
  const artifactPath = join(runsDir, `v3-${run.runId}.json`);
  writeFileSync(artifactPath, JSON.stringify(run.body));
  const record: RunRecord = {
    runId: run.runId,
    createdAt: new Date(Date.now() - run.minutesAgo * 60_000).toISOString(),
    scenarioId: marsScenario.id,
    scenarioVersion: '0.9.0',
    actorConfigHash: `leaders:${run.runId}`,
    economicsProfile: 'balanced',
    sourceMode: 'local_demo',
    createdBy: 'anonymous',
    artifactPath,
    mode: 'turn-loop',
    actorName: run.actorName,
  };
  await store.insertRun(record);
}

const server = createMarsServer({
  env: { ...process.env, APP_DIR: appDir, PARACOSM_OUTPUT_DIR: runsDir, PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore: store,
  getDigitalTwinWorld: async () => null,
});
server.listen(Number(process.env.PORT ?? 3460));
