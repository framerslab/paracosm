import test from 'node:test';
import assert from 'node:assert/strict';
import * as runRecord from './run-record.js';
import type { RunArtifact } from '../../engine/schema/index.js';

test('the public artifact copy keeps other fields and leaves its input unchanged', () => {
  const artifact = {
    metadata: { runId: 'copy-test' },
    scenarioExtensions: { outputPath: '/tmp/run-copy.json', kernelSnapshotsPerTurn: [{ turn: 1 }], label: 'kept' },
  } as unknown as RunArtifact;
  const before = structuredClone(artifact);
  const project = (runRecord as unknown as { withoutOutputPath?: (value: RunArtifact) => RunArtifact }).withoutOutputPath;
  assert.equal(typeof project, 'function', 'the shared artifact projection is available');
  const result = project!(artifact);
  assert.notEqual(result, artifact);
  assert.notEqual(result.scenarioExtensions, artifact.scenarioExtensions);
  assert.deepEqual(result, {
    metadata: { runId: 'copy-test' },
    scenarioExtensions: { kernelSnapshotsPerTurn: [{ turn: 1 }], label: 'kept' },
  });
  assert.deepEqual(artifact, before);
});
