import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { RiskFlagList } from './RiskFlagList.js';
import type { RiskFlag } from './shared/types.js';

const flags: RiskFlag[] = [
  { id: 'a', severity: 'low', label: 'Low risk' },
  { id: 'b', severity: 'critical', label: 'Critical risk' },
  { id: 'c', severity: 'medium', label: 'Medium risk', detail: 'Details here' },
  { id: 'd', severity: 'high', label: 'High risk' },
];

test('RiskFlagList sorts critical first, then high, medium, low', () => {
  const html = renderToString(React.createElement(RiskFlagList, { flags }));
  const criticalIdx = html.indexOf('Critical risk');
  const highIdx = html.indexOf('High risk');
  const mediumIdx = html.indexOf('Medium risk');
  const lowIdx = html.indexOf('Low risk');
  assert.ok(criticalIdx >= 0 && criticalIdx < highIdx);
  assert.ok(highIdx < mediumIdx);
  assert.ok(mediumIdx < lowIdx);
});

test('RiskFlagList renders empty-state placeholder when flags are empty', () => {
  const html = renderToString(React.createElement(RiskFlagList, { flags: [] }));
  assert.ok(html.includes('No risks'), 'must show empty-state copy');
});

test('RiskFlagList renders detail when expandable is true', () => {
  const html = renderToString(React.createElement(RiskFlagList, { flags, expandable: true }));
  assert.ok(html.includes('Details here'), 'detail must render when expandable');
});

test('RiskFlagList does NOT render detail when expandable is false / unset', () => {
  const html = renderToString(React.createElement(RiskFlagList, { flags }));
  assert.ok(!html.includes('Details here'), 'detail must be hidden by default');
});

test('RiskFlagList applies severity color via data-severity attribute', () => {
  const html = renderToString(React.createElement(RiskFlagList, { flags }));
  assert.ok(html.includes('data-severity="critical"'));
  assert.ok(html.includes('data-severity="low"'));
});
