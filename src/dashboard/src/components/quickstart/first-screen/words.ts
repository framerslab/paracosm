/**
 * Every word the Run tab's first screen shows, as constants and as
 * functions that fill in the run's figures. A number never breaks from its
 * unit: a no-break space (U+00A0) stands between them. Quotes and
 * apostrophes are curly, and an ellipsis is the one character.
 *
 * @module paracosm/dashboard/quickstart/first-screen/words
 */

/** A no-break space: a number and its unit stay on one line. */
export const NBSP = '\u00a0';

/** The page's title, as the browser's tab shows it. */
export const PAGE_TITLE = 'Watch AI leaders run the same scenario | Paracosm';

/** The page's description, in the same words as its title. */
export const PAGE_DESCRIPTION = 'Read each AI leader’s orders and full prompt, compare leaders side by side, then watch 2 to 300 of them run the same scenario turn by turn.';

/** The short capital mark over the scenario's name. */
export const SCENARIO_MARK = 'SCENARIO';

/** The place a scenario that names none is said to be. */
export const FALLBACK_PLACE = 'this scenario';

/** A count and its unit, kept together: "6 turns", "1 turn". */
export function countOf(n: number, one: string, many: string): string {
  return `${n}${NBSP}${n === 1 ? one : many}`;
}

/**
 * The three sentences under the scenario's name: what the AI leaders do,
 * what Start does and what ends the run, written for the run's size. A pair
 * ends in a verdict; 3 to 300 leaders end in a report that ranks them. While
 * no free run is left and Start is replaced, the middle sentence, which
 * names Start, is left out. The last two words stay on one line, so the
 * paragraph never ends on a single word.
 */
export function scenarioSentences(o: { n: number; turns: number; place?: string; atLimit: boolean }): string {
  const place = o.place?.trim() || FALLBACK_PLACE;
  const leaders = o.n <= 2 ? 'Two AI leaders' : `${o.n}${NBSP}AI leaders`;
  const first = `${leaders} each run ${place} for ${countOf(o.turns, 'turn', 'turns')}, each under its own orders.`;
  const press = 'Press Start to watch them decide.';
  const end = o.n <= 2
    ? `At the end, a verdict says who won and${NBSP}why.`
    : `At the end, a report ranks them on morale, population and${NBSP}deaths.`;
  return o.atLimit ? `${first} ${end}` : `${first} ${press} ${end}`;
}

/** Said beside the broken-link mark while the page asks for the scenario again. */
export const scenarioError = 'The scenario did not load. Trying again.';

/** Said beside the broken-link mark while the page is offline. */
export const scenarioOffline = 'You are offline. The scenario loads when you are back online.';

/** The key that asks for the scenario at once. */
export const tryNow = 'Try now';

/** The same key while it asks. */
export const trying = 'Trying…';

/** The placeholder name the loading shape is drawn over; never shown. */
export const LOADING_NAME = 'Scenario name';

/* The leaders (a pair). */

/** A leader's place figure as a screen reader says it: "Leader 1". */
export const placeSpoken = (place: number): string => `Leader ${place}`;

/** The name a leader's card takes while the scenario writes no leaders: "Leader 1". */
export const unnamedLeader = (place: number): string => `Leader ${place}`;

/** A switch key's spoken name: "Show Aria Chen". */
export const showLeader = (name: string): string => `Show ${name}`;

/** The spoken name of the two leaders' part of the screen. */
export const LEADERS_SPOKEN = 'Leaders';

/** The short capital mark over a leader's six scores. */
export const SCORES_MARK = 'SCORES';

/** The short capital mark over a leader's written orders. */
export const ORDERS_MARK = 'ORDERS';

/** The six scores' names, in the order every block of scores draws them. */
export const TRAIT_NAMES = {
  openness: 'Openness',
  conscientiousness: 'Conscientiousness',
  extraversion: 'Extraversion',
  agreeableness: 'Agreeableness',
  emotionality: 'Emotionality',
  honestyHumility: 'Honesty-humility',
} as const;

/** The quiet line over each block of six scores: what the two ticks on a bar mark. */
export const MIDDLE_BAND = `Middle band 0.35${NBSP}to${NBSP}0.65`;

/** The note under a leader's orders. */
export const HEXACO_NOTE = 'HEXACO is a six-trait personality model. The six scores above are this leader’s.';

/** Said on each card of a scenario that writes no leaders. */
export const NO_WRITTEN_LEADERS = 'This scenario has no written leaders. Paracosm writes them when you press Start.';

/** The placeholder words the loading shapes of a leader's card are drawn over; never shown. */
export const LOADING_LEADER = {
  name: 'Leader name',
  title: 'The leader’s title',
  orders: 'You are the leader of this run. You lead in your own way and weigh every choice against what you value. You hold to your methods when the turn goes badly, you say what you see, and you carry the people with you. Your six scores shape every decision you make here.',
} as const;

/* The shared colony panel (before Start). */

/** The panel's header mark, in the grid's own type. */
export const TURN_ZERO_MARK = 'TURN 0';

/** The panel's figures: "5 key people · 4 departments". */
export function colonyFigures(o: { keyPeople: number; departments: number }): string {
  return `${countOf(o.keyPeople, 'key person', 'key people').replace(' ', NBSP)} · ${countOf(o.departments, 'department', 'departments')}`;
}

/**
 * The panel's caption: every colony starts from the same people, the key
 * people among them. A pair says "Both colonies"; 3 to 300 leaders say how
 * many colonies.
 */
export function colonyCaption(o: { leaders: number; population: number; keyPeople: number }): string {
  const colonies = o.leaders <= 2 ? 'Both colonies' : `All ${o.leaders}${NBSP}colonies`;
  const among = o.keyPeople === 1 ? `this${NBSP}1` : `these${NBSP}${o.keyPeople}`;
  return `${colonies} start with the same ${countOf(o.population, 'person', 'people')}, ${among} among them. Each leader’s decisions make them${NBSP}diverge.`;
}

/** The panel's spoken name, the text alternative of its drawing. */
export function colonySpoken(o: { population: number; keyPeople: number; departments: number }): string {
  const people = `${o.population} ${o.population === 1 ? 'person' : 'people'}`;
  const departments = `${o.departments} ${o.departments === 1 ? 'department' : 'departments'}`;
  return `The colony at turn 0: ${o.keyPeople} of its ${people}, in ${departments}, the same for every leader`;
}

/** Said in the panel's frame when the scenario names no key people. */
export const NO_KEY_PEOPLE = 'This scenario names no key people. Its colony is drawn when the run starts.';

/** The key line under the field: each word beside its glyph. */
export const COLONY_KEY = { department: 'Department', person: 'Person', featured: 'Featured person' } as const;
