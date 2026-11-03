/**
 * A turn's chance of each death, from the yearly rates (#184).
 *
 * A yearly rate holds over every year a turn spans, so a turn of `years`
 * years gives `1 - (1 - pYear)^years`, with no cap per turn. Radiation
 * cancer is an excess hazard of 0.004 a year for each sievert above 0.5.
 * The functions are the ones `progressBetweenTurns` rolls against.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { causeHazards, turnHazard } from '../../src/engine/core/progression.js';
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
