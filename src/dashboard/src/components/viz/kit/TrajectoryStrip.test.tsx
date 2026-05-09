import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { TrajectoryStrip, pickHighest } from './TrajectoryStrip.js';
import type { MetricSpec, RiskFlag } from './shared/types.js';

const moraleSpec: MetricSpec = {
  id: 'morale', label: 'Morale', unit: 'pct', range: [0, 1],
  thresholds: { warn: 0.4, critical: 0.2 },
};

test('pickHighest returns the most severe flag', () => {
  const flags: RiskFlag[] = [
    { id: 'a', severity: 'low', label: 'L' },
    { id: 'b', severity: 'critical', label: 'C' },
    { id: 'c', severity: 'medium', label: 'M' },
  ];
  assert.equal(pickHighest(flags), 'critical');
});

test('pickHighest returns null for empty/undefined', () => {
  assert.equal(pickHighest(undefined), null);
  assert.equal(pickHighest([]), null);
});

test('TrajectoryStrip renders one column per timepoint', () => {
  const html = renderToString(React.createElement(TrajectoryStrip, {
    timepoints: [
      { label: 'T1', metrics: { morale: 0.7 } },
      { label: 'T2', metrics: { morale: 0.5 } },
      { label: 'T3', metrics: { morale: 0.3 } },
    ],
    primaryMetric: moraleSpec,
  }));
  const matches = html.match(/data-column="\d+"/g);
  assert.equal(matches?.length, 3);
});

test('TrajectoryStrip primary metric polyline has N points', () => {
  const html = renderToString(React.createElement(TrajectoryStrip, {
    timepoints: [
      { label: 'T1', metrics: { morale: 0.8 } },
      { label: 'T2', metrics: { morale: 0.6 } },
      { label: 'T3', metrics: { morale: 0.4 } },
      { label: 'T4', metrics: { morale: 0.2 } },
    ],
    primaryMetric: moraleSpec,
  }));
  const polyMatch = html.match(/<polyline[^>]*points="([^"]+)"/);
  assert.ok(polyMatch, 'must emit a polyline');
  const points = polyMatch![1].trim().split(/\s+/);
  assert.equal(points.length, 4);
});

test('TrajectoryStrip risk flags render as colored dots above their column', () => {
  const flags: RiskFlag[] = [{ id: 'x', severity: 'high', label: 'Power risk' }];
  const html = renderToString(React.createElement(TrajectoryStrip, {
    timepoints: [
      { label: 'T1', metrics: { morale: 0.8 } },
      { label: 'T2', metrics: { morale: 0.6 }, riskFlags: flags },
    ],
    primaryMetric: moraleSpec,
  }));
  assert.ok(html.includes('data-risk-column="1"'), 'risk dot must mark column index 1');
});

test('TrajectoryStrip empty timepoints renders an empty-state placeholder', () => {
  const html = renderToString(React.createElement(TrajectoryStrip, { timepoints: [], primaryMetric: moraleSpec }));
  assert.ok(html.includes('No trajectory data'));
});
