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


test('WorldModel.intervene with file output disabled leaves the directory empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paracosm-intervene-output-'));
  const events: unknown[] = [];
  try {
    const { artifact, log } = await runMarsWithStubModel({
      outputDir: dir, writeOutputFile: false, intervene: true, onEvent: event => events.push(event),
    });
    assert.ok(artifact.metadata.runId);
    assert.equal(artifact.subject?.id, 'sample-subject');
    assert.equal(artifact.intervention?.id, 'sample-change');
    assert.ok(log.decisions.length > 0, 'the real turn loop calls the stub model');
    assert.equal(artifact.scenarioExtensions?.outputPath, undefined);
    assert.deepEqual(readdirSync(dir), []);
    assert.ok(events.length > 0);
    assert.doesNotMatch(JSON.stringify(events), /sample-subject|Sample subject|sample-change|Sample change/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
