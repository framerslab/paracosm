import test from 'node:test';
import assert from 'node:assert/strict';
import { metricColor, type ColorBucket } from './metric-color.js';
import type { MetricSpec } from './types.js';

const morale: MetricSpec = {
  id: 'morale',
  label: 'Morale',
  unit: 'pct',
  range: [0, 1],
  thresholds: { warn: 0.4, critical: 0.2 },
};

const radiation: MetricSpec = {
  id: 'radiation',
  label: 'Cumulative Radiation',
  unit: 'count',
  range: [0, 1000],
  thresholds: { warn: 400, critical: 700 },
  inverted: true,
};

test('metricColor returns ok for value above warn threshold on a normal metric', () => {
  assert.equal(metricColor(morale, 0.7), 'ok' satisfies ColorBucket);
});

test('metricColor returns warn between warn and critical', () => {
  assert.equal(metricColor(morale, 0.3), 'warn');
});

test('metricColor returns critical at or below critical threshold', () => {
  assert.equal(metricColor(morale, 0.15), 'critical');
});

test('metricColor at the warn boundary classifies as warn', () => {
  assert.equal(metricColor(morale, 0.4), 'warn');
});

test('metricColor inverts for inverted metrics: low value = ok', () => {
  assert.equal(metricColor(radiation, 100), 'ok');
});

test('metricColor inverts for inverted metrics: high value = critical', () => {
  assert.equal(metricColor(radiation, 800), 'critical');
});

test('metricColor returns ok when no thresholds are declared', () => {
  const noThresh: MetricSpec = { id: 'x', label: 'X', range: [0, 1] };
  assert.equal(metricColor(noThresh, 0.5), 'ok');
});

test('metricColor handles edge case at min and max of range', () => {
  assert.equal(metricColor(morale, 0), 'critical');
  assert.equal(metricColor(morale, 1), 'ok');
});
