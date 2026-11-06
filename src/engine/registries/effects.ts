import type { EffectDefinition, MetricDefinition } from '../types.js';

/** Possible outcome classifications for a simulation turn. */
export type TurnOutcome = 'risky_success' | 'risky_failure' | 'conservative_success' | 'conservative_failure';

const OUTCOME_MULTIPLIERS: Record<TurnOutcome, number> = {
  risky_success: 2.5,
  risky_failure: -2.0,
  conservative_success: 1.0,
  conservative_failure: -1.0,
};

export interface OutcomeModifiers {
  personalityBonus: number;
  noise: number;
  /**
   * Tool intelligence factor. Forging computational tools is a tradeoff:
   *   newToolsThisEvent      tools forged THIS event (consume time/compute,
   *                          rejection risk, but enable insight)
   *   reuseCountThisEvent    invocations of previously-forged tools
   *                          (cheap, pure upside — institutional knowledge)
   *   forgeFailures          failed forge attempts this event (judge
   *                          rejected — wasted department effort)
   *   totalToolsForRun       the run's approved tools so far, each once;
   *                          a forge rejected on every try is none
   *                          (innovation index — diminishing returns)
   */
  toolModifiers?: {
    newToolsThisEvent: number;
    reuseCountThisEvent: number;
    forgeFailures: number;
    totalToolsForRun: number;
  };
}

/** How a registry reads its tables. */
export interface EffectRegistryOptions {
  /**
   * The keys that are better lower (a scenario metric declared
   * `better: 'lower'`, such as a spec-gaming rate or a burn rate). A
   * positive entry on one of these is harmful; on any other key a
   * negative entry is.
   */
  lowerIsBetter?: Iterable<string>;
}

/**
 * The outcome step's effect tables.
 *
 * A category table lists what an event brings at an ordinary response
 * (a conservative success). Each entry is helpful or harmful by its sign
 * and its key's direction. Where `e` is the outcome's multiplier (2.5 for
 * a risky success, 1 for a conservative success, -1 for a conservative
 * failure, -2 for a risky failure) plus the personality, noise and tool
 * modifiers:
 *
 * - a helpful entry `v` moves by `v * e`: 2.5v, v, -v and -2v at no
 *   modifier. A failed response loses what a good one would have gained.
 * - a harmful entry `v` moves by `v * max(0, 2 - e)`: 0, v, 3v and 4v. It
 *   is what the event costs, so it stays a cost: a better response makes it
 *   smaller, down to nothing, and a failed one makes it larger, by as much as
 *   a helpful entry falls.
 * - a harmful entry in a table that adds people (a positive `population`)
 *   is the cost of those people, a payroll, and moves by `v * e` with them.
 */
export class EffectRegistry {
  private effects: Record<string, Record<string, number>>;
  private fallback: Record<string, number>;
  private lowerIsBetter: Set<string>;

  constructor(
    categoryEffects: Record<string, Record<string, number>>,
    fallback: Record<string, number> = { morale: 0.08 },
    options: EffectRegistryOptions = {},
  ) {
    this.effects = categoryEffects;
    this.fallback = fallback;
    this.lowerIsBetter = new Set(options.lowerIsBetter ?? []);
  }

  /**
   * The registry a scenario's run applies: its category table, read
   * with the directions its metrics declare (`better: 'lower'`, keyed by
   * the last part of the metric's `source`, or its id). A metric with
   * neither as a string names no key and is skipped: custom scenarios
   * load with any metrics array.
   */
  static forScenario(scenario: { effects?: EffectDefinition[]; metrics?: MetricDefinition[] }): EffectRegistry {
    const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    const lowerIsBetter = (Array.isArray(scenario.metrics) ? scenario.metrics : [])
      .filter(m => m && m.better === 'lower')
      .map(m => (text(m.source) ?? text(m.id))?.split('.').pop())
      .filter((key): key is string => !!key);
    return new EffectRegistry(scenario.effects?.[0]?.categoryDefaults ?? {}, undefined, { lowerIsBetter });
  }

  /** Whether an entry of a table is harmful: a fall on a key better higher, a rise on one better lower. */
  isHarmful(key: string, value: number): boolean {
    return this.lowerIsBetter.has(key) ? value > 0 : value < 0;
  }

  getBaseEffect(category: string): Record<string, number> {
    return this.effects[category] ?? { ...this.fallback };
  }

  applyOutcome(
    category: string,
    outcome: TurnOutcome,
    modifiers: OutcomeModifiers,
  ): Record<string, number> {
    const base = this.getBaseEffect(category);
    const multiplier = OUTCOME_MULTIPLIERS[outcome];
    const deltas: Record<string, number> = {};

    // Tool bonus: net effect of department's emergent capabilities on
    // this turn's outcome magnitude. Tradeoff design — tools are not
    // free upside.
    //   +0.04 per new tool forged (capability unlocked)
    //   +0.02 per reuse (proven model applied; institutional knowledge)
    //   -0.06 per failed forge (judge rejected; wasted dept attention)
    //   +log-scaled run-wide bonus (diminishing returns past ~10 tools)
    // Saturated at ±0.5 so a tool-happy department can't dominate the
    // base outcome+personality signal.
    const tm = modifiers.toolModifiers;
    const toolBonus = tm
      ? Math.max(-0.5, Math.min(0.5,
          tm.newToolsThisEvent * 0.04
          + tm.reuseCountThisEvent * 0.02
          - tm.forgeFailures * 0.06
          + (tm.totalToolsForRun > 0 ? Math.log(1 + tm.totalToolsForRun) * 0.03 : 0),
        ))
      : 0;

    // How well the response went; see the class comment for what it does
    // to a helpful and to a harmful entry.
    const effective = multiplier + modifiers.personalityBonus + modifiers.noise + toolBonus;
    const addsPeople = (base.population ?? 0) > 0;
    for (const [key, value] of Object.entries(base)) {
      const cost = !addsPeople && this.isHarmful(key, value);
      const raw = value * (cost ? Math.max(0, 2 - effective) : effective);
      deltas[key] = Math.round(raw * 100) / 100;
    }

    // Tool forging consumes real resources. Subtract small flat costs so
    // a forge-everything strategy can backfire on power budgets and
    // morale (analyst fatigue). Costs scale with new+failed forges only;
    // reusing an existing tool is essentially free.
    if (tm) {
      const forgeCost = tm.newToolsThisEvent + tm.forgeFailures;
      if (forgeCost > 0) {
        // Power: every forged tool runs in an in-process node:vm context.
        if (deltas.powerKw !== undefined || base.powerKw !== undefined) {
          deltas.powerKw = (deltas.powerKw ?? 0) - forgeCost * 1.2;
        } else {
          deltas.powerKw = -forgeCost * 1.2;
        }
        // Morale dip from analyst overhead — small but real
        if (forgeCost >= 3) {
          deltas.morale = (deltas.morale ?? 0) - 0.01 * forgeCost;
        }
        // Failed forges sting morale extra — wasted effort + shake confidence
        if (tm.forgeFailures > 0) {
          deltas.morale = (deltas.morale ?? 0) - 0.015 * tm.forgeFailures;
        }
      }
    }

    // Round all deltas to 2 dp after potential cost adjustments
    for (const k of Object.keys(deltas)) {
      // `|| 0`: a cost a response contained is 0, never -0.
      deltas[k] = Math.round(deltas[k] * 100) / 100 || 0;
    }

    return deltas;
  }
}
