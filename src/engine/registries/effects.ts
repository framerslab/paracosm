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
   *   totalToolsForRun       cumulative unique tools over the run
   *                          (innovation index — diminishing returns)
   */
  toolModifiers?: {
    newToolsThisEvent: number;
    reuseCountThisEvent: number;
    forgeFailures: number;
    totalToolsForRun: number;
  };
}

export class EffectRegistry {
  private effects: Record<string, Record<string, number>>;
  private fallback: Record<string, number>;

  constructor(
    categoryEffects: Record<string, Record<string, number>>,
    fallback: Record<string, number> = { morale: 0.08 },
  ) {
    this.effects = categoryEffects;
    this.fallback = fallback;
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

    for (const [key, value] of Object.entries(base)) {
      const raw = value * (multiplier + modifiers.personalityBonus + modifiers.noise + toolBonus);
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
      deltas[k] = Math.round(deltas[k] * 100) / 100;
    }

    return deltas;
  }
}
