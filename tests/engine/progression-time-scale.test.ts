/**
 * People age and roll by the length of a turn, in years (#181).
 *
 * A scenario counts time in its own unit (`labels.timeUnitNoun`): Mars in
 * years, Atlas Lab in months, the Digital Twin in weeks. Between turns the
 * kernel ages people, adds experience and rolls the yearly birth, death,
 * partnership and promotion rates. The live Atlas Lab pair of 3 November
 * 2026 aged a person 43 to 48 over months 1 to 6, and a two-week twin turn
 * aged every patient two years, because every rate and age treated one unit
 * as one year. These tests run the kernel the orchestrator runs
 * (`new SimulationKernel` with the scenario, then `advanceTurn`), with the
 * scenarios loaded from scenarios/ as the server loads them, and no model
 * call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import type { Agent, TurnEvent } from '../../src/engine/core/state.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = loadDiskCustomScenarios(resolve(here, '../../scenarios'));
const scenario = (id: string) => {
  const sc = catalog.get(id)?.scenario as ScenarioPackage | undefined;
  assert.ok(sc, `scenarios/ holds ${id}`);
  return sc;
};
const atlasLab = scenario('atlas-lab');
// The Digital Twin preset compiles its hooks with a model before the server
// runs it, so the catalog skips it; the kernel reads only its labels, setup,
// departments and world, which the file holds as it ships.
const twin = JSON.parse(
  readFileSync(resolve(here, '../../scenarios/t2d-glp1-protocol.json'), 'utf-8'),
) as ScenarioPackage;
const corporate = scenario('corporate-quarterly');
const council = scenario('dual-superintelligence-council');
const submarine = scenario('deep-ocean-station');

function kernelFor(sc: ScenarioPackage, population: number, extra: Record<string, unknown> = {}): SimulationKernel {
  return new SimulationKernel(sc.setup.defaultSeed ?? 11, 'Marcus Reinhardt', [], {
    startTime: sc.setup.defaultStartTime ?? 1,
    initialPopulation: population,
    scenario: sc,
    ...extra,
  });
}

function near(actual: number, expected: number, label: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);
}

/** An event without the parts that name the time it happened at. */
function shape(e: TurnEvent): string {
  return e.type === 'birth' ? 'birth' : `${e.type}:${e.agentId ?? ''}:${e.cause ?? ''}`;
}

/** Age in years now: elapsed units times the run's years per unit (1 when it names none). */
function ageYears(kernel: SimulationKernel, agent: Agent): number {
  const { currentTime, yearsPerUnit } = kernel.getState().metadata as { currentTime: number; yearsPerUnit?: number };
  return (currentTime - agent.core.birthTime) * (yearsPerUnit ?? 1);
}

test('twelve months of Atlas Lab are the same year as one year of it', () => {
  // The same roster from the same seed, counted once in months (the
  // scenario's unit) and once in years; one step of twelve months against
  // one step of one year. Every roll reads the same ages and the same
  // probabilities, so the same people die, partner and rise.
  const months = kernelFor(atlasLab, 30);
  const years = kernelFor(atlasLab, 30, { yearsPerUnit: 1 });
  const before = months.getState().agents.map(a => ageYears(months, a));
  years.getState().agents.forEach((a, i) => near(ageYears(years, a), before[i], `${a.core.name}'s starting age`));

  const m = months.advanceTurn(1, 1 + 12);
  const y = years.advanceTurn(1, 1 + 1);
  const mEvents = m.eventLog.filter(e => e.turn === 1).map(shape);
  const yEvents = y.eventLog.filter(e => e.turn === 1).map(shape);
  assert.deepEqual(mEvents, yEvents);
  m.agents.slice(0, 30).forEach((a, i) => {
    near(ageYears(months, a), before[i] + 1, `${a.core.name}'s age after twelve months`);
    near(a.career.yearsExperience, y.agents[i].career.yearsExperience, `${a.core.name}'s experience`);
  });
});

