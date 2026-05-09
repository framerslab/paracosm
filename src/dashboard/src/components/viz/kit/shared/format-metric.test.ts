import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMetric } from './format-metric.js';
import type { MetricSpec } from './types.js';

const pct: MetricSpec = { id: 'p', label: 'P', unit: 'pct', range: [0, 1] };
const count: MetricSpec = { id: 'c', label: 'C', unit: 'count', range: [0, 10000] };
const currency: MetricSpec = { id: 'd', label: 'D', unit: 'currency', range: [0, 1e7] };
const tspec: MetricSpec = { id: 't', label: 'T', unit: 'time', range: [2030, 2050] };
const generic: MetricSpec = { id: 'g', label: 'G', unit: 'kg', range: [0, 100] };

test('formatMetric pct: 0.85 -> 85%', () => {
  assert.equal(formatMetric(pct, 0.85), '85%');
});

test('formatMetric pct: 0.0735 -> 7%', () => {
  assert.equal(formatMetric(pct, 0.0735), '7%');
});

test('formatMetric count: 1200 -> 1,200', () => {
  assert.equal(formatMetric(count, 1200), '1,200');
});

test('formatMetric currency: 1234567 -> $1.2M', () => {
  assert.equal(formatMetric(currency, 1234567), '$1.2M');
});

test('formatMetric currency: 5000 -> $5K', () => {
  assert.equal(formatMetric(currency, 5000), '$5K');
});

test('formatMetric currency: 250 -> $250', () => {
  assert.equal(formatMetric(currency, 250), '$250');
});

test('formatMetric time: 2042 -> Y2042', () => {
  assert.equal(formatMetric(tspec, 2042), 'Y2042');
});

test('formatMetric generic unit appends suffix', () => {
  assert.equal(formatMetric(generic, 42), '42 kg');
});

test('formatMetric NaN -> n/a placeholder', () => {
  assert.equal(formatMetric(pct, Number.NaN), 'n/a');
});

test('formatMetric null/undefined -> n/a placeholder', () => {
  assert.equal(formatMetric(pct, undefined as unknown as number), 'n/a');
  assert.equal(formatMetric(pct, null as unknown as number), 'n/a');
});
