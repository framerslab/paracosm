/**
 * The words a run's prompts use for its people, its place, its time and
 * its leader, read from the scenario's labels.
 *
 * The prompts the director, the commander, the departments and the
 * reactions receive were written for Mars Genesis ("colonists", "the
 * colony commander", "YEAR"), so an Atlas Lab run counted its months as
 * years and called its researchers colonists. Each prompt builder takes
 * the scenario's labels and reads its words here. A scenario without a
 * label gets the neutral word below; Mars Genesis declares its own
 * ("colonists", "colony", "year", "commander") and keeps them.
 *
 * @module paracosm/runtime/util/scenario-words
 */
import type { ScenarioLabels } from '../../engine/types.js';

/** The words of one scenario, ready to put in a prompt. */
export interface ScenarioWords {
  /** The people, plural: "researchers", "colonists". */
  population: string;
  /** The place: "lab", "colony". */
  settlement: string;
  /** One unit of time, lower case: "month", "year". */
  timeUnit: string;
  /** One unit of time, capitalised: "Month", "Year". */
  TimeUnit: string;
  /** Units of time, plural: "months", "years". */
  timeUnitPlural: string;
  /** The leader whose decisions the run follows: "release director", "commander". */
  actor: string;
  /** The leader, capitalised: "Release director", "Commander". */
  Actor: string;
  /**
   * The leader with the place, each named once: "lab release director",
   * "colony commander", and "council lead" where the leader's own word
   * already holds the place.
   */
  leaderTitle: string;
}

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** A label that is a non-empty string, trimmed; otherwise the fallback. */
function word(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Read a scenario's words from its labels.
 *
 * The leader defaults to "leader". The compiler labels a draft that names
 * none "actor", the engine's word for the type; in a sentence that reads
 * as a performer ("You are the company actor"), so it counts as unnamed.
 */
export function scenarioWords(labels?: Partial<ScenarioLabels> | null): ScenarioWords {
  const timeUnit = word(labels?.timeUnitNoun, 'tick').toLowerCase();
  const named = word(labels?.actorNoun, 'leader');
  const actor = named.toLowerCase() === 'actor' ? 'leader' : named;
  const settlement = word(labels?.settlementNoun, 'settlement');
  return {
    population: word(labels?.populationNoun, 'members'),
    settlement,
    timeUnit,
    TimeUnit: capitalise(timeUnit),
    timeUnitPlural: word(labels?.timeUnitNounPlural, `${timeUnit}s`).toLowerCase(),
    actor,
    Actor: capitalise(actor),
    leaderTitle: actor.toLowerCase().split(/\s+/).includes(settlement.toLowerCase()) ? actor : `${settlement} ${actor}`,
  };
}

/**
 * The time unit a saved run records. A compiled scenario names the unit
 * and no plural, and the run recorded "quarter" with "years".
 */
export function artifactTimeUnit(labels?: Partial<ScenarioLabels> | null): { singular: string; plural: string } {
  const singular = word(labels?.timeUnitNoun, 'time');
  return { singular, plural: word(labels?.timeUnitNounPlural, `${singular}s`) };
}
