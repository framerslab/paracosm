import test from 'node:test';
import assert from 'node:assert/strict';

import { projectSystemBags } from '../../src/runtime/io/world-snapshot.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

const scenario = {
  id: 'capacity-test',
  world: {
    metrics: {
      revenue: { id: 'revenue', label: 'Revenue', unit: 'usd', type: 'number', initial: 10, category: 'metric' },
    },
    capacities: {
      budgetCap: { id: 'budgetCap', label: 'Budget Cap', unit: 'usd', type: 'number', initial: 100, category: 'capacity' },
    },
    statuses: {},
    politics: {},
    environment: {},
  },
} as unknown as ScenarioPackage;

test('projectSystemBags duplicates declared capacities into capacities while preserving metrics', () => {
  const projected = projectSystemBags(
    { revenue: 25, budgetCap: 120 },
    scenario,
    { births: 2 },
  );

  assert.deepEqual(projected.metrics, { revenue: 25, budgetCap: 120, births: 2 });
  assert.deepEqual(projected.capacities, { budgetCap: 120 });
});

test('projectSystemBags omits capacities when scenario declares none', () => {
  const projected = projectSystemBags(
    { revenue: 25 },
    { ...scenario, world: { ...scenario.world, capacities: {} } },
  );

  assert.deepEqual(projected.metrics, { revenue: 25 });
  assert.equal(projected.capacities, undefined);
});
