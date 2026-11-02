import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import type { KeyPersonnel } from '../../../src/engine/core/agent-generator.js';
import { readFileSync } from 'node:fs';
import { lunarScenario, marsScenario } from '../../../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';

const keyPersonnel: KeyPersonnel[] = [
  {
    name: 'Dr. Yuki Tanaka',
    department: 'medical',
    role: 'Chief Medical Officer',
    specialization: 'Radiation Medicine',
    age: 38,
    featured: true,
  },
];

test('SimulationKernel respects initial population and starting resources', () => {
  const kernel = new SimulationKernel(950, 'Commander', keyPersonnel, {
    startTime: 2042,
    initialPopulation: 120,
    startingResources: {
      foodMonthsReserve: 24,
      waterLitersPerDay: 950,
      powerKw: 600,
      morale: 0.72,
      pressurizedVolumeM3: 4200,
      lifeSupportCapacity: 180,
      infrastructureModules: 6,
      scienceOutput: 10,
    },
    startingPolitics: {
      earthDependencyPct: 70,
    },
  });

  const state = kernel.getState();
  assert.equal(state.metadata.startTime, 2042);
  assert.equal(state.metadata.currentTime, 2042);
  assert.equal(state.metrics.population, 120);
  assert.equal(state.agents.length, 120);
  assert.equal(state.metrics.foodMonthsReserve, 24);
  assert.equal(state.metrics.waterLitersPerDay, 950);
  assert.equal(state.metrics.powerKw, 600);
  assert.equal(state.metrics.morale, 0.72);
  assert.equal(state.metrics.pressurizedVolumeM3, 4200);
  assert.equal(state.metrics.lifeSupportCapacity, 180);
  assert.equal(state.metrics.infrastructureModules, 6);
  assert.equal(state.metrics.scienceOutput, 10);
  assert.equal(state.politics.earthDependencyPct, 70);
});

test('SimulationKernel: an empty key-personnel list builds the whole roster from the generator', () => {
  // What a scenario that declares no personnel (atlas-lab.json) gets:
  // the generator fills the population, nobody is featured until the
  // commander promotes someone, and no Mars colonist is placed.
  const kernel = new SimulationKernel(11, 'Marcus Reinhardt', [], { startTime: 1, initialPopulation: 30 });
  const state = kernel.getState();

  assert.equal(state.metadata.startTime, 1);
  assert.equal(state.agents.length, 30);
  assert.equal(state.metrics.population, 30);
  assert.ok(state.agents.every(a => !a.narrative.featured));
  assert.ok(!state.agents.some(a => a.core.name === 'Dr. Yuki Tanaka'));
});

test('SimulationKernel: a scenario\'s roster works in its own departments, under their own names', () => {
  // The commander picks heads from this list: "spec: Hydroponics" on an
  // Atlas Lab run is how a lab got a "Chief of Hydroponics & Food Security".
  const atlasLab = JSON.parse(readFileSync(new URL('../../../scenarios/atlas-lab.json', import.meta.url), 'utf-8')) as ScenarioPackage;
  const kernel = new SimulationKernel(11, 'Marcus Reinhardt', [], { startTime: 1, initialPopulation: 30, scenario: atlasLab });
  const { agents } = kernel.getState();
  const ids = atlasLab.departments.map(d => d.id);
  const labels = atlasLab.departments.map(d => d.label);

  assert.equal(agents.length, 30);
  assert.deepEqual(agents.filter(a => !ids.includes(a.core.department)).map(a => a.core.department), []);
  assert.deepEqual(agents.filter(a => !labels.includes(a.career.specialization)).map(a => a.career.specialization), []);
  assert.ok(new Set(agents.map(a => a.core.department)).size > 1, 'the people spread across the departments');

  // A department the trait table does not know ranks its own people first.
  const inAlignment = agents.filter(a => a.core.department === 'alignment_research').length;
  assert.ok(inAlignment > 0);
  const candidates = kernel.getCandidates('alignment_research', 5);
  assert.deepEqual(
    candidates.slice(0, Math.min(5, inAlignment)).map(a => a.core.department),
    Array(Math.min(5, inAlignment)).fill('alignment_research'),
  );

  const lunar = new SimulationKernel(1200, 'x', [], { startTime: 2030, initialPopulation: 50, scenario: lunarScenario });
  const lunarIds = lunarScenario.departments.map(d => d.id);
  assert.deepEqual(lunar.getState().agents.filter(a => !lunarIds.includes(a.core.department)).map(a => a.core.department), []);
});