test('a month of Atlas Lab ages its people a twelfth of a year', () => {
  const kernel = kernelFor(atlasLab, 30);
  kernel.advanceTurn(1, 1);
  const start = kernel.getState().agents.filter(a => a.health.alive);
  const startAge = new Map(start.map(a => [a.core.id, ageYears(kernel, a)]));
  const startExperience = new Map(start.map(a => [a.core.id, a.career.yearsExperience]));
  const check = (k: SimulationKernel, months: number) => {
    for (const a of k.getState().agents) {
      const age = startAge.get(a.core.id);
      if (age === undefined || !a.health.alive) continue;
      near(ageYears(k, a), age + months / 12, `${a.core.name}'s age after ${months} months`);
      near(a.career.yearsExperience, startExperience.get(a.core.id)! + months / 12, `${a.core.name}'s experience after ${months} months`);
    }
  };
  for (let turn = 2; turn <= 3; turn++) kernel.advanceTurn(turn, turn);
  check(kernel, 2);

  // A fork from a snapshot goes on counting in months.
  const fork = SimulationKernel.fromSnapshot(
    JSON.parse(JSON.stringify(kernel.toSnapshot(atlasLab.id))), atlasLab.id, atlasLab,
  );
  for (let turn = 4; turn <= 6; turn++) {
    kernel.advanceTurn(turn, turn);
    fork.advanceTurn(turn, turn);
  }
  check(kernel, 5);
  check(fork, 5);
});

test('two two-week turns of the Digital Twin age a patient four weeks, with no births', () => {
  const kernel = kernelFor(twin, 100);
  kernel.advanceTurn(1, 1);
  const start = new Map(kernel.getState().agents.map(a => [a.core.id, ageYears(kernel, a)]));
  kernel.advanceTurn(2, 3);
  const state = kernel.advanceTurn(3, 5);
  for (const a of state.agents) {
    const age = start.get(a.core.id);
    if (age === undefined || !a.health.alive) continue;
    near(ageYears(kernel, a), age + 4 / 52, `${a.core.name}'s age after four weeks`);
  }
  const happened = (type: string) => state.eventLog.filter(e => e.type === type).length;
  assert.equal(happened('birth'), 0, 'births in four weeks among 100 patients');
  assert.equal(happened('death'), 0, 'deaths in four weeks among 100 patients');
});

test('an eight-year Mars step still ages and doses its people eight years', () => {
  const kernel = new SimulationKernel(950, 'Aria Chen', [], {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  const hook = marsScenario.hooks.progressionHook;
  kernel.advanceTurn(1, 2035, hook);
  const before = kernel.getState().agents.filter(a => a.health.alive);
  const age = new Map(before.map(a => [a.core.id, ageYears(kernel, a)]));
  const experience = new Map(before.map(a => [a.core.id, a.career.yearsExperience]));
  const dose = new Map(before.map(a => [a.core.id, a.health.cumulativeRadiationMsv ?? 0]));
  const state = kernel.advanceTurn(2, 2043, hook);
  for (const a of state.agents) {
    if (!age.has(a.core.id) || !a.health.alive) continue;
    near(ageYears(kernel, a), age.get(a.core.id)! + 8, `${a.core.name}'s age after eight years`);
    near(a.career.yearsExperience, experience.get(a.core.id)! + 8, `${a.core.name}'s experience after eight years`);
    // Mars starts with three habitat modules, which keep out 60 percent
    // of the surface dose.
    near(a.health.cumulativeRadiationMsv ?? 0, dose.get(a.core.id)! + 0.67 * 365 * 8 * 0.4, `${a.core.name}'s dose after eight years`);
  }
});

test('the length of a unit in years comes from the scenario', async () => {
  const { yearsPerTimeUnit } = await import('../../src/engine/core/time-unit.js');
  const presets: Array<[ScenarioPackage, number]> = [
    [marsScenario, 1], [lunarScenario, 1], [submarine, 1],
    [atlasLab, 1 / 12], [council, 1 / 12], [twin, 1 / 52], [corporate, 1 / 4],
  ];
  for (const [sc, years] of presets) {
    near(yearsPerTimeUnit(sc.labels, sc.setup), years, `${sc.id} (${sc.labels.timeUnitNoun})`);
    near(kernelFor(sc, 5).getState().metadata.yearsPerUnit ?? NaN, years, `${sc.id}'s kernel`);
  }
  near(yearsPerTimeUnit({ timeUnitNoun: 'Day' }), 1 / 365, 'day');
  near(yearsPerTimeUnit({ timeUnitNoun: 'hour' }), 1 / 8760, 'hour');
  near(yearsPerTimeUnit({ timeUnitNoun: 'months' }), 1 / 12, 'months');
  near(yearsPerTimeUnit({ timeUnitNoun: 'tick' }), 1, 'a word with no length');
  near(yearsPerTimeUnit(undefined), 1, 'no word');
  near(yearsPerTimeUnit({ timeUnitNoun: 'week' }, { yearsPerTimeUnit: 0.5 }), 0.5, 'the declared length wins');
  near(yearsPerTimeUnit({ timeUnitNoun: 'week' }, { yearsPerTimeUnit: 0 }), 1 / 52, 'a length of 0 is ignored');
});
