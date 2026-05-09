import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportSections } from './reportSections.js';

test('buildReportSections respects configured report focus and appends available causality', () => {
  const plan = buildReportSections({
    configuredSections: ['crisis', 'departments', 'decision', 'outcome', 'quotes'],
    hasQuotes: true,
    hasCausality: true,
    hasVerdict: true,
    hasTrajectories: true,
    hasCost: false,
    hasToolbox: true,
    hasReferences: true,
  });

  assert.deepEqual(plan.focusSections, ['crisis', 'departments', 'decision', 'outcome', 'quotes']);
  assert.deepEqual(plan.eventSections, ['crisis', 'departments', 'decision', 'outcome', 'causality']);
  assert.deepEqual(plan.footerSections, ['quotes']);
  assert.deepEqual(plan.artifacts, ['timeline', 'verdict', 'trajectory', 'toolbox', 'references']);
});

test('buildReportSections falls back to default focus and omits quote footer when the run has no reactions', () => {
  const plan = buildReportSections({
    configuredSections: [],
    hasQuotes: false,
    hasCausality: false,
    hasVerdict: false,
    hasTrajectories: false,
    hasCost: true,
    hasToolbox: false,
    hasReferences: false,
  });

  assert.deepEqual(plan.focusSections, ['crisis', 'departments', 'decision', 'outcome']);
  assert.deepEqual(plan.eventSections, ['crisis', 'departments', 'decision', 'outcome']);
  assert.deepEqual(plan.footerSections, []);
  assert.deepEqual(plan.artifacts, ['timeline', 'cost']);
});
