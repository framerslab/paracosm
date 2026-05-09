import test from 'node:test';
import assert from 'node:assert/strict';
import { SeededRng } from '../../../src/engine/core/rng.js';
import { progressBetweenTurns } from '../../../src/engine/core/progression.js';
import { marsRadiationBoneProgression } from '../../../src/engine/physics/index.js';

const makeState = (overrides: any = {}) => ({
  metadata: {
    simulationId: 'sim-1', leaderId: 'Commander', seed: 950,
    startTime: 2042, currentTime: 2043, currentTurn: 1,
  },
  metrics: {
    population: 1, powerKw: 400, foodMonthsReserve: 18,
    waterLitersPerDay: 800, pressurizedVolumeM3: 3000,
    lifeSupportCapacity: 120, infrastructureModules: 3,
    scienceOutput: 0, morale: 0.85,
  },
  agents: [{
    core: { id: 'col-1', name: 'Alex Rivera', birthTime: 2020, marsborn: false, department: 'science', role: 'Analyst' },
    hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
    hexacoHistory: [],
    health: { alive: true, cumulativeRadiationMsv: 0, boneDensityPct: 100, psychScore: 0.8, conditions: [] },
    career: { yearsExperience: 2, specialization: 'Operations', rank: 'junior', achievements: [] },
    social: { earthContacts: 2, childrenIds: [], friendIds: [] },
    narrative: { featured: false, lifeEvents: [] },
    memory: { shortTerm: [], longTerm: [], stances: {}, relationships: {} },
  }],
  politics: { earthDependencyPct: 95, governanceStatus: 'earth-governed', independencePressure: 0.05 },
  eventLog: [],
  ...overrides,
});

test('progressBetweenTurns with Mars hook applies radiation and bone density', () => {
  const { state } = progressBetweenTurns(makeState() as any, 1, new SeededRng(950), marsRadiationBoneProgression);
  assert.equal(state.agents[0].health.boneDensityPct, 99.5);
  assert.ok((state.agents[0]!.health.cumulativeRadiationMsv ?? 0) > 200);
});

test('progressBetweenTurns without hook does not apply radiation or bone density', () => {
  const { state } = progressBetweenTurns(makeState() as any, 1, new SeededRng(950));
  assert.equal(state.agents[0].health.boneDensityPct, 100);
  assert.equal(state.agents[0].health.cumulativeRadiationMsv, 0);
});

test('progressBetweenTurns still ages colonists and progresses careers without hook', () => {
  const { state } = progressBetweenTurns(makeState() as any, 1, new SeededRng(950));
  assert.equal(state.agents[0].career.yearsExperience, 3);
});
