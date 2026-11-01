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
 * ("colonists", "colony", "year") and keeps them.
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
}

const capitalise = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** A label that is a non-empty string, trimmed; otherwise the fallback. */
function word(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * Read a scenario's words from its labels.
 *
 * The leader defaults to "commander", the word the prompts used before
 * scenarios could name it, so a scenario that names no `actorNoun`
 * (Mars Genesis) reads as it did.
 */
export function scenarioWords(labels?: Partial<ScenarioLabels> | null): ScenarioWords {
  const timeUnit = word(labels?.timeUnitNoun, 'tick').toLowerCase();
  const actor = word(labels?.actorNoun, 'commander');
  return {
    population: word(labels?.populationNoun, 'members'),
    settlement: word(labels?.settlementNoun, 'settlement'),
    timeUnit,
    TimeUnit: capitalise(timeUnit),
    timeUnitPlural: word(labels?.timeUnitNounPlural, `${timeUnit}s`).toLowerCase(),
    actor,
    Actor: capitalise(actor),
  };
}
