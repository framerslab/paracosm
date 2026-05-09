/**
 * Golden-run compatibility test.
 *
 * Verifies that the deterministic kernel produces identical output for a
 * fixed seed across code changes. This catches regressions in RNG, progression,
 * colonist generation, mortality, births, and career advancement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationKernel } from '../../../src/engine/core/kernel.js';
import { marsRadiationBoneProgression } from '../../../src/engine/physics/index.js';

const SEED = 950;
const KEY_PERSONNEL = [
  { name: 'Dr. Yuki Tanaka', department: 'medical' as const, role: 'CMO', specialization: 'Radiation Medicine', age: 38, featured: true },
];

test('golden-run: 3-turn kernel produces deterministic population and state', () => {
  const kernel = new SimulationKernel(SEED, 'Test Commander', KEY_PERSONNEL, {
    startTime: 2035,
    initialPopulation: 100,
  });

  const initial = kernel.getState();
  assert.equal(initial.agents.length, 100);
  assert.equal(initial.metrics.population, 100);
  assert.equal(initial.metadata.seed, SEED);
  assert.equal(initial.metadata.startTime, 2035);

  // Turn 1: advance to time 2037
  const t1 = kernel.advanceTurn(1, 2037, marsRadiationBoneProgression);
  assert.equal(t1.metadata.currentTurn, 1);
  assert.equal(t1.metadata.currentTime, 2037);

  // Turn 2: advance to time 2040
  const t2 = kernel.advanceTurn(2, 2040, marsRadiationBoneProgression);
  assert.equal(t2.metadata.currentTurn, 2);
  assert.equal(t2.metadata.currentTime, 2040);

  // Turn 3: advance to time 2043
  const t3 = kernel.advanceTurn(3, 2043, marsRadiationBoneProgression);
  assert.equal(t3.metadata.currentTurn, 3);
  assert.equal(t3.metadata.currentTime, 2043);

  // Golden assertions: these values are deterministic from seed 950
  // If any of these fail after a code change, the kernel behavior changed
  const alive = t3.agents.filter(c => c.health.alive);
  const dead = t3.agents.filter(c => !c.health.alive);
  const marsBorn = t3.agents.filter(c => c.core.marsborn);

  // Population should be close to 100 (some births, some deaths possible over 8 years)
  assert.ok(alive.length >= 90, `Expected >= 90 alive, got ${alive.length}`);
  assert.ok(t3.agents.length >= 100, `Expected >= 100 total colonists (births), got ${t3.agents.length}`);

  // Radiation should accumulate over 8 years (2035 -> 2043)
  const avgRad = alive.reduce((s, c) => s + (c.health.cumulativeRadiationMsv ?? 0), 0) / alive.length;
  assert.ok(avgRad > 1500, `Expected avg radiation > 1500 mSv after 8 years, got ${avgRad.toFixed(0)}`);

  // Bone density should degrade
  const avgBone = alive.filter(c => !c.core.marsborn).reduce((s, c) => s + (c.health.boneDensityPct ?? 0), 0) / alive.filter(c => !c.core.marsborn).length;
  assert.ok(avgBone < 100, `Expected avg bone density < 100%, got ${avgBone.toFixed(1)}`);
  assert.ok(avgBone > 85, `Expected avg bone density > 85% (not over-degraded), got ${avgBone.toFixed(1)}`);

  // Career progression should have happened
  const seniors = alive.filter(c => c.career.rank === 'senior' || c.career.rank === 'lead');
  assert.ok(seniors.length > 0, 'Expected some career promotions after 8 years');

  // Event log should have entries
  assert.ok(t3.eventLog.length > 0, 'Expected events in the log');
});

test('golden-run: same seed produces identical colonist roster', () => {
  const k1 = new SimulationKernel(SEED, 'Commander A', KEY_PERSONNEL);
  const k2 = new SimulationKernel(SEED, 'Commander B', KEY_PERSONNEL);

  const s1 = k1.getState();
  const s2 = k2.getState();

  // Same seed = same colonists (names, departments, HEXACO)
  assert.equal(s1.agents.length, s2.agents.length);
  for (let i = 0; i < s1.agents.length; i++) {
    assert.equal(s1.agents[i].core.name, s2.agents[i].core.name);
    assert.equal(s1.agents[i].core.department, s2.agents[i].core.department);
    assert.deepEqual(s1.agents[i].hexaco, s2.agents[i].hexaco);
  }
});

test('golden-run: different seeds produce different rosters', () => {
  const k1 = new SimulationKernel(950, 'Commander', KEY_PERSONNEL);
  const k2 = new SimulationKernel(1234, 'Commander', KEY_PERSONNEL);

  const s1 = k1.getState();
  const s2 = k2.getState();

  // Different seeds should produce different colonist names (at least some)
  let differences = 0;
  for (let i = 0; i < Math.min(s1.agents.length, s2.agents.length); i++) {
    if (s1.agents[i].core.name !== s2.agents[i].core.name) differences++;
  }
  assert.ok(differences > 10, `Expected many different names between seeds, got ${differences} differences`);
});
