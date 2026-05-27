import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSeedUrl,
  validateSeedText,
  computeMedianDeltas,
  buildQuickstartShareUrl,
} from './QuickstartView.helpers.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

function artifact(finalState: RunArtifact['finalState']): RunArtifact {
  return {
    metadata: { runId: 'r', scenario: { id: 's', name: 'S' }, mode: 'turn-loop', startedAt: '' },
    finalState,
  } as unknown as RunArtifact;
}

test('validateSeedUrl: accepts https', () => {
  const r = validateSeedUrl('https://example.com/article');
  assert.equal(r.ok, true);
});

test('validateSeedUrl: rejects non-URL', () => {
  const r = validateSeedUrl('not a url') as { ok: false; error: string };
  assert.equal(r.ok, false);
  assert.match(r.error, /valid URL/);
});

test('validateSeedUrl: rejects ftp scheme', () => {
  const r = validateSeedUrl('ftp://example.com/file') as { ok: false; error: string };
  assert.equal(r.ok, false);
});

test('validateSeedUrl: trims whitespace', () => {
  const r = validateSeedUrl('  https://example.com  ');
  assert.equal(r.ok, true);
});

test('validateSeedUrl: rejects > 2048 chars', () => {
  const r = validateSeedUrl('https://example.com/' + 'x'.repeat(2100)) as { ok: false; error: string };
  assert.equal(r.ok, false);
  assert.match(r.error, /2048/);
});

test('validateSeedText: empty rejected', () => {
  assert.deepEqual(validateSeedText(''), { ok: false, reason: 'empty' });
});

test('validateSeedText: too-short rejected', () => {
  assert.deepEqual(validateSeedText('hi'), { ok: false, reason: 'too-short' });
});

test('validateSeedText: too-long rejected', () => {
  assert.deepEqual(validateSeedText('x'.repeat(100_000)), { ok: false, reason: 'too-long' });
});

test('validateSeedText: in-range accepted', () => {
  assert.deepEqual(validateSeedText('x'.repeat(500)), { ok: true });
});

test('computeMedianDeltas: numeric divergence from peer median sorts first', () => {
  const a = artifact({ metrics: { population: 120 } } as never);
  const b = artifact({ metrics: { population: 100 } } as never);
  const c = artifact({ metrics: { population: 80 } } as never);
  const deltas = computeMedianDeltas(a, [b, c]);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].key, 'population');
  assert.equal(deltas[0].direction, 'up');
  assert.equal(deltas[0].delta, 30);
});

test('computeMedianDeltas: string status changed vs peers', () => {
  const a = artifact({ statuses: { phase: 'alpha' } } as never);
  const b = artifact({ statuses: { phase: 'beta' } } as never);
  const deltas = computeMedianDeltas(a, [b]);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].direction, 'changed');
});

test('computeMedianDeltas: empty peers returns empty', () => {
  const a = artifact({ metrics: { population: 100 } } as never);
  assert.deepEqual(computeMedianDeltas(a, []), []);
});

test('computeMedianDeltas: identical values omitted', () => {
  const a = artifact({ metrics: { population: 100 } } as never);
  const b = artifact({ metrics: { population: 100 } } as never);
  assert.deepEqual(computeMedianDeltas(a, [b]), []);
});

test('buildQuickstartShareUrl: defaults to viz tab', () => {
  const url = buildQuickstartShareUrl('https://paracosm.agentos.sh', 'abc123');
  assert.equal(url, 'https://paracosm.agentos.sh/sim?replay=abc123&tab=viz');
});

test('buildQuickstartShareUrl: honors explicit quickstart tab', () => {
  const url = buildQuickstartShareUrl('https://paracosm.agentos.sh', 'abc123', 'quickstart');
  assert.equal(url, 'https://paracosm.agentos.sh/sim?replay=abc123&tab=quickstart');
});
