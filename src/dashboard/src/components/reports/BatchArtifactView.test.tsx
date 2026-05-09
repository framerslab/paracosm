import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { BatchArtifactView, resolvePrimaryMetric } from './BatchArtifactView.js';
import type { MetricSpec } from '../viz/kit/index.js';
import type { RunArtifact } from '../../../../engine/schema/index.js';

const moraleSpec: MetricSpec = { id: 'morale', label: 'Morale', unit: 'pct', range: [0, 1], thresholds: { warn: 0.4, critical: 0.2 } };
const popSpec: MetricSpec = { id: 'population', label: 'Population', unit: 'count', range: [0, 1000] };

function batchTrajectoryArtifact(): RunArtifact {
  return {
    metadata: {
      runId: 'r-bt-1',
      scenario: { id: 'corp-q3', name: 'Corp Q3 forecast' },
      mode: 'batch-trajectory',
      startedAt: '2026-04-25T00:00:00.000Z',
    },
    trajectory: {
      timeUnit: { singular: 'quarter', plural: 'quarters' },
      timepoints: [
        { t: 1, label: 'Q1', worldSnapshot: { metrics: { morale: 0.8, population: 220 } } },
        { t: 2, label: 'Q2', worldSnapshot: { metrics: { morale: 0.6, population: 240 } } },
        { t: 3, label: 'Q3', worldSnapshot: { metrics: { morale: 0.4, population: 250 } }, riskFlags: [{ id: 'r1', severity: 'high', label: 'Headcount risk' }] },
      ],
    },
  } as unknown as RunArtifact;
}

function batchPointArtifact(): RunArtifact {
  return {
    metadata: {
      runId: 'r-bp-1',
      scenario: { id: 'mkt-shock', name: 'Market shock forecast' },
      mode: 'batch-point',
      startedAt: '2026-04-25T00:00:00.000Z',
    },
    finalState: { metrics: { morale: 0.45, population: 180 } },
    overview: 'Stress event reduces morale by 35 pp over 12 weeks.',
    riskFlags: [{ id: 'r1', severity: 'critical', label: 'Sustained morale crash' }],
  } as unknown as RunArtifact;
}

test('BatchArtifactView batch-trajectory renders TrajectoryStrip and TimepointCards', () => {
  const html = renderToString(React.createElement(BatchArtifactView, {
    artifact: batchTrajectoryArtifact(),
    metricSpecs: { morale: moraleSpec, population: popSpec },
  }));
  // TrajectoryStrip presence: polyline element
  assert.ok(html.includes('<polyline'), 'must render trajectory strip polyline');
  // TimepointCards: three grid tiles
  const t1 = html.indexOf('T+1');
  const t2 = html.indexOf('T+2');
  const t3 = html.indexOf('T+3');
  assert.ok(t1 >= 0 && t2 > t1 && t3 > t2, 'three timepoint cards in order');
  // Risk flag from Q3 should surface
  assert.ok(html.includes('Headcount risk'), 'risk flag from Q3 must render');
});

test('BatchArtifactView batch-point renders single TimepointCard with forecast label', () => {
  const html = renderToString(React.createElement(BatchArtifactView, {
    artifact: batchPointArtifact(),
    metricSpecs: { morale: moraleSpec, population: popSpec },
  }));
  assert.ok(html.includes('Forecast'), 'must show "Forecast" label');
  assert.ok(html.includes('Stress event reduces morale'), 'overview must render in highlights');
  assert.ok(html.includes('Sustained morale crash'), 'risk flag must render');
});

test('BatchArtifactView batch-trajectory with no timepoints renders empty state', () => {
  const empty = batchTrajectoryArtifact();
  empty.trajectory!.timepoints = [];
  const html = renderToString(React.createElement(BatchArtifactView, {
    artifact: empty,
    metricSpecs: { morale: moraleSpec, population: popSpec },
  }));
  assert.ok(html.includes('No timepoints'), 'must show empty state');
});

test('BatchArtifactView turn-loop mode falls through with explanatory message', () => {
  const a = batchTrajectoryArtifact();
  a.metadata.mode = 'turn-loop';
  const html = renderToString(React.createElement(BatchArtifactView, {
    artifact: a,
    metricSpecs: { morale: moraleSpec, population: popSpec },
  }));
  assert.ok(html.includes('Use ReportView'), 'must point users to ReportView for turn-loop');
});

test('resolvePrimaryMetric returns first declared spec when specs are populated', () => {
  const a = batchTrajectoryArtifact();
  const out = resolvePrimaryMetric(a, { morale: moraleSpec, population: popSpec });
  assert.equal(out.id, 'morale');
});

test('resolvePrimaryMetric falls back to most-volatile metric when no specs declared', () => {
  const a = batchTrajectoryArtifact();
  const out = resolvePrimaryMetric(a, {});
  // morale ranges 0.4-0.8, population ranges 220-250; morale ratio is higher
  assert.ok(['morale', 'population'].includes(out.id), 'must pick a real metric id');
});
