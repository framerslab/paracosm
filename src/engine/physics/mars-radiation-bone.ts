/**
 * Mars per-agent progression physics.
 *
 * Walks the agent population each between-turn tick and applies two
 * cumulative health changes that the data-driven-hooks DSL cannot
 * express in pure JSON: cumulative radiation dose (annualized, scaled
 * by the turn's time delta) and bone-density decay with an
 * archetype-conditional rate that asymptotes after ~20 years.
 *
 * This module is **generic and reusable** — any scenario set on Mars
 * (or any radiation-exposed surface with similar parameters) can opt
 * into it from JSON via `dataDrivenHooks.progressionPhysics:
 * 'mars-radiation-bone'`. It is NOT a scenario.
 *
 * @module paracosm/engine/physics/mars-radiation-bone
 */
import type { ProgressionHookContext } from '../types.js';

/** Mars surface radiation, mSv a day, when the scenario declares none
 *  (`world.environment.surfaceRadiationMsvDay`). */
const MARS_SURFACE_MSV_PER_DAY = 0.67;

/**
 * The share of a surface dose that reaches a colonist: each habitat
 * module keeps out a fifth, at most nine tenths in all. A run that
 * carries no module count is unshielded.
 */
export function habitatDoseShare(metrics?: Readonly<Record<string, unknown>>): number {
  const modules = metrics?.infrastructureModules;
  if (!(typeof modules === 'number' && Number.isFinite(modules))) return 1;
  const m = Math.max(0, modules);
  if (shieldMeasurement.curve === 'fifth-of-rest') return Math.pow(0.8, m);
  if (shieldMeasurement.curve === 'match-at-4') return Math.pow(0.2, m / 4);
  return 1 - Math.min(0.9, 0.2 * m);
}

/** Measurement switch for #221, this branch only: the shielding curve. */
export const shieldMeasurement: { curve: 'cap' | 'fifth-of-rest' | 'match-at-4' } = { curve: 'cap' };

/**
 * Walk the agent roster, accumulate radiation dose, and apply bone-
 * density decay. Mars-born agents decay slower (0.003/yr) than
 * Earth-born transferees (0.005/yr); both saturate at 20 years on
 * Mars and floor at 50% so the kernel never produces non-physical
 * negative bone density.
 *
 * Decay is applied as a target ratio against an immutable baseline
 * captured on the first call (default 88 for Mars-born, 100 for
 * Earth-born — matching `agent-generator.ts`). Earlier versions
 * multiplied the current bone density by the per-tick decay factor,
 * which compounded exponentially and produced unrealistically low
 * values by turn 6. The fix sets `boneDensityPct = baseline *
 * targetRatio` each tick, where `targetRatio` is purely a function of
 * `yearsOnMars` — so consecutive calls with the same elapsed time
 * converge to the same target instead of compounding.
 */
export function marsRadiationBoneProgression(ctx: ProgressionHookContext): void {
  const { agents, timeDelta, time, startTime } = ctx;
  // The step and the time since landing in years (a hook called without
  // them counts in years, as Mars does).
  const yearsDelta = ctx.yearsDelta ?? timeDelta;
  const yearsPerUnit = ctx.yearsPerUnit ?? 1;
  const yearsSinceStart = ctx.yearsSinceStart ?? (time - startTime);
  const declared = ctx.environment?.surfaceRadiationMsvDay;
  // A dose is never negative: a declared rate under zero counts as none.
  const surfacePerDay = typeof declared === 'number' && Number.isFinite(declared) ? Math.max(0, declared) : MARS_SURFACE_MSV_PER_DAY;
  const dosePerYear = surfacePerDay * 365 * habitatDoseShare(ctx.metrics);

  for (const c of agents) {
    if (!c.health.alive) continue;

    c.health.cumulativeRadiationMsv =
      (c.health.cumulativeRadiationMsv ?? 0) + dosePerYear * yearsDelta;

    // Snapshot the immutable baseline on the first call so the decay
    // curve always targets the agent's original bone density rather
    // than recursively re-decaying its own output.
    if (c.health.boneDensityBase == null) {
      c.health.boneDensityBase = c.health.boneDensityPct ?? (c.core.marsborn ? 88 : 100);
    }
    const baseline = c.health.boneDensityBase as number;

    const lossRate = c.core.marsborn ? 0.003 : 0.005;
    // Clamp elapsed time at zero — fork-from-artifact replays can
    // briefly produce time < startTime during snapshot rehydration,
    // which would otherwise yield a targetRatio > 1 and push bone
    // density above the immutable baseline.
    const yearsOnMars = Math.max(0, c.core.marsborn ? (time - c.core.birthTime) * yearsPerUnit : yearsSinceStart);
    const targetRatio = Math.max(0.5, 1 - lossRate * Math.min(yearsOnMars, 20));
    // Floor at 50% but never above the immutable baseline — guards
    // the theoretical case where an agent starts with bone density
    // below 50 (the Math.max would otherwise force it back up to 50,
    // exceeding their starting state).
    c.health.boneDensityPct = Math.min(baseline, Math.max(50, baseline * targetRatio));
  }
}