test('SimulationKernel: Mars Genesis keeps the roster it has always had at a given seed', () => {
  const roster = (scenario?: ScenarioPackage) => new SimulationKernel(950, 'x', [], { startTime: 2035, initialPopulation: 100, scenario })
    .getState().agents.map(a => [a.core.name, a.core.department, a.career.specialization, a.core.role]);
  assert.deepEqual(roster(marsScenario), roster());
  assert.ok(roster(marsScenario).some(([, department]) => department === 'agriculture'));
});

test('SimulationKernel: initial state always has statuses and environment as empty objects when no scenario provided', () => {
  const kernel = new SimulationKernel(42, 'test-leader', []);
  const state = kernel.getState();
  assert.deepEqual(state.statuses, {});
  assert.deepEqual(state.environment, {});
});

test('SimulationKernel: constructor seeds state.metrics from scenario.world.metrics initials', () => {
  const scenario = {
    id: 'test-scenario',
    labels: { name: 'Test', populationNoun: 'people', settlementNoun: 'camp' },
    setup: { defaultTurns: 4, defaultSeed: 1, defaultStartTime: 0, defaultPopulation: 50 },
    world: {
      metrics: {
        hullIntegrity: { id: 'hullIntegrity', type: 'number' as const, initial: 85 },
        revenueArr: { id: 'revenueArr', type: 'number' as const, initial: 6000000 },
      },
      capacities: {},
      statuses: {},
      politics: {},
      environment: {},
    },
    departments: [],
  };
  const kernel = new SimulationKernel(42, 'test-leader', [], { scenario: scenario as unknown as never });
  const state = kernel.getState();
  assert.equal(state.metrics.hullIntegrity, 85);
  assert.equal(state.metrics.revenueArr, 6_000_000);
});

test('SimulationKernel: capacities declarations also populate state.metrics', () => {
  const scenario = {
    id: 'test-capacities',
    labels: { name: 'Test' },
    setup: { defaultTurns: 4, defaultSeed: 1, defaultStartTime: 0, defaultPopulation: 10 },
    world: {
      metrics: { foo: { id: 'foo', type: 'number' as const, initial: 1 } },
      capacities: { deliveryCapacity: { id: 'deliveryCapacity', type: 'number' as const, initial: 12 } },
      statuses: {},
      politics: {},
      environment: {},
    },
    departments: [],
  };
  const kernel = new SimulationKernel(42, 'test-leader', [], { scenario: scenario as unknown as never });
  const state = kernel.getState();
  assert.equal(state.metrics.deliveryCapacity, 12);
  assert.equal(state.metrics.foo, 1);
});

test('SimulationKernel: constructor populates state.politics from scenario.world.politics initials', () => {
  const scenario = {
    id: 'test-politics',
    labels: { name: 'Test' },
    setup: { defaultTurns: 4, defaultSeed: 1, defaultStartTime: 0, defaultPopulation: 10 },
    world: {
      metrics: { foo: { id: 'foo', type: 'number' as const, initial: 1 } },
      capacities: {},
      statuses: {},
      politics: {
        boardConfidence: { id: 'boardConfidence', type: 'number' as const, initial: 72 },
      },
      environment: {},
    },
    departments: [],
  };
  const kernel = new SimulationKernel(42, 'test-leader', [], { scenario: scenario as unknown as never });
  const state = kernel.getState();
  assert.equal(state.politics.boardConfidence, 72);
});

