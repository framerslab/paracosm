import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeBucket } from '../../../analytics/first-screen-events.js';
import { sendEvent } from './send';

type Purpose = 'count' | 'measure' | 'record';

function browser(choices: Purpose[] | null) {
  const posts: unknown[][] = [];
  const measures: unknown[][] = [];
  const recordings: unknown[][] = [];
  const target = {
    location: new URL('https://example.test/sim/private-marker?typed-marker#fragment-marker'),
    document: { title: 'private-title', referrer: 'https://example.test/private-referrer' },
    paracosmConsent: choices === null ? undefined : { allows: (purpose: Purpose) => choices.includes(purpose) },
    fetch: (...args: unknown[]) => { posts.push(args); return Promise.resolve(); },
    gtag: (...args: unknown[]) => { measures.push(args); },
    clarity: (...args: unknown[]) => { recordings.push(args); },
  };
  return { target, window: target as unknown as Window, posts, measures, recordings };
}

const view = { state: 'ready', entry: 'direct' };
const context = {
  page_location: 'https://example.test/sim',
  page_title: 'Simulate one scenario side by side under different leaders | Paracosm',
  page_referrer: '',
};

test('only whole supported sizes are bucketed at the contract boundaries', () => {
  const cases = [
    [-1, null], [1, null], [2, '2'], [3, '3_8'], [8, '3_8'], [9, '9_24'],
    [24, '9_24'], [25, '25_100'], [100, '25_100'], [101, '101_300'],
    [300, '101_300'], [301, null], [2.5, null], [NaN, null], [Infinity, null],
  ] as const;
  for (const [size, bucket] of cases) assert.equal(sizeBucket(size), bucket, String(size));
});

test('each consent choice is checked on each send, with fixed data at each destination', () => {
  const choices: Purpose[] = ['count'];
  const page = browser(choices);
  sendEvent('qs_view', view, page.window);
  assert.deepEqual(page.posts, [['/api/event', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    keepalive: true,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    body: JSON.stringify({ n: 'qs_view', u: '/sim', p: view }),
  }]]);
  assert.deepEqual(page.measures, []);
  assert.deepEqual(page.recordings, []);

  choices.splice(0, 1, 'measure');
  sendEvent('qs_view', view, page.window);
  assert.deepEqual(page.measures, [['event', 'qs_view', { ...view, ...context }]]);
  assert.equal(page.posts.length, 1);
  assert.deepEqual(page.recordings, []);

  choices.splice(0, 1, 'record');
  sendEvent('qs_view', view, page.window);
  assert.deepEqual(page.recordings, [['event', 'qs_view']]);
  assert.equal(page.posts.length, 1);
  assert.equal(page.measures.length, 1);
});

test('Clarity marks only the six listed events and receives their names alone', () => {
  const page = browser(['record']);
  sendEvent('qs_view', view, page.window);
  sendEvent('qs_start', { picked: 'no', key: 'server', size: '101_300' }, page.window);
  sendEvent('run_started', { key: 'own' }, page.window);
  sendEvent('run_failed', { reason: 'key_refused' }, page.window);
  sendEvent('qs_no_run_left_view', {}, page.window);
  sendEvent('qs_no_run_left_action', { action: 'add_key' }, page.window);
  sendEvent('qs_how_open', {}, page.window);
  sendEvent('qs_pair_switch', { to: '2' }, page.window);
  sendEvent('tab_change', { to: 'about' }, page.window);
  assert.deepEqual(page.recordings, [
    'qs_view', 'qs_start', 'run_started', 'run_failed', 'qs_no_run_left_view', 'qs_no_run_left_action',
  ].map(name => ['event', name]));
  assert.deepEqual([page.posts, page.measures], [[], []]);
});

test('an invalid name or any invalid field drops the event before any delivery', () => {
  const page = browser(['count', 'measure', 'record']);
  const badFields: unknown[] = [
    {}, { ...view, visitor: 'marker' }, { ...view, state: 'marker' }, { ...view, state: 2 },
    { ...view, constructor: 'marker' }, Object.create(view), [view], null,
    { ...view, [Symbol('extra')]: 'marker' },
  ];
  for (const fields of badFields) {
    sendEvent('qs_view', fields as Record<string, string>, page.window);
  }
  sendEvent('constructor' as Parameters<typeof sendEvent>[0], {}, page.window);
  assert.deepEqual([page.posts, page.measures, page.recordings], [[], [], []]);
});

