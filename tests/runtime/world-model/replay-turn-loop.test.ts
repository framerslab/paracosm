/**
 * Replay of a run the turn loop saved (#235).
 *
 * The turn loop saved each turn's snapshot at the end of the turn, after
 * the turn's decisions, outcomes and drift, and replay re-ran only the
 * between-turn step from one snapshot to the next, so every run the turn
 * loop saved with an event after turn 1 replayed to `matches: false`. The
 * tests in replay.test.ts build their snapshots with `advanceTurn` alone,
 * so they passed.
 *
 * Here the run is the real `runSimulation` on Mars Genesis, its decisions
 * the replies Aria Chen wrote in the hosted pair of 11 November 2026, given
 * by a stub model (tests/runtime/helpers/stub-model-mars-run.ts; no network,
 * no paid call). A run saved before the turn loop kept what replay needs is
 * the trimmed hosted Atlas Lab run of 2 November 2026, whose second snapshot
 * holds 0.71 alignmentBench where its first holds 0.73: no between-turn step
 * writes that key, its turn 2 decisions did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldModel, WorldModelReplayError } from '../../../src/runtime/world-model/index.js';
import { marsScenario } from '../../../src/engine/scenarios/index.js';
import type { KernelSnapshot } from '../../../src/engine/core/snapshot.js';
import type { RunArtifact } from '../../../src/engine/schema/index.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../../src/cli/custom-scenarios.js';
import { runMarsWithStubModel } from '../helpers/stub-model-mars-run.js';

const here = dirname(fileURLToPath(import.meta.url));

interface SnapshotExtensions {
  kernelSnapshotsPerTurn?: KernelSnapshot[];
  kernelSnapshotAtStart?: KernelSnapshot;
  kernelSnapshotsAfterProgression?: KernelSnapshot[];
  paracosmInternal?: { commanderDecisions?: Array<{ turn: number; decision: { selectedOptionId?: string } }> };
}

const extensionsOf = (artifact: RunArtifact) => (artifact.scenarioExtensions ?? {}) as SnapshotExtensions;

/** One stubbed run for the file: the turn loop is the expensive part. */
let pending: ReturnType<typeof runMarsWithStubModel> | undefined;
const stubbedRun = () => (pending ??= runMarsWithStubModel());

/** The artifact as a server stores and reads it: through JSON. */
const stored = (artifact: RunArtifact) => JSON.parse(JSON.stringify(artifact)) as RunArtifact;

test('a Mars run the turn loop saved, with its decisions applied, replays to matches true', async () => {
  const { artifact, log } = await stubbedRun();
  assert.deepEqual(log.decisions, ['Landfall', 'Legacy Assessment'], 'the stub model gave both decisions their recorded replies');
  const ext = extensionsOf(artifact);
  assert.deepEqual(
    ext.paracosmInternal?.commanderDecisions?.map(d => [d.turn, d.decision.selectedOptionId]),
    [[1, 'option_b'], [2, 'option_a']],
    'the run took the recorded choices',
  );
  assert.deepEqual(ext.kernelSnapshotsPerTurn?.map(s => s.turn), [1, 2]);

  const wm = WorldModel.fromScenario(marsScenario);
  const result = await wm.replay(artifact);
  assert.equal(result.matches, true, `divergence: ${result.divergence}`);
  assert.equal(result.divergence, '');

  // The same run read back from disk, as POST /api/v1/runs/:runId/replay reads it.
  const fromDisk = await wm.replay(stored(artifact));
  assert.equal(fromDisk.matches, true, `divergence after the JSON round trip: ${fromDisk.divergence}`);

  // What replay compared: the state right after each between-turn step,
  // which turn 2's decisions then moved on, so a match is not the end of
  // the turn compared with itself.
  assert.equal(ext.kernelSnapshotAtStart?.turn, 0);
  assert.deepEqual(ext.kernelSnapshotsAfterProgression?.map(s => s.turn), [1, 2]);
  assert.notDeepEqual(ext.kernelSnapshotsAfterProgression?.[1].state, ext.kernelSnapshotsPerTurn?.[1].state);
});

test('a tampered snapshot gives matches false and names the first path that differs', async () => {
  const { artifact } = await stubbedRun();
  assert.equal(
    extensionsOf(artifact).kernelSnapshotsAfterProgression?.length, 2,
    'the run saves the state right after each between-turn step',
  );
  const wm = WorldModel.fromScenario(marsScenario);

  // A recorded step's result changed: the fresh step gives the value the run had.
  const afterStep = stored(artifact);
  const recordedAfter = extensionsOf(afterStep).kernelSnapshotsAfterProgression!;
  const morale = recordedAfter[1].state.metrics.morale;
  recordedAfter[1].state.metrics.morale = 0.123456789;
  const changedResult = await wm.replay(afterStep);
  assert.equal(changedResult.matches, false);
  assert.equal(
    changedResult.divergence,
    `/scenarioExtensions/kernelSnapshotsAfterProgression/1/state/metrics/morale (0.123456789 vs ${JSON.stringify(morale)})`,
  );

  // The state a step started from changed: turn 2's step starts from the end
  // of turn 1, and carries the change into its result.
  const startOfStep = stored(artifact);
  const endOfTurn1 = extensionsOf(startOfStep).kernelSnapshotsPerTurn![0];
  const name = endOfTurn1.state.agents[0].core.name;
  endOfTurn1.state.agents[0].core.name = 'Tampered';
  const changedStart = await wm.replay(startOfStep);
  assert.equal(changedStart.matches, false);
  assert.equal(
    changedStart.divergence,
    `/scenarioExtensions/kernelSnapshotsAfterProgression/1/state/agents/0/core/name (${JSON.stringify(name)} vs "Tampered")`,
  );
});

test('a run saved before the turn loop kept the state after each between-turn step gets the cannot-verify answer, never a match or a mismatch', async () => {
  // Trimmed from run_11b08c71 on paracosm.agentos.sh, 2 Nov 2026: two
  // end-of-turn snapshots and nothing else replay could start a step from.
  const saved = JSON.parse(readFileSync(resolve(here, '../../fixtures/atlas-lab-run-2026-11-02.json'), 'utf-8')) as RunArtifact;
  const snaps = extensionsOf(saved).kernelSnapshotsPerTurn!;
  const bench = (s: KernelSnapshot) => (s.state.metrics as Record<string, number>).alignmentBench;
  assert.deepEqual(snaps.map(bench), [0.73, 0.71], 'turn 2 moved alignmentBench, which no between-turn step writes');

  const atlasLab = loadDiskCustomScenarios(resolve(here, '../../../scenarios')).get('atlas-lab')?.scenario as ScenarioPackage | undefined;
  assert.ok(atlasLab, 'scenarios/ holds atlas-lab');
  await assert.rejects(
    () => WorldModel.fromScenario(atlasLab).replay(saved),
    (err: unknown) => err instanceof WorldModelReplayError
      && /cannot verify this run/.test(err.message)
      && /kernelSnapshotsAfterProgression/.test(err.message),
  );
});
