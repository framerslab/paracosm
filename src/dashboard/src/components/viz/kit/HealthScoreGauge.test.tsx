import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { HealthScoreGauge } from './HealthScoreGauge.js';
import type { MetricSpec } from './shared/types.js';

const morale: MetricSpec = {
  id: 'morale',
  label: 'Morale',
  unit: 'pct',
  range: [0, 1],
  thresholds: { warn: 0.4, critical: 0.2 },
};

test('HealthScoreGauge linear variant renders a rect with computed width', () => {
  const html = renderToString(React.createElement(HealthScoreGauge, { spec: morale, value: 0.6, variant: 'linear' }));
  assert.ok(html.includes('<rect'), 'must render a rect for linear');
  assert.ok(html.includes('60%'), 'must show formatted value');
});

test('HealthScoreGauge radial variant renders a path arc', () => {
  const html = renderToString(React.createElement(HealthScoreGauge, { spec: morale, value: 0.7, variant: 'radial' }));
  assert.ok(html.includes('<path'), 'must render a path arc for radial');
});

test('HealthScoreGauge applies critical color when value below critical threshold', () => {
  const html = renderToString(React.createElement(HealthScoreGauge, { spec: morale, value: 0.1 }));
  assert.ok(html.includes('data-color="critical"'), 'must mark critical color bucket');
});

test('HealthScoreGauge applies ok color when above warn', () => {
  const html = renderToString(React.createElement(HealthScoreGauge, { spec: morale, value: 0.8 }));
  assert.ok(html.includes('data-color="ok"'));
});

test('HealthScoreGauge inverted metric reverses bucket', () => {
  const radiation: MetricSpec = {
    id: 'rad', label: 'Radiation', unit: 'count', range: [0, 1000],
    thresholds: { warn: 400, critical: 700 }, inverted: true,
  };
  const low = renderToString(React.createElement(HealthScoreGauge, { spec: radiation, value: 50 }));
  const high = renderToString(React.createElement(HealthScoreGauge, { spec: radiation, value: 800 }));
  assert.ok(low.includes('data-color="ok"'), 'low value on inverted metric is ok');
  assert.ok(high.includes('data-color="critical"'), 'high value on inverted metric is critical');
});

test('HealthScoreGauge size attribute changes svg dimensions', () => {
  const sm = renderToString(React.createElement(HealthScoreGauge, { spec: morale, value: 0.5, size: 'sm' }));
  const lg = renderToString(React.createElement(HealthScoreGauge, { spec: morale, value: 0.5, size: 'lg' }));
  const smW = (sm.match(/width="(\d+)"/) ?? [])[1];
  const lgW = (lg.match(/width="(\d+)"/) ?? [])[1];
  assert.notEqual(smW, lgW);
});

test('HealthScoreGauge falls back to label and placeholder when value is NaN', () => {
  const html = renderToString(React.createElement(HealthScoreGauge, { spec: morale, value: Number.NaN }));
  assert.ok(html.includes('Morale'), 'must still show label');
  assert.ok(html.includes('n/a'), 'must show n/a placeholder for NaN');
});
