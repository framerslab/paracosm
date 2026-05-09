import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStudioInput } from './parseStudioInput.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../../../../../tests/fixtures');
const turnLoopText = readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-turn-loop.json'), 'utf-8');
const batchText = readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-batch.json'), 'utf-8');
const bundleText = readFileSync(resolve(fixtureDir, 'runArtifact-v0.8-bundle.json'), 'utf-8');

test('parseStudioInput: turn-loop fixture parses as single', () => {
  const out = parseStudioInput(turnLoopText);
  assert.equal(out.kind, 'single');
  if (out.kind === 'single') {
    assert.equal(out.artifact.metadata.runId, 'run_studio_fixture_turn_loop');
    assert.equal(out.artifact.metadata.mode, 'turn-loop');
  }
});

test('parseStudioInput: batch fixture parses as single (mode=batch-trajectory)', () => {
  const out = parseStudioInput(batchText);
  assert.equal(out.kind, 'single');
  if (out.kind === 'single') {
    assert.equal(out.artifact.metadata.mode, 'batch-trajectory');
  }
});

test('parseStudioInput: bundle (array) parses as bundle with 2 artifacts', () => {
  const out = parseStudioInput(bundleText);
  assert.equal(out.kind, 'bundle');
  if (out.kind === 'bundle') {
    assert.equal(out.artifacts.length, 2);
    assert.equal(out.artifacts[0].metadata.runId, 'run_studio_fixture_bundle_a');
  }
});

test('parseStudioInput: bundle ({bundleId, artifacts}) keeps bundleId', () => {
  const wrapped = JSON.stringify({ bundleId: 'bundle_123', artifacts: JSON.parse(bundleText) });
  const out = parseStudioInput(wrapped);
  assert.equal(out.kind, 'bundle');
  if (out.kind === 'bundle') {
    assert.equal(out.bundleId, 'bundle_123');
    assert.equal(out.artifacts.length, 2);
  }
});

test('parseStudioInput: invalid JSON yields error with parse hint', () => {
  const out = parseStudioInput('not json {[');
  assert.equal(out.kind, 'error');
  if (out.kind === 'error') {
    assert.match(out.message, /not valid JSON/i);
  }
});

test('parseStudioInput: object missing metadata yields error', () => {
  const out = parseStudioInput(JSON.stringify({ trajectory: { timepoints: [] } }));
  assert.equal(out.kind, 'error');
});

test('parseStudioInput: pre-RunArtifactSchema legacy shape yields a Zod error', () => {
  // Very early paracosm artifacts (pre-RunArtifactSchema) lacked the
  // universal `metadata.scenario` envelope. Zod rejects them with a
  // helpful "metadata: <issue>" path.
  const legacy = JSON.stringify({
    metadata: { runId: 'r1' },
    leader: { name: 'Aria', archetype: 'The Visionary' },
  });
  const out = parseStudioInput(legacy);
  assert.equal(out.kind, 'error');
  if (out.kind === 'error') {
    assert.match(out.message, /metadata|RunArtifact/i);
  }
});

test('parseStudioInput: empty bundle array yields error', () => {
  const out = parseStudioInput('[]');
  assert.equal(out.kind, 'error');
});

test('parseStudioInput: 51-element bundle yields error', () => {
  const big = JSON.stringify(Array.from({ length: 51 }, () => JSON.parse(turnLoopText)));
  const out = parseStudioInput(big);
  assert.equal(out.kind, 'error');
  if (out.kind === 'error') {
    assert.match(out.message, /50/);
  }
});
