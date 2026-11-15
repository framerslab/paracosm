import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMarsWithStubModel } from './helpers/stub-model-mars-run.js';

test('a run with file output disabled returns its artifact and leaves the directory empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-no-output-'));
  try {
    const { artifact } = await runMarsWithStubModel({ outputDir: dir, writeOutputFile: false });
    assert.ok(artifact.metadata.runId);
    assert.equal(artifact.scenarioExtensions?.outputPath, undefined);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a run writes its output file by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-default-output-'));
  try {
    const { artifact } = await runMarsWithStubModel({ outputDir: dir });
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    assert.equal(artifact.scenarioExtensions?.outputPath, join(dir, files[0]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
