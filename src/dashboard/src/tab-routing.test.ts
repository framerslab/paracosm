import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDashboardTabHref,
  createSettingsKeyHref,
  createToolLogHref,
  createWatchTurnHref,
  watchTurnFromHref,
  getDashboardTabFromHref,
  requestsSettingsKeyFocus,
  resolveSetupRedirectHref,
  settingsKeyFocusField,
} from './tab-routing.js';

test('getDashboardTabFromHref prefers the query-param tab contract', () => {
  assert.equal(
    getDashboardTabFromHref('http://localhost:3456/sim?tab=settings'),
    'settings',
  );
});

test('getDashboardTabFromHref still supports legacy hash routing', () => {
  assert.equal(
    getDashboardTabFromHref('http://localhost:3456/sim#reports'),
    'reports',
  );
});

test('createDashboardTabHref rewrites the current URL to the requested tab', () => {
  assert.equal(
    createDashboardTabHref('http://localhost:3456/sim?tab=settings#legacy', 'sim'),
    'http://localhost:3456/sim?tab=sim',
  );
});

test('resolveSetupRedirectHref promotes successful setup redirects into the sim tab', () => {
  assert.equal(
    resolveSetupRedirectHref('http://localhost:3456/sim?tab=settings', '/sim'),
    'http://localhost:3456/sim?tab=sim',
  );
});

test('createToolLogHref opens the Event Log on one actor\'s tool by its whole name, and drops the old log filters', () => {
  const href = 'http://localhost:3456/sim?replay=abc&tab=sim&logQuery=old&logTypes=decision_made&logLeader=Dietrich%20Voss&logTurnMin=1&logTurnMax=2#log=other';
  const url = new URL(createToolLogHref(href, 'mars_landing_site_score', 'Aria Chen'));
  assert.equal(url.searchParams.get('replay'), 'abc');
  assert.equal(url.searchParams.get('tab'), 'settings');
  assert.equal(url.searchParams.get('sub'), 'log');
  assert.equal(url.searchParams.get('logLeader'), 'Aria Chen');
  for (const key of ['logQuery', 'logTypes', 'logTurnMin', 'logTurnMax']) assert.equal(url.searchParams.has(key), false, key);
  assert.equal(url.hash, '#log=mars_landing_site_score&logExact=1');
});

test('createToolLogHref with no actor leaves the log on every actor', () => {
  const url = new URL(createToolLogHref('http://localhost:3456/sim?tab=reports&logLeader=Aria%20Chen', 'habitat_pressure_check'));
  assert.equal(url.searchParams.has('logLeader'), false);
  assert.equal(url.hash, '#log=habitat_pressure_check&logExact=1');
});

test('a key link names the field of the provider that refused the key', () => {
  const watch = 'http://localhost:3456/sim?tab=sim&sub=log#log=x';
  const openai = createSettingsKeyHref(watch);
  assert.equal(openai, 'http://localhost:3456/sim?tab=settings&focus=api-key');
  assert.equal(settingsKeyFocusField(openai), 'openai');
  assert.equal(createSettingsKeyHref(watch, 'openai'), openai);
  const anthropic = createSettingsKeyHref(watch, 'anthropic');
  assert.equal(anthropic, 'http://localhost:3456/sim?tab=settings&focus=api-key-anthropic');
  assert.equal(settingsKeyFocusField(anthropic), 'anthropic');
  assert.equal(requestsSettingsKeyFocus(anthropic), true);
  // The Run tab's add-key fragment still names OpenAI's field; another tab names none.
  assert.equal(settingsKeyFocusField('http://localhost:3456/sim#key-openai'), 'openai');
  assert.equal(settingsKeyFocusField('http://localhost:3456/sim?tab=settings#key-anthropic'), 'anthropic');
  assert.equal(settingsKeyFocusField('http://localhost:3456/sim?tab=sim&focus=api-key'), null);
  assert.equal(requestsSettingsKeyFocus('http://localhost:3456/sim?tab=settings'), false);
});

test('Watch turn addresses survive tab changes and preserve the replay and other route state', () => {
  const href = 'http://localhost:3456/sim?replay=run&tab=sim&watchPlace=2#evidence';
  const selected = createWatchTurnHref(href, 3);
  assert.equal(selected, 'http://localhost:3456/sim?replay=run&tab=sim&watchPlace=2&watchTurn=3#evidence');
  assert.equal(watchTurnFromHref(createDashboardTabHref(selected, 'viz')), 3);
  assert.equal(createWatchTurnHref(selected, null), href);
  assert.equal(watchTurnFromHref(createWatchTurnHref(href, 'end')), 'end');
  for (const invalid of ['0', '1.5', '-1', '01', '101', '1e1', 'NaN']) {
    assert.equal(watchTurnFromHref(href.replace('#', '&watchTurn=' + invalid + '#')), null, invalid);
  }
});

test('the Settings recovery address preserves a held turn and its existing focus suffix', () => {
  const watch = 'http://localhost:3456/sim?replay=abc&tab=sim&watchTurn=3';
  const settings = createSettingsKeyHref(watch, 'anthropic');
  assert.equal(settings, 'http://localhost:3456/sim?replay=abc&watchTurn=3&tab=settings&focus=api-key-anthropic');
  assert.equal(watchTurnFromHref(settings), 3);
  assert.equal(settingsKeyFocusField(settings), 'anthropic');
});
