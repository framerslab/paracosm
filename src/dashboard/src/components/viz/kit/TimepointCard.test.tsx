import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { TimepointCard, timepointLabel, pickTopN } from './TimepointCard.js';
import type { MetricSpec, RiskFlag } from './shared/types.js';

const moraleSpec: MetricSpec = { id: 'morale', label: 'Morale', unit: 'pct', range: [0, 1] };
const popSpec: MetricSpec = { id: 'population', label: 'Population', unit: 'count', range: [0, 1000] };
const oxygenSpec: MetricSpec = { id: 'oxygen', label: 'Oxygen', unit: 'pct', range: [0, 1] };
const SPECS = { morale: moraleSpec, population: popSpec, oxygen: oxygenSpec };

test('timepointLabel turn-loop returns "Turn N"', () => {
  assert.equal(timepointLabel('turn-loop', 3), 'Turn 3');
});

test('timepointLabel batch-trajectory returns "T+N"', () => {
  assert.equal(timepointLabel('batch-trajectory', 12), 'T+12');
});

test('timepointLabel batch-point returns "Forecast"', () => {
  assert.equal(timepointLabel('batch-point', 0), 'Forecast');
});

test('pickTopN returns at most n entries with declared specs', () => {
  const out = pickTopN({ morale: 0.8, population: 100, oxygen: 0.9, unknown: 5 }, SPECS, 2);
  assert.equal(out.length, 2);
  out.forEach(e => assert.ok(e.spec, 'each entry has its spec'));
});

test('pickTopN drops metrics without a declared spec', () => {
  const out = pickTopN({ morale: 0.8, unknown: 5 }, SPECS, 5);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'morale');
});

test('TimepointCard turn-loop mode renders "Turn N" label', () => {
  const html = renderToString(React.createElement(TimepointCard, { timepoint: 3, mode: 'turn-loop', metrics: { morale: 0.7 }, metricSpecs: SPECS }));
  assert.ok(html.includes('Turn 3'));
});

test('TimepointCard batch-trajectory mode renders "T+N" label', () => {
  const html = renderToString(React.createElement(TimepointCard, { timepoint: 12, mode: 'batch-trajectory', metrics: { morale: 0.7 }, metricSpecs: SPECS }));
  assert.ok(html.includes('T+12'));
});

test('TimepointCard batch-point mode renders "Forecast" label', () => {
  const html = renderToString(React.createElement(TimepointCard, { timepoint: 0, mode: 'batch-point', metrics: { morale: 0.7 }, metricSpecs: SPECS }));
  assert.ok(html.includes('Forecast'));
});

test('TimepointCard renders highlights as bullet list', () => {
  const html = renderToString(React.createElement(TimepointCard, {
    timepoint: 1,
    mode: 'turn-loop',
    metrics: { morale: 0.7 },
    metricSpecs: SPECS,
    highlights: ['Crisis averted', 'Bonus food'],
  }));
  assert.ok(html.includes('Crisis averted'));
  assert.ok(html.includes('Bonus food'));
  assert.ok(html.includes('<li'), 'highlights must render as list items');
});

test('TimepointCard renders riskFlags via RiskFlagList', () => {
  const flags: RiskFlag[] = [{ id: 'r1', severity: 'high', label: 'Power outage risk' }];
  const html = renderToString(React.createElement(TimepointCard, {
    timepoint: 1,
    mode: 'turn-loop',
    metrics: { morale: 0.7 },
    metricSpecs: SPECS,
    riskFlags: flags,
  }));
  assert.ok(html.includes('Power outage risk'));
});

test('TimepointCard with empty highlights and no riskFlags omits both blocks', () => {
  const html = renderToString(React.createElement(TimepointCard, {
    timepoint: 1,
    mode: 'turn-loop',
    metrics: { morale: 0.7 },
    metricSpecs: SPECS,
  }));
  assert.ok(!html.includes('No risks'), 'should not render the empty risk-flag placeholder');
  assert.ok(!html.includes('<ul'), 'should not render the highlights ul');
});
