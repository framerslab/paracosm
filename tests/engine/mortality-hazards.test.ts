/**
 * A turn's chance of each death, from the yearly rates (#184).
 *
 * A yearly rate holds over every year a turn spans, so a turn of `years`
 * years gives `1 - (1 - pYear)^years`, with no cap per turn. Radiation
 * cancer is an excess hazard of 0.004 a year for each sievert above 0.5.
 * The age and accident rates divide by the colony's supply level, held
 * within a half and double (#234). The functions are the ones
 * `progressBetweenTurns` rolls against.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { causeHazards, supplyLevel, supplyRateFactor, turnHazard } from '../../src/engine/core/progression.js';
import type { Agent } from '../../src/engine/core/state.js';

function near(actual: number, expected: number, label: string, tolerance = 5e-4): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `${label}: expected ${expected}, got ${actual}`);
}

function person(health: Partial<Agent['health']> = {}, department = 'science'): Agent {
  return {
    core: { id: 'col-test', name: 'Test Person', birthTime: 0, marsborn: false, department, role: 'Specialist' },
    health: { alive: true, psychScore: 0.7, conditions: [], ...health },
    career: { specialization: 'Test', yearsExperience: 10, rank: 'senior', achievements: [] },
    social: { childrenIds: [], friendIds: [], earthContacts: 3 },
    narrative: { lifeEvents: [], featured: false },
    hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
    hexacoHistory: [],
    memory: { shortTerm: [], longTerm: [], stances: {}, relationships: {} },
  } as unknown as Agent;
}

test('a yearly rate compounds over the years a turn spans', () => {
  near(turnHazard(0.01, 8), 0.0773, 'natural at 65 over eight years');
  near(turnHazard(0.10, 8), 0.5695, 'ten percent a year over eight years');
  assert.equal(turnHazard(0.25, 0), 0, 'a turn with no time has no hazard');
  near(turnHazard(0.08, 1 / 12), 1 - Math.pow(0.92, 1 / 12), 'a month');
});

test('radiation cancer rises with the dose above half a sievert', () => {
  const metrics = { population: 30, morale: 0.8 };
  near(causeHazards(person({ cumulativeRadiationMsv: 2000 }), metrics, 40, 8).radiation, 0.047, '2000 mSv over eight years');
  near(causeHazards(person({ cumulativeRadiationMsv: 4000 }), metrics, 40, 8).radiation, 0.107, '4000 mSv over eight years');
  assert.equal(causeHazards(person({ cumulativeRadiationMsv: 400 }), metrics, 40, 8).radiation, 0, '400 mSv');
  assert.equal(causeHazards(person({ cumulativeRadiationMsv: 4000 }), metrics, 25, 8).radiation, 0, 'under 30');
});

test('each cause reads its own part of the person and the world', () => {
  const fed = { population: 30, morale: 0.8, foodMonthsReserve: 12 };
  const hungry = { population: 30, morale: 0.8, foodMonthsReserve: 0.2 };
  const h = causeHazards(person({ psychScore: 0.1, boneDensityPct: 50 }, 'engineering'), fed, 65, 8);
  near(h.natural, turnHazard(0.01, 8), 'natural at 65');
  near(h.despair, turnHazard(0.1 * 0.25 * 1.0, 8), 'despair at psych 0.1');
  near(h.fracture, turnHazard(10 * 0.003, 8), 'fracture at 50 percent bone');
  near(h.accident, turnHazard(0.003 * 1.5, 8), 'an engineer\'s accident');
  assert.equal(h.starvation, 0, 'a fed colony');
  near(causeHazards(person(), hungry, 40, 8).starvation, turnHazard(0.8 * 0.15, 8), 'a hungry colony');
});

test('the age and accident rates divide by the supply level, within a half and double', () => {
  assert.equal(supplyRateFactor(1), 1, 'landing day');
  assert.equal(supplyRateFactor(0.25), 2, 'a quarter of landing day, held at double');
  assert.equal(supplyRateFactor(4), 0.5, 'four times landing day, held at a half');
  assert.equal(supplyRateFactor(0), 2, 'nothing left');
  near(supplyRateFactor(0.8), 1.25, 'a fifth under', 1e-12);
});

test('the supply level is the geometric mean of each supply against its landing-day amount', () => {
  const landing = { lifeSupportCapacity: 120, waterLitersPerDay: 800, powerKw: 400, pressurizedVolumeM3: 3000, infrastructureModules: 3 };
  assert.equal(supplyLevel({ population: 30, ...landing }, undefined), 1, 'a run with no landing amounts');
  assert.equal(supplyLevel({ population: 30, ...landing }, landing), 1, 'landing day, exactly');
  const doubled = Object.fromEntries(Object.entries(landing).map(([k, v]) => [k, 2 * v]));
  near(supplyLevel(doubled, landing), 2, 'every supply at twice landing', 1e-12);
  near(supplyLevel({ ...landing, waterLitersPerDay: 3200, powerKw: 100 }, landing), 1, 'four times one supply, a quarter of another', 1e-12);
  assert.equal(supplyRateFactor(supplyLevel({ ...landing, waterLitersPerDay: 0 }, landing)), 2, 'one of five at zero');
  // A supply the run does not hold as a number is left out of the mean.
  near(supplyLevel({ powerKw: 800 }, { powerKw: 400, waterLitersPerDay: 800 }), 2, 'only power held', 1e-12);
});

test('a supply factor scales the natural and accident chances and leaves the other causes as they were', () => {
  const metrics = { population: 30, morale: 0.8, foodMonthsReserve: 0.2 };
  const p = person({ psychScore: 0.1, boneDensityPct: 50, cumulativeRadiationMsv: 2000 }, 'engineering');
  const base = causeHazards(p, metrics, 65, 1);
  const short = causeHazards(p, metrics, 65, 1, 2);
  near(base.natural, 0.01, 'natural at 65 over a year', 1e-12);
  near(short.natural, 0.02, 'natural at 65 over a year, at a factor of 2', 1e-12);
  near(base.accident, 0.0045, 'an engineer\'s accident over a year', 1e-12);
  near(short.accident, 0.009, 'an engineer\'s accident over a year, at a factor of 2', 1e-12);
  for (const cause of ['radiation', 'starvation', 'despair', 'fracture'] as const) {
    assert.ok(base[cause] > 0, `${cause} has a chance here`);
    assert.equal(short[cause], base[cause], cause);
  }
  assert.deepEqual(causeHazards(p, metrics, 65, 8, 1), causeHazards(p, metrics, 65, 8), 'a factor of 1 is no factor');
});
