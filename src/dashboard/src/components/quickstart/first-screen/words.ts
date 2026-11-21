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
