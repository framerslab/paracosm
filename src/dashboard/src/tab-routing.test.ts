import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDashboardTabHref,
  createToolLogHref,
  getDashboardTabFromHref,
  resolveSetupRedirectHref,
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
