/**
 * Pure-logic tests for share-URL helpers. URL construction and
 * sim_saved event scanning live here so they run under node:test
 * without a browser shim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReplayShareUrl,
  findLatestSavedSessionId,
} from './shareUrl.helpers.js';
import type { SimEvent } from './useSSE';

// -- buildReplayShareUrl --------------------------------------------------

test('buildReplayShareUrl: defaults to viz tab', () => {
  const url = buildReplayShareUrl('https://paracosm.agentos.sh', 'abc123');
  assert.equal(url, 'https://paracosm.agentos.sh/sim?replay=abc123&tab=viz');
});

test('buildReplayShareUrl: honors explicit sim tab', () => {
  const url = buildReplayShareUrl('https://paracosm.agentos.sh', 'abc123', 'sim');
  assert.equal(url, 'https://paracosm.agentos.sh/sim?replay=abc123&tab=sim');
});

test('buildReplayShareUrl: honors reports tab', () => {
  const url = buildReplayShareUrl('https://paracosm.agentos.sh', 'abc123', 'reports');
  assert.equal(url, 'https://paracosm.agentos.sh/sim?replay=abc123&tab=reports');
});

test('buildReplayShareUrl: handles origin with trailing slash', () => {
  const url = buildReplayShareUrl('https://paracosm.agentos.sh/', 'abc123');
  assert.equal(url, 'https://paracosm.agentos.sh/sim?replay=abc123&tab=viz');
});

test('buildReplayShareUrl: encodes session id with special chars', () => {
  const url = buildReplayShareUrl('https://paracosm.agentos.sh', 'id with spaces');
  assert.match(url, /replay=id\+with\+spaces|replay=id%20with%20spaces/);
});

test('buildReplayShareUrl: works for localhost dev origin', () => {
  const url = buildReplayShareUrl('http://localhost:3456', 'abc123');
  assert.equal(url, 'http://localhost:3456/sim?replay=abc123&tab=viz');
});

// -- findLatestSavedSessionId --------------------------------------------

function ev(type: string, data: Record<string, unknown> = {}): SimEvent {
  return { type, leader: '', data } as SimEvent;
}

test('findLatestSavedSessionId: returns id from sim_saved with status=saved', () => {
  const events = [
    ev('turn_start'),
    ev('sim_saved', { status: 'saved', id: 'sess_abc' }),
  ];
  assert.equal(findLatestSavedSessionId(events), 'sess_abc');
});

test('findLatestSavedSessionId: returns null when no sim_saved event', () => {
  const events = [ev('turn_start'), ev('decision')];
  assert.equal(findLatestSavedSessionId(events), null);
});

test('findLatestSavedSessionId: returns null when sim_saved status is failed', () => {
  const events = [ev('sim_saved', { status: 'failed', error: 'disk full' })];
  assert.equal(findLatestSavedSessionId(events), null);
});

test('findLatestSavedSessionId: returns null when sim_saved status is skipped', () => {
  const events = [ev('sim_saved', { status: 'skipped', reason: 'below_min_turns' })];
  assert.equal(findLatestSavedSessionId(events), null);
});

test('findLatestSavedSessionId: returns newest id when multiple saves present', () => {
  const events = [
    ev('sim_saved', { status: 'saved', id: 'sess_old' }),
    ev('turn_start'),
    ev('sim_saved', { status: 'saved', id: 'sess_new' }),
  ];
  assert.equal(findLatestSavedSessionId(events), 'sess_new');
});

test('findLatestSavedSessionId: ignores sim_saved without id', () => {
  const events = [ev('sim_saved', { status: 'saved' })];
  assert.equal(findLatestSavedSessionId(events), null);
});

test('findLatestSavedSessionId: ignores sim_saved with non-string id', () => {
  const events = [ev('sim_saved', { status: 'saved', id: 12345 })];
  assert.equal(findLatestSavedSessionId(events), null);
});

test('findLatestSavedSessionId: ignores sim_saved with empty string id', () => {
  const events = [ev('sim_saved', { status: 'saved', id: '' })];
  assert.equal(findLatestSavedSessionId(events), null);
});

test('findLatestSavedSessionId: empty event list -> null', () => {
  assert.equal(findLatestSavedSessionId([]), null);
});

test('findLatestSavedSessionId: skips failed save and returns prior saved id', () => {
  const events = [
    ev('sim_saved', { status: 'saved', id: 'sess_first' }),
    ev('sim_saved', { status: 'failed', error: 'retry' }),
  ];
  // Newest-wins iteration: failed save short-circuits the continue,
  // then the earlier saved entry is returned.
  assert.equal(findLatestSavedSessionId(events), 'sess_first');
});
