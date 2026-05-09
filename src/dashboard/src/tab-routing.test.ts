import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDashboardTabHref,
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
