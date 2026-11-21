/**
 * The run's size, the number of leaders a run takes: what a typed number
 * becomes, how the size reads from and writes to the page's address, and
 * when the size is the visitor's to choose.
 *
 * A run takes 2 to 300 leaders. A whole number out of range is refused and
 * goes to the nearest bound; anything that is not a whole number is refused
 * and keeps the last good size. An address that holds no usable size reads
 * as a pair, with no error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_SIZE,
  RUN_SIZE_BOUNDS,
  clampSize,
  searchWithSize,
  sizeFromSearch,
  sizeMode,
  stepSize,
} from '../../../src/dashboard/src/components/quickstart/first-screen/runSize.helpers.js';

test('the bounds: a run takes 2 to 300 leaders, and a free run is a pair', () => {
  assert.deepEqual({ ...RUN_SIZE_BOUNDS }, { min: 2, max: 300 });
  assert.equal(FREE_SIZE, 2);
});

test('clampSize: a number out of range is refused and goes to the nearest bound', () => {
  assert.deepEqual(clampSize('1'), { value: 2, refused: true });
  assert.deepEqual(clampSize('0'), { value: 2, refused: true });
  assert.deepEqual(clampSize('400'), { value: 300, refused: true });
  assert.deepEqual(clampSize('99999999999999999999999'), { value: 300, refused: true });
});

test('clampSize: a whole number in range is taken', () => {
  assert.deepEqual(clampSize('24'), { value: 24, refused: false });
  assert.deepEqual(clampSize('2'), { value: 2, refused: false });
  assert.deepEqual(clampSize('300'), { value: 300, refused: false });
  assert.deepEqual(clampSize(' 12 '), { value: 12, refused: false });
});

test('clampSize: what is not a whole number is refused and keeps the last good size', () => {
  assert.deepEqual(clampSize('2.5'), { value: 2, refused: true });
  assert.deepEqual(clampSize(''), { value: 2, refused: true });
  assert.deepEqual(clampSize('2.5', RUN_SIZE_BOUNDS, 24), { value: 24, refused: true });
  assert.deepEqual(clampSize('', RUN_SIZE_BOUNDS, 24), { value: 24, refused: true });
  for (const raw of ['many', '-3', '1e2', '12 leaders', '٣']) {
    assert.deepEqual(clampSize(raw, RUN_SIZE_BOUNDS, 7), { value: 7, refused: true }, raw);
  }
});

test('clampSize: other bounds', () => {
  const bounds = { min: 3, max: 120 };
  assert.deepEqual(clampSize('2', bounds, 3), { value: 3, refused: true });
  assert.deepEqual(clampSize('121', bounds, 3), { value: 120, refused: true });
  assert.deepEqual(clampSize('120', bounds, 3), { value: 120, refused: false });
});

test('stepSize: the keys move the size and stop at the bounds', () => {
  assert.equal(stepSize(2, 1), 3);
  assert.equal(stepSize(3, 10), 13);
  assert.equal(stepSize(2, -1), 2);
  assert.equal(stepSize(295, 10), 300);
  assert.equal(stepSize(300, 1), 300);
  assert.equal(stepSize(12, -10), 2);
});

test('the size in the address: read from ?size=, a pair when it holds none or one that cannot be', () => {
  assert.equal(sizeFromSearch('?size=24'), 24);
  assert.equal(sizeFromSearch('?tab=quickstart&size=300'), 300);
  assert.equal(sizeFromSearch(''), 2);
  assert.equal(sizeFromSearch('?tab=sim'), 2);
  for (const bad of ['?size=1', '?size=999', '?size=2.5', '?size=many', '?size=', '?size=-4']) {
    assert.equal(sizeFromSearch(bad), 2, bad);
  }
});

test('the size in the address: written beside what the address already holds, and left out at a pair', () => {
  assert.equal(searchWithSize('', 24), '?size=24');
  assert.equal(searchWithSize('?tab=quickstart', 300), '?tab=quickstart&size=300');
  assert.equal(searchWithSize('?size=24&replay=abc', 12), '?size=12&replay=abc');
  assert.equal(searchWithSize('?size=24', 2), '');
  assert.equal(searchWithSize('?size=24&tab=quickstart', 2), '?tab=quickstart');
  assert.equal(sizeFromSearch(searchWithSize('?tab=quickstart', 57)), 57);
});

test('sizeMode: a pair on the host\'s keys, a control on the visitor\'s key or a server of its own, once the server has answered', () => {
  // The hosted demo with no key: a pair, whatever else is known.
  assert.equal(sizeMode({ payer: 'host', adminConfig: 'ready', rateLimit: 'ready' }), 'pair');
  assert.equal(sizeMode({ payer: 'host', adminConfig: 'ready', rateLimit: 'loading' }), 'pair');
  // The visitor's own key: the control, once both answers are in; one that failed still counts as answered.
  assert.equal(sizeMode({ payer: 'own', adminConfig: 'loading', rateLimit: 'loading' }), 'waiting');
  assert.equal(sizeMode({ payer: 'own', adminConfig: 'ready', rateLimit: 'loading' }), 'waiting');
  assert.equal(sizeMode({ payer: 'own', adminConfig: 'ready', rateLimit: 'ready' }), 'control');
  assert.equal(sizeMode({ payer: 'own', adminConfig: 'error', rateLimit: 'error' }), 'control');
  // No key: the control only on a server that has said it is not the hosted demo.
  assert.equal(sizeMode({ payer: 'server', adminConfig: 'loading', rateLimit: 'ready' }), 'pair');
  assert.equal(sizeMode({ payer: 'server', adminConfig: 'error', rateLimit: 'ready' }), 'pair');
  assert.equal(sizeMode({ payer: 'server', adminConfig: 'ready', rateLimit: 'loading' }), 'waiting');
  assert.equal(sizeMode({ payer: 'server', adminConfig: 'ready', rateLimit: 'unlimited' }), 'control');
});
