import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlareQueue,
  pushFlare,
  tickFlares,
  activeFlares,
  MAX_ACTIVE_FLARES,
} from './flareQueue.js';

test('flareQueue: push adds a flare with correct initial age', () => {
  const q = createFlareQueue();
  pushFlare(q, { kind: 'birth', x: 10, y: 10, totalFrames: 30 });
  const active = activeFlares(q);
  assert.equal(active.length, 1);
  assert.equal(active[0].age, 0);
  assert.equal(active[0].kind, 'birth');
});

test('flareQueue: tick advances ages and expires after totalFrames', () => {
  const q = createFlareQueue();
  pushFlare(q, { kind: 'death', x: 10, y: 10, totalFrames: 5 });
  for (let i = 0; i < 6; i++) tickFlares(q);
  assert.equal(activeFlares(q).length, 0, 'expired after totalFrames ticks');
});

test('flareQueue: returns flares with progress 0..1 monotonically increasing', () => {
  const q = createFlareQueue();
  pushFlare(q, { kind: 'birth', x: 10, y: 10, totalFrames: 4 });
  const progressions: number[] = [];
  for (let i = 0; i < 5; i++) {
    const active = activeFlares(q);
    if (active.length > 0) progressions.push(active[0].progress);
    tickFlares(q);
  }
  assert.deepEqual(progressions, [0, 0.25, 0.5, 0.75]);
});

test('flareQueue: capacity cap — 31st push evicts oldest', () => {
  const q = createFlareQueue();
  for (let i = 0; i < MAX_ACTIVE_FLARES + 5; i++) {
    pushFlare(q, { kind: 'birth', x: i, y: 0, totalFrames: 100 });
  }
  const active = activeFlares(q);
  assert.equal(active.length, MAX_ACTIVE_FLARES, 'capped at MAX_ACTIVE_FLARES');
  const minX = Math.min(...active.map(f => f.x));
  assert.ok(minX >= 5, `evicted oldest flares (minX=${minX})`);
});

test('flareQueue: multiple concurrent flares tick independently', () => {
  const q = createFlareQueue();
  pushFlare(q, { kind: 'birth', x: 10, y: 10, totalFrames: 3 });
  tickFlares(q);
  pushFlare(q, { kind: 'death', x: 20, y: 20, totalFrames: 6 });
  tickFlares(q);
  tickFlares(q);
  tickFlares(q);
  const active = activeFlares(q);
  assert.equal(active.length, 1, 'birth expired; death still active');
  assert.equal(active[0].kind, 'death');
});
