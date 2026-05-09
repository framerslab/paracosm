import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExplicit,
  shouldShowCacheRow,
  cacheExpandedBody,
  buildReplayHref,
} from './LoadMenu.helpers.js';

test('formatExplicit renders MMM D · HH:mm in local TZ', () => {
  const ts = new Date(2026, 3, 18, 14, 32, 0).getTime();
  const out = formatExplicit(ts);
  assert.match(out, /^[A-Z][a-z]{2} \d{1,2} · \d{2}:\d{2}$/);
});

test('shouldShowCacheRow returns true for every status so the user gets a hint on error/unavailable', () => {
  assert.equal(shouldShowCacheRow('loading'), true);
  assert.equal(shouldShowCacheRow('ready'), true);
  assert.equal(shouldShowCacheRow('unavailable'), true);
  assert.equal(shouldShowCacheRow('error'), true);
});

test('cacheExpandedBody picks the right branch per state', () => {
  assert.equal(cacheExpandedBody('loading', []), 'loading');
  assert.equal(cacheExpandedBody('ready', []), 'empty');
  assert.equal(
    cacheExpandedBody('ready', [{ id: 'a', createdAt: 0, eventCount: 0 }]),
    'cards',
  );
});

test('buildReplayHref appends ?replay=<id> and preserves host', () => {
  const href = buildReplayHref('https://paracosm.example/sim?foo=1', 'abc');
  const url = new URL(href);
  assert.equal(url.searchParams.get('replay'), 'abc');
  assert.equal(url.searchParams.get('foo'), '1');
});

test('buildReplayHref forces tab=sim so replay always lands on SimView', () => {
  // Regression: clicking the Quickstart "Replay last run" CTA built
  // a href that preserved the existing tab (?tab=quickstart), so the
  // user landed back on the seed-input form with ?replay=<id>
  // dangling. The top REPLAYING banner showed but the page itself
  // looked dead — nothing visibly happened. buildReplayHref now
  // ALWAYS sets tab=sim regardless of the source tab so the replay
  // surface is always reachable in one click.
  const fromQuickstart = buildReplayHref('https://paracosm.example/sim?tab=quickstart', 'sess-1');
  assert.equal(new URL(fromQuickstart).searchParams.get('tab'), 'sim');

  const fromReports = buildReplayHref('https://paracosm.example/sim?tab=reports', 'sess-2');
  assert.equal(new URL(fromReports).searchParams.get('tab'), 'sim');

  const fromBare = buildReplayHref('https://paracosm.example/', 'sess-3');
  assert.equal(new URL(fromBare).searchParams.get('tab'), 'sim');
});
