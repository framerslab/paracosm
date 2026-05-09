import { useMemo } from 'react';
import { useScenarioContext } from '../App.js';
import { deriveLabels, type ScenarioLabels, type ScenarioLabelsInput } from './useScenarioLabels.helpers.js';

/**
 * Single source of truth for scenario-specific noun variants used in
 * user-facing UI copy. Reads `scenario.labels.populationNoun`,
 * `settlementNoun`, and `timeUnitNoun` (defaults: "colonists" /
 * "colony" / "tick") and derives capitalized + singular + plural
 * variants.
 *
 * Scenario authors override nouns via `labels.populationNoun` (plural,
 * e.g. "crew" / "citizens" / "operators"), `labels.settlementNoun`
 * (singular, e.g. "habitat" / "kingdom" / "station"), and
 * `labels.timeUnitNoun` (singular, e.g. "year" / "day" / "quarter" /
 * "tick"). The plural form of `timeUnitNoun` is usually auto-derived
 * via `pluralize` but can be specified explicitly via
 * `labels.timeUnitNounPlural` for irregulars ("century" -> "centuries").
 *
 * Why a hook + not a raw string: many UI surfaces need the same noun
 * in 4 variants (one crew, crew members, Crew, crew). Centralizing the
 * capitalization + pluralization here keeps copy consistent and
 * avoids cluttering each consumer with the same boilerplate.
 *
 * Pure derivation lives in `./useScenarioLabels.helpers.ts` for unit
 * testability. The hook here is a thin `useMemo` wrapper over
 * `deriveLabels`.
 */
export function useScenarioLabels(): ScenarioLabels {
  const scenario = useScenarioContext();
  return useMemo(() => deriveLabels(scenario as ScenarioLabelsInput), [
    scenario.labels?.populationNoun,
    scenario.labels?.settlementNoun,
    (scenario.labels as { timeUnitNoun?: string } | undefined)?.timeUnitNoun,
    (scenario.labels as { timeUnitNounPlural?: string } | undefined)?.timeUnitNounPlural,
  ]);
}

export type { ScenarioLabels };
