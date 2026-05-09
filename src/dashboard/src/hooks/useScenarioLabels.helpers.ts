/**
 * Pure helpers behind `useScenarioLabels`. Split out of the hook so the
 * derivation logic can be unit-tested without pulling in
 * `useScenarioContext` (which transitively imports React components +
 * SCSS modules that node:test/tsx cannot resolve).
 *
 * The hook at `./useScenarioLabels.ts` is a thin `useMemo` wrapper over
 * `deriveLabels`.
 */

/** Variant bundle for a scenario's user-facing nouns. Everything the
 *  dashboard's copy surface needs, derived once per scenario load. */
export interface ScenarioLabels {
  /** Plural lower-case population noun (e.g. "colonists", "crew"). */
  people: string;
  /** Singular lower-case population noun (e.g. "colonist", "crew member"). */
  person: string;
  /** Capitalized plural ("Colonists", "Crew"). */
  People: string;
  /** Capitalized singular ("Colonist", "Crew member"). */
  Person: string;
  /** Singular lower-case settlement noun (e.g. "colony", "habitat"). */
  place: string;
  /** Plural lower-case settlement noun (e.g. "colonies", "habitats"). */
  places: string;
  /** Capitalized singular ("Colony"). */
  Place: string;
  /** Capitalized plural ("Colonies"). */
  Places: string;
  /** Singular lower-case time-unit noun (e.g. "year", "day", "quarter", "tick"). */
  time: string;
  /** Plural lower-case time-unit noun (e.g. "years", "days", "quarters", "ticks"). */
  times: string;
  /** Capitalized singular ("Year", "Day", "Quarter", "Tick"). */
  Time: string;
  /** Capitalized plural ("Years", "Days", "Quarters", "Ticks"). */
  Times: string;
}

/**
 * Loose scenario-like shape `deriveLabels` accepts. A thin subset of
 * the full `ScenarioPackage` so the derivation can be called from
 * tests that don't want to import the entire engine.
 */
export interface ScenarioLabelsInput {
  labels?: {
    populationNoun?: string;
    settlementNoun?: string;
    timeUnitNoun?: string;
    timeUnitNounPlural?: string;
  } | null;
}

export function cap(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pluralize(noun: string): string {
  const n = noun.toLowerCase();
  if (n.endsWith('y') && !'aeiou'.includes(n[n.length - 2])) return n.slice(0, -1) + 'ies';
  if (n.endsWith('s') || n.endsWith('x') || n.endsWith('z') || n.endsWith('sh') || n.endsWith('ch')) return n + 'es';
  return n + 's';
}

export function singularize(noun: string): string {
  const n = noun.toLowerCase();
  if (n.endsWith('ies') && n.length > 4) return n.slice(0, -3) + 'y';
  if (n.endsWith('ses') || n.endsWith('xes') || n.endsWith('zes') || n.endsWith('shes') || n.endsWith('ches')) return n.slice(0, -2);
  if (n.endsWith('s') && !n.endsWith('ss')) return n.slice(0, -1);
  return n;
}

/**
 * Pure derivation of the noun-variant bundle from a scenario-like
 * object. The hook is a `useMemo` wrapper that calls this.
 *
 * Defaults mirror paracosm's Mars heritage for population/settlement
 * (colonists / colony) but use a neutral `tick` / `ticks` for the
 * time-unit so scenarios that omit `timeUnitNoun` produce generic
 * labels rather than inheriting the Mars-specific "Year N" phrasing.
 */
export function deriveLabels(scenario: ScenarioLabelsInput | null | undefined): ScenarioLabels {
  const popPlural = (scenario?.labels?.populationNoun || 'colonists').toLowerCase();
  const popSingular = singularize(popPlural);
  const placeSingular = (scenario?.labels?.settlementNoun || 'colony').toLowerCase();
  const placePlural = pluralize(placeSingular);
  const timeSingular = (scenario?.labels?.timeUnitNoun || 'tick').toLowerCase();
  const timePlural = (scenario?.labels?.timeUnitNounPlural || pluralize(timeSingular)).toLowerCase();
  return {
    people: popPlural,
    person: popSingular,
    People: cap(popPlural),
    Person: cap(popSingular),
    place: placeSingular,
    places: placePlural,
    Place: cap(placeSingular),
    Places: cap(placePlural),
    time: timeSingular,
    times: timePlural,
    Time: cap(timeSingular),
    Times: cap(timePlural),
  };
}
