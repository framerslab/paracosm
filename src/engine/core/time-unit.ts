/**
 * How long a scenario's time unit is, in years.
 *
 * A scenario counts time in its own unit (`labels.timeUnitNoun`): Mars
 * in years, Atlas Lab in months, the Digital Twin in weeks. The kernel's
 * ages and yearly rates are in years, so between turns it converts the
 * elapsed units to years with this factor.
 *
 * @module paracosm/engine/core/time-unit
 */

/** Years in one unit, by the singular or plural word a scenario names it with. */
const YEARS_PER_WORD: Readonly<Record<string, number>> = {
  year: 1,
  quarter: 1 / 4,
  month: 1 / 12,
  week: 1 / 52,
  day: 1 / 365,
  hour: 1 / 8760,
};

/**
 * Years in one of the scenario's time units: `setup.yearsPerTimeUnit`
 * when it declares a positive number, else the length of the unit
 * `labels.timeUnitNoun` names, else 1 (a "tick" or "turn" has no length,
 * so it counts as a year, as every unit did before units had lengths).
 */
export function yearsPerTimeUnit(
  labels?: { timeUnitNoun?: string } | null,
  setup?: { yearsPerTimeUnit?: number } | null,
): number {
  const declared = setup?.yearsPerTimeUnit;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) return declared;
  const word = (labels?.timeUnitNoun ?? '').trim().toLowerCase();
  return YEARS_PER_WORD[word] ?? YEARS_PER_WORD[word.replace(/s$/, '')] ?? 1;
}

/**
 * `units` of the scenario's time in years, rounded to a nanoyear so twelve
 * months come out as exactly one year and an age gate (18, 60) compares
 * the same whatever unit the run counts in.
 */
export function unitsToYears(units: number, yearsPerUnit: number): number {
  return Math.round(units * yearsPerUnit * 1e9) / 1e9;
}

/** A person's age in years at `time`, the scenario's time. */
export function ageInYears(agent: { core: { birthTime: number } }, time: number, yearsPerUnit: number): number {
  return unitsToYears(time - agent.core.birthTime, yearsPerUnit);
}