test('an absent or throwing consent manager sends nothing', () => {
  const page = browser(null);
  sendEvent('qs_view', view, page.window);
  page.target.paracosmConsent = { allows: () => { throw new Error('unreadable'); } };
  sendEvent('qs_view', view, page.window);
  assert.deepEqual([page.posts, page.measures, page.recordings], [[], [], []]);
});

test('delivery errors leave the action and the other destinations working', async () => {
  const page = browser(['count', 'measure', 'record']);
  const rejected = Promise.reject(new Error('offline'));
  page.target.fetch = () => rejected;
  page.target.gtag = () => { throw new Error('vendor unavailable'); };
  sendEvent('qs_view', view, page.window);
  assert.deepEqual(page.recordings, [['event', 'qs_view']]);
  await new Promise<void>(resolve => setImmediate(resolve));
});

test('Watch disclosures measure only with the fixed dashboard context', () => {
  for (const choices of [null, [], ['count'], ['record'], ['measure'], ['count', 'measure', 'record']] as Array<Purpose[] | null>) {
    const page = browser(choices);
    sendEvent('watch_fold', { fold: 'crisis' }, page.window);
    sendEvent('watch_fold', { fold: 'reasoning', detail: 'private' }, page.window);
    sendEvent('watch_fold', { fold: 'private' }, page.window);
    assert.deepEqual(page.posts, []);
    assert.deepEqual(page.recordings, []);
    assert.deepEqual(page.measures, choices?.includes('measure') ? [['event', 'watch_fold', { fold: 'crisis', ...context }]] : []);
  }
});

test('Watch playback measures explicit actions with the fixed vocabulary', () => {
  for (const choices of [null, ['count', 'record'], ['measure'], ['count', 'measure', 'record']] as Array<Purpose[] | null>) {
    const page = browser(choices);
    sendEvent('watch_play', { key: 'speed_half' }, page.window);
    sendEvent('watch_turn_pick', {}, page.window);
    sendEvent('watch_turn_pick', { turn: 3 }, page.window);
    sendEvent('watch_play', { key: 'auto' }, page.window);
    assert.deepEqual(page.posts, []);
    assert.deepEqual(page.recordings, []);
    assert.deepEqual(page.measures, choices?.includes('measure')
      ? [['event', 'watch_play', { key: 'speed_half', ...context }], ['event', 'watch_turn_pick', context]]
      : []);
  }
});

test('full prompt opens reach only the allowed destinations with the fixed side', () => {
  const name = 'qs_prompt_open';
  const choices: Purpose[] = [];
  const page = browser(choices);
  sendEvent(name, { side: 'right' }, page.window);
  assert.deepEqual([page.posts, page.measures, page.recordings], [[], [], []]);

  choices.push('count');
  sendEvent(name, { side: 'right' }, page.window);
  assert.equal(page.posts.length, 1);
  assert.equal((page.posts[0][1] as RequestInit).body, JSON.stringify({ n: name, u: '/sim', p: { side: 'right' } }));
  assert.deepEqual([page.measures, page.recordings], [[], []]);

  choices.splice(0, 1, 'measure');
  sendEvent(name, { side: 'left' }, page.window);
  assert.deepEqual(page.measures, [['event', name, { side: 'left', ...context }]]);
  assert.equal(page.posts.length, 1);
  assert.deepEqual(page.recordings, []);

  choices.splice(0, 1, 'record');
  sendEvent(name, { side: 'left' }, page.window);
  assert.deepEqual(page.recordings, [['event', name]]);
  choices.push('count', 'measure');
  sendEvent(name, { side: 'right', name: 'marker' }, page.window);
  sendEvent(name, { side: 'marker' }, page.window);
  assert.deepEqual([page.posts.length, page.measures.length, page.recordings.length], [1, 1, 1]);
});
