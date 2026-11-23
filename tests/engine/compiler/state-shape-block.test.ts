import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStateShapeBlock } from '../../../src/engine/compiler/state-shape-block.js';

test('buildStateShapeBlock lists scenario-declared metric keys under state.metrics', () => {
  const block = buildStateShapeBlock({
    labels: { timeUnitNoun: 'quarter', timeUnitNounPlural: 'quarters' },
    world: {
      metrics: { revenue: { id: 'revenue' }, morale: { id: 'morale' } },
      capacities: {},
      politics: {},
    },
  });
  assert.ok(block.includes('state.metrics'));
  assert.ok(block.includes('revenue'));
  assert.ok(block.includes('morale'));
  assert.ok(block.includes('quarter'));
  assert.ok(block.includes('quarters'));
});

test('buildStateShapeBlock merges world.capacities keys into state.metrics', () => {
  const block = buildStateShapeBlock({
    world: {
      metrics: { metricA: { id: 'metricA' } },
      capacities: { capB: { id: 'capB' } },
      politics: {},
    },
  });
  // Both keys should appear in the state.metrics key list because
  // capacities flatten into systems at runtime.
  assert.ok(block.includes('metricA'));
  assert.ok(block.includes('capB'));
});

test('buildStateShapeBlock lists state.statuses + state.environment as runtime bags', () => {
  const block = buildStateShapeBlock({
    world: {
      metrics: {},
      capacities: {},
      statuses: { fundingRound: { id: 'fundingRound' } },
      politics: {},
      environment: { marketGrowthPct: { id: 'marketGrowthPct' } },
    },
  });
  assert.ok(block.includes('state.statuses'), 'block must list state.statuses');
  assert.ok(block.includes('fundingRound'));
  assert.ok(block.includes('state.environment'));
  assert.ok(block.includes('marketGrowthPct'));
  assert.ok(!block.includes('DO NOT EXIST'), 'denial language must be removed now that bags are real');
});

test('buildStateShapeBlock falls back to tick when timeUnit not set', () => {
  const block = buildStateShapeBlock({
    world: { metrics: {}, capacities: {}, politics: {} },
  });
  assert.ok(block.includes('tick'));
  assert.ok(block.includes('ticks'));
});

test('buildStateShapeBlock renders "(none declared)" for empty bags', () => {
  const block = buildStateShapeBlock({
    world: { metrics: {}, capacities: {}, politics: {} },
  });
  assert.ok(block.includes('(none declared)'));
});

test('buildStateShapeBlock encourages defensive access via nullish-coalescing', () => {
  const block = buildStateShapeBlock({
    world: { metrics: { x: { id: 'x' } }, capacities: {}, politics: {} },
  });
  assert.ok(
    block.includes('?? 0') || block.includes('Defensive access'),
    'prompt should recommend defensive access pattern',
  );
});

test('buildStateShapeBlock says a key that is not an identifier is read with brackets, naming the first such key', () => {
  // A scenario compiled from a prompt declares kebab-case keys, and
  // state.metrics.soil-health is a subtraction that throws.
  const block = buildStateShapeBlock({
    world: {
      metrics: { harvest: { id: 'harvest' }, 'soil-health': { id: 'soil-health' }, 'water-reserve': { id: 'water-reserve' } },
      capacities: {},
      politics: {},
    },
  });
  const line = "- A key that is not a plain identifier is read with brackets: state.metrics['soil-health'].";
  assert.ok(block.split('\n').includes(line), `the RULES hold the line "${line}" (read:\n${block})`);
});

test('buildStateShapeBlock adds no bracket line for Mars Genesis, whose keys are all identifiers', () => {
  const mars = JSON.parse(readFileSync(new URL('../../../scenarios/mars.json', import.meta.url), 'utf-8'));
  const block = buildStateShapeBlock(mars);
  assert.ok(block.includes('declared keys: population'), `the block lists Mars Genesis's declared keys (read:\n${block})`);
  assert.ok(!block.includes('read with brackets'), `the block has no bracket line (read:\n${block})`);
});
