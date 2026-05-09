import test from 'node:test';
import assert from 'node:assert/strict';
import { marsRadiationBoneProgression } from '../../../src/engine/physics/index.js';

function makeAgent(overrides: Partial<{
  alive: boolean; marsborn: boolean; boneDensityPct: number;
  cumulativeRadiationMsv: number; birthTime: number; earthContacts: number;
}> = {}) {
  return {
    core: { marsborn: overrides.marsborn ?? false, birthTime: overrides.birthTime ?? 2000 },
    health: {
      alive: overrides.alive ?? true,
      boneDensityPct: overrides.boneDensityPct ?? 100,
      cumulativeRadiationMsv: overrides.cumulativeRadiationMsv ?? 0,
    },
    social: { earthContacts: overrides.earthContacts ?? 5 },
    career: { yearsExperience: 0 },
  } as any;
}

test('marsRadiationBoneProgression accumulates radiation per timeDelta', () => {
  const c = makeAgent();
  marsRadiationBoneProgression({ agents: [c], timeDelta: 1, time: 2036, turn: 1, startTime: 2035, rng: { chance: () => false } as any });
  // MARS_RADIATION_MSV_PER_YEAR = 0.67 * 365 = 244.55
  assert.ok(c.health.cumulativeRadiationMsv > 244 && c.health.cumulativeRadiationMsv < 245);
});

test('marsRadiationBoneProgression degrades bone density', () => {
  const c = makeAgent({ boneDensityPct: 100, birthTime: 2000 });
  marsRadiationBoneProgression({ agents: [c], timeDelta: 1, time: 2036, turn: 1, startTime: 2035, rng: { chance: () => false } as any });
  assert.ok(c.health.boneDensityPct < 100);
  assert.ok(c.health.boneDensityPct >= 50);
});

test('marsRadiationBoneProgression uses slower bone loss rate for Mars-born', () => {
  // Both colonists have same yearsOnMars (1 time) to isolate the lossRate difference
  const earthBorn = makeAgent({ boneDensityPct: 100, birthTime: 2000, marsborn: false });
  const marsBorn = makeAgent({ boneDensityPct: 100, birthTime: 2035, marsborn: true });
  const rng = { chance: () => false } as any;
  marsRadiationBoneProgression({ agents: [earthBorn], timeDelta: 1, time: 2036, turn: 1, startTime: 2035, rng });
  marsRadiationBoneProgression({ agents: [marsBorn], timeDelta: 1, time: 2036, turn: 1, startTime: 2035, rng });
  // Mars-born has slower loss rate (0.003 vs 0.005), both at 1 time on Mars
  assert.ok(marsBorn.health.boneDensityPct > earthBorn.health.boneDensityPct);
});

test('marsRadiationBoneProgression skips dead colonists', () => {
  const c = makeAgent({ alive: false, cumulativeRadiationMsv: 100 });
  marsRadiationBoneProgression({ agents: [c], timeDelta: 1, time: 2036, turn: 1, startTime: 2035, rng: { chance: () => false } as any });
  assert.equal(c.health.cumulativeRadiationMsv, 100);
});

test('marsRadiationBoneProgression does not compound across repeated calls (no exponential decay)', () => {
  // Regression: earlier the hook multiplied current bone density by
  // the per-tick decay factor, which compounded over multiple ticks
  // and produced unrealistically low values. The fix targets a stable
  // ratio against an immutable baseline, so calling the hook twice
  // with the same elapsed time should produce the same result, not
  // two stages of decay.
  const c = makeAgent({ boneDensityPct: 100, birthTime: 2000, marsborn: false });
  const rng = { chance: () => false } as any;
  // First tick: yearsOnMars = 6
  marsRadiationBoneProgression({ agents: [c], timeDelta: 6, time: 2041, turn: 1, startTime: 2035, rng });
  const afterFirst = c.health.boneDensityPct;
  // Second tick at the SAME elapsed time → same target, idempotent
  marsRadiationBoneProgression({ agents: [c], timeDelta: 0, time: 2041, turn: 2, startTime: 2035, rng });
  const afterSecond = c.health.boneDensityPct;
  assert.equal(afterFirst, afterSecond, 'consecutive calls with same elapsed time must converge, not compound');
  // Sanity: linear formula at yearsOnMars=6, rate=0.005, baseline=100
  // → target = 100 * (1 - 0.005 * 6) = 97
  assert.equal(Math.round(afterFirst), 97);
});

test('marsRadiationBoneProgression preserves baseline across ticks (no re-decay of decayed state)', () => {
  const c = makeAgent({ boneDensityPct: 100, birthTime: 2000, marsborn: false });
  const rng = { chance: () => false } as any;
  // 3 separate ticks, each advancing time by 2 years (cumulative 6).
  marsRadiationBoneProgression({ agents: [c], timeDelta: 2, time: 2037, turn: 1, startTime: 2035, rng });
  marsRadiationBoneProgression({ agents: [c], timeDelta: 2, time: 2039, turn: 2, startTime: 2035, rng });
  marsRadiationBoneProgression({ agents: [c], timeDelta: 2, time: 2041, turn: 3, startTime: 2035, rng });
  // Final result should equal the single-call result for yearsOnMars=6.
  // Linear: 100 * (1 - 0.005 * 6) = 97. Compounding bug would give
  // 100 * 0.99 * 0.985 * 0.97 ≈ 94.7, demonstrably different.
  assert.equal(Math.round(c.health.boneDensityPct), 97);
});

test('marsRadiationBoneProgression saturates after 20 years on Mars', () => {
  const c = makeAgent({ boneDensityPct: 100, birthTime: 2000, marsborn: false });
  const rng = { chance: () => false } as any;
  // 30 years on Mars — well past the 20-year saturation.
  marsRadiationBoneProgression({ agents: [c], timeDelta: 30, time: 2065, turn: 1, startTime: 2035, rng });
  // Capped at 1 - 0.005 * 20 = 0.9 → 90% of baseline.
  assert.equal(Math.round(c.health.boneDensityPct), 90);
});
