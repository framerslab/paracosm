/**
 * Lunar per-agent progression physics.
 *
 * Walks the agent population each between-turn tick and applies
 * cumulative regolith dust exposure plus muscle/bone atrophy under
 * 1/6g. The atrophy curve is steeper than Mars (0.04/yr vs 0.005/yr)
 * to reflect the lower partial gravity, saturates after 15 years at
 * 40% bone density (the floor), and is calibrated so the curve hits
 * the floor exactly at the saturation horizon.
 *
 * Generic and reusable — any scenario set on the lunar surface can
 * opt into it via `dataDrivenHooks.progressionPhysics:
 * 'lunar-regolith-atrophy'`.
 *
 * @module paracosm/engine/physics/lunar-regolith-atrophy
 */
import type { ProgressionHookContext } from '../types.js';

/** Lunar regolith dust toxicity index — arbitrary annualized units. */
const LUNAR_REGOLITH_EXPOSURE_PER_YEAR = 45;

/**
 * The share of the exposure that reaches a crew member: each habitat
 * module keeps out a fifth of the surface exposure, at most nine tenths
 * in all. The Moon keeps this curve of its own; Mars's shielding
 * (`habitatDoseShare` in `mars-radiation-bone.ts`) has no stop. A run
 * that carries no module count is unshielded.
 */
function lunarExposureShare(metrics?: Readonly<Record<string, unknown>>): number {
  const modules = metrics?.infrastructureModules;
  return typeof modules === 'number' && Number.isFinite(modules)
    ? 1 - Math.min(0.9, 0.2 * Math.max(0, modules))
    : 1;
}

/**
 * Walk the agent roster, accumulate regolith dust exposure (stored on
 * the same `cumulativeRadiationMsv` field for kernel uniformity),
 * and apply muscle/bone atrophy. The 0.04/yr loss rate is steeper
 * than Mars to reflect 1/6g vs 0.38g; saturates at 15 years on the
 * Moon and floors at 40% bone density.
 *
 * Decay is applied as a target ratio against an immutable baseline
 * captured on the first call (default 100 — Earth-transferee crew).
 * Earlier versions multiplied the current bone density by the per-
 * tick decay factor, which compounded exponentially and produced
 * unrealistically low values by mid-run. The fix sets
 * `boneDensityPct = baseline * targetRatio` each tick where
 * `targetRatio` is purely a function of `yearsOnMoon` — consecutive
 * calls with the same elapsed time converge to the same target
 * instead of compounding.
 */
export function lunarRegolithAtrophyProgression(ctx: ProgressionHookContext): void {
  const { agents, timeDelta, time, startTime } = ctx;
  // The step and the time since landing in years (a hook called without
  // them counts in years, as the Moon does).
  const yearsDelta = ctx.yearsDelta ?? timeDelta;
  const yearsSinceStart = ctx.yearsSinceStart ?? (time - startTime);
  // A declared surface dose (mSv a day) replaces the default index; the
  // habitat's modules shield either, on the Moon's own curve.
  const declared = ctx.environment?.surfaceRadiationMsvDay;
  const perYear = typeof declared === 'number' && Number.isFinite(declared) ? Math.max(0, declared) * 365 : LUNAR_REGOLITH_EXPOSURE_PER_YEAR;
  const exposurePerYear = perYear * lunarExposureShare(ctx.metrics);

  for (const c of agents) {
    if (!c.health.alive) continue;

    c.health.cumulativeRadiationMsv =
      (c.health.cumulativeRadiationMsv ?? 0) + exposurePerYear * yearsDelta;

    // Snapshot the immutable baseline on the first call so the decay
    // curve always targets the agent's original bone density rather
    // than recursively re-decaying its own output.
    if (c.health.boneDensityBase == null) {
      c.health.boneDensityBase = c.health.boneDensityPct ?? 100;
    }
    const baseline = c.health.boneDensityBase as number;

    // 1/6g atrophy rate calibrated so the curve reaches the documented
    // 40% floor exactly at the 15-year saturation horizon: 1 - 0.04 *
    // 15 = 0.4. The earlier value 0.008 only decayed to 88% over 15
    // years, leaving the floor mathematically unreachable and the
    // physics far gentler than the documented "1/6g atrophy is steeper
    // than Mars 0.38g" intent.
    const lossRate = 0.04;
    // Clamp elapsed time at zero — replays from a captured snapshot
    // can produce time < startTime briefly during fork setup, which
    // would otherwise produce a targetRatio > 1 and drive bone density
    // above baseline. The min(yearsOnMoon, 15) handles the upper end
    // (saturation); Math.max(0, ...) handles the lower end (no-op
    // before crew lands).
    const yearsOnMoon = Math.max(0, yearsSinceStart);
    const targetRatio = Math.max(0.4, 1 - lossRate * Math.min(yearsOnMoon, 15));
    // Floor at 40% but never above the immutable baseline — guards
    // the theoretical case where an agent starts with bone density
    // below 40 (the Math.max would otherwise force it back up to 40,
    // exceeding their starting state).
    c.health.boneDensityPct = Math.min(baseline, Math.max(40, baseline * targetRatio));
  }
}
