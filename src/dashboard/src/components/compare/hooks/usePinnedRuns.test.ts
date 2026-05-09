import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPin, applyUnpin, applyTogglePin, PIN_LIMIT } from './usePinnedRuns.js';

test('applyPin starts from empty + adds id', () => {
  assert.deepEqual(applyPin([], 'r1'), ['r1']);
});

test('applyPin same id twice does not duplicate', () => {
  assert.deepEqual(applyPin(['r1'], 'r1'), ['r1']);
});

test('applyUnpin removes id', () => {
  assert.deepEqual(applyUnpin(['r1', 'r2'], 'r1'), ['r2']);
});

test('applyUnpin no-op when id not present', () => {
  assert.deepEqual(applyUnpin(['r1'], 'r2'), ['r1']);
});

test('applyPin LRU evicts oldest when at limit', () => {
  const after3 = applyPin(applyPin(applyPin([], 'r1'), 'r2'), 'r3');
  assert.deepEqual(after3, ['r1', 'r2', 'r3']);
  const after4 = applyPin(after3, 'r4');
  assert.deepEqual(after4, ['r2', 'r3', 'r4']);
});

test('applyPin honors PIN_LIMIT constant', () => {
  assert.equal(PIN_LIMIT, 3);
});

test('applyTogglePin pins when not pinned', () => {
  assert.deepEqual(applyTogglePin([], 'r1'), ['r1']);
});

test('applyTogglePin unpins when pinned', () => {
  assert.deepEqual(applyTogglePin(['r1', 'r2'], 'r1'), ['r2']);
});

test('applyPin with custom limit', () => {
  assert.deepEqual(applyPin(['r1', 'r2'], 'r3', 2), ['r2', 'r3']);
});

test('applyTogglePin honors LRU when toggling on at limit', () => {
  const filled = ['r1', 'r2', 'r3'];
  assert.deepEqual(applyTogglePin(filled, 'r4'), ['r2', 'r3', 'r4']);
});