test('SimulationKernel: constructor populates state.statuses from scenario.world.statuses initials', () => {
  const scenario = {
    id: 'test-statuses',
    labels: { name: 'Test' },
    setup: { defaultTurns: 4, defaultSeed: 1, defaultStartTime: 0, defaultPopulation: 10 },
    world: {
      metrics: { foo: { id: 'foo', type: 'number' as const, initial: 1 } },
      capacities: {},
      statuses: {
        fundingRound: { id: 'fundingRound', type: 'string' as const, initial: 'series-b' },
        ratified: { id: 'ratified', type: 'boolean' as const, initial: true },
      },
      politics: {},
      environment: {},
    },
    departments: [],
  };
  const kernel = new SimulationKernel(42, 'test-leader', [], { scenario: scenario as unknown as never });
  const state = kernel.getState();
  assert.equal(state.statuses.fundingRound, 'series-b');
  assert.equal(state.statuses.ratified, true);
});

test('SimulationKernel: constructor populates state.environment from scenario.world.environment initials', () => {
  const scenario = {
    id: 'test-env',
    labels: { name: 'Test' },
    setup: { defaultTurns: 4, defaultSeed: 1, defaultStartTime: 0, defaultPopulation: 10 },
    world: {
      metrics: { foo: { id: 'foo', type: 'number' as const, initial: 1 } },
      capacities: {},
      statuses: {},
      politics: {},
      environment: {
        marketGrowthPct: { id: 'marketGrowthPct', type: 'number' as const, initial: 25 },
        region: { id: 'region', type: 'string' as const, initial: 'na' },
      },
    },
    departments: [],
  };
  const kernel = new SimulationKernel(42, 'test-leader', [], { scenario: scenario as unknown as never });
  const state = kernel.getState();
  assert.equal(state.environment.marketGrowthPct, 25);
  assert.equal(state.environment.region, 'na');
});

test('SimulationKernel: explicit startingResources overlay wins over scenario declarations', () => {
  const scenario = {
    id: 'test-overlay',
    labels: { name: 'Test' },
    setup: { defaultTurns: 4, defaultSeed: 1, defaultStartTime: 0, defaultPopulation: 10 },
    world: {
      metrics: { revenueArr: { id: 'revenueArr', type: 'number' as const, initial: 1_000_000 } },
      capacities: {},
      statuses: {},
      politics: {},
      environment: {},
    },
    departments: [],
  };
  const kernel = new SimulationKernel(42, 'test-leader', [], {
    scenario: scenario as unknown as never,
    startingResources: { revenueArr: 9_999_999 } as never,
  });
  const state = kernel.getState();
  assert.equal(state.metrics.revenueArr, 9_999_999, 'caller overlay must override scenario declaration');
});

test('SimulationKernel: type-appropriate zeros when initial is absent', () => {
  const scenario = {
    id: 'test-defaults',
    labels: { name: 'Test' },
    setup: { defaultTurns: 4, defaultSeed: 1, defaultStartTime: 0, defaultPopulation: 10 },
    world: {
      metrics: { noInitial: { id: 'noInitial', type: 'number' as const } },
      capacities: {},
      statuses: { someFlag: { id: 'someFlag', type: 'boolean' as const } },
      politics: {},
      environment: { someText: { id: 'someText', type: 'string' as const } },
    },
    departments: [],
  };
  const kernel = new SimulationKernel(42, 'test-leader', [], { scenario: scenario as unknown as never });
  const state = kernel.getState();
  assert.equal(state.metrics.noInitial, 0);
  assert.equal(state.statuses.someFlag, false);
  assert.equal(state.environment.someText, '');
});

test('SimulationKernel: a child is no candidate for a department head', () => {
  // A fork can replace a head who died, and the roster by then holds the
  // people born since. The trait score does not read age.
  const parent = new SimulationKernel(11, 'Aria Chen', keyPersonnel, { startTime: 2035, initialPopulation: 12 });
  const snap = JSON.parse(JSON.stringify(parent.toSnapshot('mars-genesis')));
  const childIds: string[] = [];
  for (const agent of snap.state.agents.slice(0, 3)) {
    agent.core.birthTime = 2030;
    childIds.push(agent.core.id);
  }
  const forked = SimulationKernel.fromSnapshot(snap, 'mars-genesis');

  const candidates = forked.getCandidates('medical', 12).map(a => a.core.id);
  assert.equal(candidates.length, 12 - childIds.length);
  assert.deepEqual(candidates.filter(id => childIds.includes(id)), []);
});
