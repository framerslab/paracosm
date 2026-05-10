import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRunsByBundle } from './groupRunsByBundle.js';
import type { RunRecord } from '../../../../server/services/run-record.js';

const r = (overrides: Partial<RunRecord>): RunRecord => ({
  runId: 'x', createdAt: '2026-04-26T00:00:00Z', scenarioId: 's', scenarioVersion: '1',
  actorConfigHash: 'h', economicsProfile: 'demo', sourceMode: 'hosted_demo', createdBy: 'anonymous',
  ...overrides,
});

test('runs without bundleId render as solo entries', () => {
  const out = groupRunsByBundle([r({ runId: 'a' }), r({ runId: 'b' })]);
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, 'solo');
  assert.equal(out[1].kind, 'solo');
});

test('runs with the same bundleId collapse into one bundle entry', () => {
  const out = groupRunsByBundle([
    r({ runId: 'a', bundleId: 'b1' }),
    r({ runId: 'b', bundleId: 'b1' }),
    r({ runId: 'c', bundleId: 'b1' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'bundle');
  if (out[0].kind === 'bundle') {
    assert.equal(out[0].bundleId, 'b1');
    assert.equal(out[0].members.length, 3);
  }
});

test('mixed solo + bundles preserve createdAt ordering by entry', () => {
  const out = groupRunsByBundle([
    r({ runId: 'solo1', createdAt: '2026-04-26T00:00:00Z' }),
    r({ runId: 'b1m1', bundleId: 'b1', createdAt: '2026-04-26T00:00:01Z' }),
    r({ runId: 'b1m2', bundleId: 'b1', createdAt: '2026-04-26T00:00:02Z' }),
    r({ runId: 'solo2', createdAt: '2026-04-26T00:00:03Z' }),
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0].kind === 'solo' && out[0].record.runId, 'solo1');
  assert.equal(out[1].kind === 'bundle' && out[1].bundleId, 'b1');
  assert.equal(out[2].kind === 'solo' && out[2].record.runId, 'solo2');
});

test('bundle entry exposes scenarioId, totalCostUSD, memberCount', () => {
  const out = groupRunsByBundle([
    r({ runId: 'a', bundleId: 'b1', costUSD: 0.30, scenarioId: 'mars-genesis' }),
    r({ runId: 'b', bundleId: 'b1', costUSD: 0.20, scenarioId: 'mars-genesis' }),
  ]);
  assert.equal(out[0].kind, 'bundle');
  if (out[0].kind === 'bundle') {
    assert.equal(out[0].scenarioId, 'mars-genesis');
    assert.equal(out[0].totalCostUSD, 0.50);
    assert.equal(out[0].memberCount, 2);
  }
});

test('bundle members sorted by createdAt ascending', () => {
  const out = groupRunsByBundle([
    r({ runId: 'a', bundleId: 'b1', createdAt: '2026-04-26T00:00:02Z' }),
    r({ runId: 'b', bundleId: 'b1', createdAt: '2026-04-26T00:00:00Z' }),
    r({ runId: 'c', bundleId: 'b1', createdAt: '2026-04-26T00:00:01Z' }),
  ]);
  assert.equal(out[0].kind, 'bundle');
  if (out[0].kind === 'bundle') {
    assert.deepEqual(out[0].members.map(m => m.runId), ['b', 'c', 'a']);
  }
});
