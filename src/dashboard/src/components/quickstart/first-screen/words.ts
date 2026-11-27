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
export const PAGE_TITLE = 'Simulate one scenario side by side under different leaders | Paracosm';

/** The page's description for search and sharing. */
export const PAGE_DESCRIPTION = 'Simulate the same scenario 2 to 300 times from the same start and compare where the runs part, turn by turn. An AI event director writes each run’s unscripted crises, and only the leader differs: read both leaders’ personality scores and orders before a pair starts.';

/** The short capital mark over the scenario's name. */
export const SCENARIO_MARK = 'SCENARIO';

/** The place a scenario that names none is said to be. */
export const FALLBACK_PLACE = 'this scenario';

/** A count and its unit, kept together: "6 turns", "1 turn". */
export function countOf(n: number, one: string, many: string): string {
  return `${n}${NBSP}${n === 1 ? one : many}`;
}

/**
 * The sentences under the scenario's name describe the shared start, the
 * event director and what differs between runs. A pair ends in a verdict.
 * A cohort ends in a report that ranks its leaders. The sentence about
 * Start appears when Start is available. The last two words stay together.
 */
export function scenarioSentences(o: { n: number; turns: number; place?: string; atLimit: boolean }): string {
  const place = o.place?.trim() || FALLBACK_PLACE;
  const runs = o.n <= 2 ? 'Two runs' : `${o.n}${NBSP}runs`;
  const comparison = `${runs} of ${place} start from the same state and play for ${countOf(o.turns, 'turn', 'turns')}, and an AI event director writes each run’s unscripted crises from what happens in it. Only the leader differs: its personality and its orders.`;
  const press = 'Press Start to watch them decide.';
  const end = o.n <= 2
    ? `At the end, a verdict says who won and${NBSP}why.`
    : `At the end, a report ranks them on morale, population and${NBSP}deaths.`;
  return o.atLimit ? `${comparison} ${end}` : `${comparison} ${press} ${end}`;
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

/**
 * A switch key's spoken name. It holds the words the key shows, the place
 * figure and the name, so a person who says what they see is understood:
 * "Show leader 1 Aria Chen". A leader named by its place alone, whose key
 * shows no separate figure: "Show Leader 1".
 */
export const showLeader = (name: string, place?: number): string =>
  (place === undefined ? `Show ${name}` : `Show leader ${place} ${name}`);

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

/**
 * The panel's figures: "5 key people". The panel states no count of
 * departments: the scenario line's figures state the departments the run
 * uses, and that is the one count of them on the screen.
 */
export function colonyFigures(o: { keyPeople: number }): string {
  return countOf(o.keyPeople, 'key person', 'key people').replace(' ', NBSP);
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
export function colonySpoken(o: { population: number; keyPeople: number }): string {
  const people = `${o.population} ${o.population === 1 ? 'person' : 'people'}`;
  return `The colony at turn 0: ${o.keyPeople} of its ${people}, the same for every leader`;
}

/** Said in the panel's frame when the scenario names no key people. */
export const NO_KEY_PEOPLE = 'This scenario names no key people. Its colony is drawn when the run starts.';

/** The key line under the field: each word beside its glyph. */
export const COLONY_KEY = { department: 'Department', person: 'Person', featured: 'Featured person' } as const;

/* The run's size. */

/** The short capital mark over the leaders, beside the run's size. */
export const LEADERS_MARK = 'LEADERS';

/** The run's size in words: "2 leaders". */
export const leadersCount = (n: number): string => countOf(n, 'leader', 'leaders');

/** Said under the size of a run on the host's keys. */
export const freeSizeLine = (o: { free: number; max: number }): string =>
  `A free run has ${leadersCount(o.free)}. With your own API key, a run can have up to${NBSP}${o.max}.`;

/** The spoken name of the field that holds the size. */
export const NUMBER_OF_LEADERS = 'Number of leaders';

/** The spoken names of the two keys beside the field. */
export const FEWER_LEADERS = 'Fewer leaders';
export const MORE_LEADERS = 'More leaders';

/** Said while a typed size is out of range or not a whole number. */
export const chooseSize = (o: { min: number; max: number }): string => `Choose ${o.min} to ${o.max}${NBSP}leaders.`;

/** Said beside the fewer key at the fewest leaders a run takes. */
export const fewestLine = (min: number): string => `${min} is the fewest a run takes.`;

/** Said beside the more key at the most leaders a run takes. */
export const mostLine = (max: number): string => `${max} is the most a run takes.`;

/** Said under the size when the server's settings did not load. */
export const SETTINGS_NOT_READ = 'The server’s settings could not be read. The server checks the size when you press Start.';

/** Said over the two written leaders of a run of 3 or more. */
export const writesAllLeaders = (n: number): string =>
  `Paracosm writes all ${n}${NBSP}leaders from this scenario when the run starts, in place of these${NBSP}two.`;

/* Start, its run line and its notice. */

/** Who pays for a run: the host's keys, the visitor's own key, or the server it runs on. */
type WhoPays = 'host' | 'own' | 'server';

/** The first line of the Start key; set in capitals by its style. */
export const START = 'Start';

/** Half minutes as a figure: 3.5 reads "3½", 4 reads "4", 0.5 reads "½". */
export function minutesFigure(minutes: number): string {
  const whole = Math.floor(minutes);
  const half = minutes - whole >= 0.5;
  if (whole === 0) return half ? '½' : '0';
  return half ? `${whole}½` : String(whole);
}

/** Half minutes as a screen reader says them, with their unit: "3 and a half minutes", "4 minutes", "half a minute". */
export function minutesSpoken(minutes: number): string {
  const whole = Math.floor(minutes);
  const half = minutes - whole >= 0.5;
  if (whole === 0) return half ? 'half a minute' : '0 minutes';
  if (half) return `${whole} and a half minutes`;
  return whole === 1 ? '1 minute' : `${whole} minutes`;
}

/** Whose keys a run is on, as Start's second line ends. */
const onWhoseKeys = (who: 'own' | 'server'): string => (who === 'own' ? 'on your own API key' : 'on this server’s API keys');

/**
 * Start's second line: the run's length, and from 3 leaders its size. A run
 * on the host's keys says about how long it takes; a run on the visitor's
 * key or a self-hosted server, which has not been timed, says whose keys.
 */
export function startSecondLine(o: { who: WhoPays; size: number; turns: number; minutes: number }): string {
  const turns = countOf(o.turns, 'turn', 'turns');
  if (o.who === 'host') {
    const unit = o.minutes <= 1 ? 'minute' : 'minutes';
    return `${turns}, about ${minutesFigure(o.minutes)}${NBSP}${unit}`;
  }
  const leaders = o.size > 2 ? `${leadersCount(o.size)}, ` : '';
  return `${leaders}${turns}, ${onWhoseKeys(o.who)}`;
}

/** Start's spoken name: "Start Mars Genesis: 6 turns, about 3 and a half minutes". Plain spaces, as a name is matched. */
export function startSpoken(o: { scenario: string; who: WhoPays; size: number; turns: number; minutes: number }): string {
  const turns = `${o.turns} ${o.turns === 1 ? 'turn' : 'turns'}`;
  if (o.who === 'host') return `${START} ${o.scenario}: ${turns}, about ${minutesSpoken(o.minutes)}`;
  const leaders = o.size > 2 ? `${o.size} leaders, ` : '';
  return `${START} ${o.scenario}: ${leaders}${turns}, ${onWhoseKeys(o.who)}`;
}

/** The key while the day's count is read, and while nothing is known yet. */
export const CHECKING_FREE_RUNS = 'Checking your free runs…';

/** The key from the press until the page opens the run. */
export const STARTING = 'Starting…';

/** The key while Paracosm writes the run's leaders. */
export const writingLeaders = (k: number): string => `Writing ${leadersCount(k)}…`;

/** The key while the page is offline, and the words beside it. */
export const YOU_ARE_OFFLINE = 'You are offline';
export const START_WHEN_ONLINE = 'Start works when you are back online.';

/** Said above Start when a run did not start and the page knows no nearer cause. */
export const RUN_DID_NOT_START = 'The run did not start. Press Start again.';

/** The run line's last word: a pair ends in a verdict, 3 to 300 leaders in a report. */
export const RUN_END = { verdict: 'Verdict', report: 'Report' } as const;

/** The notice's first sentence before a run on the host's keys. */
export const NOTICE_FREE = 'This run is free: we pay for it.';

/** The host's provider and models, when the server identifies the full policy. */
export const hostRunPolicy = (provider: string, models: string, turns: number): string =>
  `It runs on ${provider} (${models}) for ${countOf(turns, 'turn', 'turns')}.`;

/** The first sentence of the note that says what the leaders are. */
export const AI_AGENTS = 'The leaders are AI agents.';

/**
 * The day's count of free runs for this internet address, with the time
 * they reset when the server gave one. The clock time stays on one line.
 */
export function noticeCount(o: { remaining: number; limit: number; resetTime?: string }): string {
  const reset = o.resetTime ? ` They reset at ${o.resetTime.replace(/ /g, NBSP)}.` : '';
  return `Free runs left today on your internet address: ${o.remaining}${NBSP}of${NBSP}${o.limit}, shared by everyone using it.${reset} A new run or a fork uses one.`;
}

/** The count when it could not be read. */
export const NOTICE_COUNT_UNAVAILABLE = 'Free runs left today: unavailable.';

/** What comes after the day's free runs; the replay clause shows only while the saved-run list holds a run. */
export const noticeAfter = (hasSavedRun: boolean): string => (hasSavedRun
  ? 'After that, you can replay your runs for free, or add your own API key in Settings to run again today. Your provider bills you for those runs.'
  : 'After that, add your own API key in Settings to run again today. Your provider bills you for those runs.');

/** The first sentence of the notice before a run on the visitor's own key; the provider is named when the saved key tells which. */
export const ownKeyPays = (provider?: string): string =>
  `This run uses your ${provider ? `${provider} ` : ''}API key, and your provider bills you.`;

/** The notice before a run on the visitor's own key. */
export const noticeOwnKey = (provider?: string): string =>
  `${ownKeyPays(provider)} Runs on your key skip the daily limit and do not use your free runs. They are not held to this demo’s size, so they can be larger than the free run.`;

/** The notice on a server that is not the hosted demo. */
export const NOTICE_SERVER = 'This run uses this server’s API keys.';

/**
 * The estimate of what a run of 3 or more leaders costs, and what it rests
 * on. On the visitor's key it names the provider and models they saved,
 * where they saved both.
 */
export function estimateLine(o: { who: 'own' | 'server'; usd: string; provider?: string; models?: string }): string {
  if (o.who === 'server') {
    return `Estimated cost: about ${o.usd}${NBSP}USD on this server’s keys, from the mean cost of four pair runs measured on the hosted demo’s economy models. The server’s models set the real price.`;
  }
  const uses = o.provider && o.models ? ` Your run uses ${o.provider} (${o.models}) from your Settings, which set the real price.` : '';
  return `Estimated cost: about ${o.usd}${NBSP}USD on your key, from the mean cost of four pair runs measured on this demo’s economy models.${uses}`;
}

/** Said in Start's place while this internet address has no free run left today. */
export const atLimitReset = (resetTime?: string): string => (resetTime
  ? `Your internet address has no free runs left today. They reset at ${resetTime.replace(/ /g, NBSP)}.`
  : 'Your internet address has no free runs left today.');

/** The second paragraph at the limit; its first sentence shows only while the saved-run list holds a run. */
export const atLimitAfter = (hasSavedRun: boolean): string =>
  `${hasSavedRun ? 'You can replay a saved run for free. ' : ''}To start a new run now, add your own API key in Settings: your provider bills you, and the run is not held to this demo’s size.`;

/** The filled key in Start's place, and the link beside Start, that replays the visitor's own last run. */
export const WATCH_LAST_RUN = 'Watch your last run again';

/** The filled key in Start's place that replays the team's run, when this browser has none of its own. */
export const WATCH_TEAM_RUN = 'Watch our team’s run';

/** The team's run key's second line: its scenario and turn count, each written only when the run names it. */
export function teamRunLine(o: { scenario?: string; turns?: number }): string {
  const turns = o.turns === undefined ? '' : countOf(o.turns, 'turn', 'turns');
  return [o.scenario, turns].filter(Boolean).join(', ');
}

/** The team's run key's spoken name: "Watch our team’s run: Mars Genesis, 6 turns". Plain spaces, as a name is matched. */
export function teamRunSpoken(o: { scenario?: string; turns?: number }): string {
  const turns = o.turns === undefined ? '' : `${o.turns} ${o.turns === 1 ? 'turn' : 'turns'}`;
  const about = [o.scenario, turns].filter(Boolean).join(', ');
  return about ? `${WATCH_TEAM_RUN}: ${about}` : WATCH_TEAM_RUN;
}

/** Said on Watch when the provider refused the key the visitor's run went out on. */
export const VISITOR_KEY_REFUSED = 'Your API key was refused by its provider.';
/** The refused-key alert's link, to the Settings field of the provider that refused the key. */
export const CHECK_KEY_IN_SETTINGS = 'Check it in Settings';
/** Said in Settings once a provider key is saved in this tab. */
export const KEY_SAVED_IN_TAB = 'Key saved in this tab.';
/** The link from Settings back to the Run tab, beside the saved-key line. */
export const BACK_TO_RUN = 'Back to Run';
/** The link under the key at the limit, to Settings' API key field. */
export const ADD_KEY_IN_SETTINGS = 'Add your API key in Settings';

/** Said above Start when the request did not reach the server. */
export const COULD_NOT_REACH = 'Could not reach the server. Check your connection and press Start again.';

/** Said above Start when the server answered that it is busy. */
export const SERVER_BUSY = 'The server is busy. Press Start again in a moment.';

/** Said above Start when every run slot on the server is in use. */
export const SLOTS_IN_USE = 'Every run slot on the server is in use. Press Start again in a minute.';

/** Said at the limit, in the replay key's place, when the saved-run list did not load. */
export const SAVED_RUNS_NOT_LOADED = 'Your saved runs did not load.';

/** The key beside it that asks for the list again. */
export const TRY_AGAIN = 'Try again';

/* How it works: the one card the header's key opens. */

/** The card's title, and the name of the header's key that opens it. */
export const HOW_IT_WORKS = 'How it works';

/** The card's key that closes it. */
export const CLOSE = 'Close';

/**
 * The card's six lines: the rules of a run. The fourth names the run's
 * turns and the scenario's word for a settlement; until the scenario has
 * loaded it reads "After the last turn" and "each side". The sixth says how
 * many leaders run at a time only where the server has said so: a figure it
 * has not sent is left out.
 */
export function howItWorksLines(o: { turns?: number; settlement?: string; batch?: number } = {}): string[] {
  const after = o.turns === undefined ? 'After the last turn' : `After turn${NBSP}${o.turns}`;
  const settlement = o.settlement?.trim().toLowerCase() || 'side';
  const atATime = o.batch === undefined ? '' : `, ${o.batch}${NBSP}at a time`;
  return [
    'Each leader follows its own orders, shown on its card. “See the full prompt” shows everything it was given.',
    'On each turn an AI leader reads the event and its departments’ reports, picks a bold or a safe option and writes why. Its rule is to take the bold option when that option’s chance reaches the leader’s bar, a number set by its personality. It breaks the rule only for a fact the odds leave out, and names that fact.',
    'RISKY or SAFE says which option it took. WIN or LOSS says whether it paid off.',
    `${after} a verdict names the winner or a tie, says why, and scores each ${settlement} 0${NBSP}to${NBSP}10 for survival, prosperity, morale and innovation.`,
    'With two leaders, picking a winner is optional and changes nothing in the run.',
    `With 3${NBSP}or more leaders, each runs the scenario on its own${atATime}. The report ranks them in quarters on morale, population and deaths, with no single winner.`,
  ];
}

/** The mark over each of the card's three drawings: together they show one sample turn. */
export const SAMPLE_TURN = 'Sample turn';

/** The sample turn's figures: the leader's bar, and the bold option's chance, which reaches it. */
export const SAMPLE_BAR = 36;
export const SAMPLE_CHANCE = 80;

/** The words on the first drawing. */
export const sampleBar = `Bar${NBSP}${SAMPLE_BAR}`;
export const sampleChance = `Chance${NBSP}${SAMPLE_CHANCE}`;

/** The stamp the sample turn earns, as the run screen prints it. */
export const SAMPLE_STAMP = 'RISKY WIN';

/** The sample turn's four scores out of 10, in the order a verdict gives them. */
export const SAMPLE_SCORES = [
  ['Survival', 7],
  ['Prosperity', 6],
  ['Morale', 8],
  ['Innovation', 5],
] as const;

/** What each drawing says to a screen reader, in the order of their lines. */
export const DRAWING_ALT = {
  bar: `A sample turn: a bar set at ${SAMPLE_BAR} with a chance of ${SAMPLE_CHANCE}, which reaches it`,
  stamp: `The stamp that turn earns: ${SAMPLE_STAMP}, the bold option taken, and it paid off`,
  scores: `Four sample scores out of 10: ${SAMPLE_SCORES.map(([name, value]) => `${name.toLowerCase()} ${value}`).join(', ')}`,
} as const;

/* Other scenarios: one list of the server's scenarios under Start. */

/** The list's heading. */
export const OTHER_SCENARIOS = 'Other scenarios';

/** The heading over the scenarios compiled or stored in this browser, after the bundled ones. */
export const YOURS = 'Yours';

/** The row of the scenario the first screen shows. */
export const ON_SCREEN_NOW = 'On screen now';

/** The key that opens the rows past the first ones, with how many scenarios a press can load. */
export const showAll = (count: number): string => `Show all ${count}`;

/** The same key once every row is open. */
export const SHOW_FEWER = 'Show fewer';

/** A row's spoken name: what a press of it does. */
export const loadScenario = (name: string): string => `Load ${name}`;

/** The spoken name of the row whose scenario is on screen. */
export const onScreenSpoken = (name: string): string => `${name}, on screen now, unavailable`;

/** A row while its scenario loads. */
export const loadingScenario = (name: string): string => `Loading ${name}…`;

/** A row whose switch failed. */
export const scenarioDidNotLoad = (name: string): string => `${name} did not load.`;

/** Said under the heading when the list did not load. */
export const SCENARIOS_DID_NOT_LOAD = 'The other scenarios did not load.';

/** Said on a row chosen while the page is offline. */
export const CHOOSE_WHEN_ONLINE = 'You are offline. Choose it again when you are back online.';

/** A row's figures: the departments a run of it uses. */
export const departmentsLine = (n: number): string => countOf(n, 'department', 'departments');

/** A catalog row's turns and departments, omitting figures the server has not supplied. */
export function catalogFigures(turns?: number, departments?: number, separator = ' · '): string {
  return [
    ...(turns === undefined ? [] : [countOf(turns, 'turn', 'turns')]),
    ...(departments === undefined ? [] : [departmentsLine(departments)]),
  ].join(separator);
}

const scenarioLeaderNames = new Intl.ListFormat('en', { type: 'conjunction' });

/** The authored leaders listed in the catalog. */
export const catalogLeaders = (names: string[]): string =>
  `Leaders: ${names.length ? scenarioLeaderNames.format(names) : 'written by Paracosm when the run starts'}`;

/** The key on a row of Yours that opens its details, where a compiled scenario is renamed or deleted. */
export const VIEW_DETAIL = 'View detail';
export const viewDetailSpoken = (name: string): string => `View detail for ${name}`;

/* Write your own scenario: the paste form, kept under the list. */

/** The paste form's heading. */
export const WRITE_YOUR_OWN = 'Write your own scenario';

/** The paste form's key on a run on the host's keys. */
export const GENERATE_AND_RUN = 'Generate and run';

/** Start's sentence while a draft of 200 characters or more waits in the paste form. */
export const heldDraft = (scenario: string): string =>
  `You have a draft scenario below. Run it there, or clear it to play ${scenario}.`;

/** The link to the draft, and the key that clears it. */
export const GO_TO_DRAFT = 'Go to your draft';
export const CLEAR_DRAFT = 'Clear your draft';

/* The notes and the foot. */

/** Under the leaders' heading row. */
export const NOTE_FICTIONAL = 'Leaders are fictional characters.';

/** Above Start's notice. */
export const NOTE_AI = 'The leaders are AI agents. Everything they say is written by a language model and can be wrong.';

/** The written leader's prompt key. */
export const SEE_FULL_PROMPT = 'See the full prompt';

/** Copy for the read-only commander input dialog. */
export const FULL_PROMPT = {
  title: (name: string) => `${name}'s full prompt`,
  opening: 'Opening…',
  close: 'Close',
  lead: "Everything this leader is given, in three parts. Parts 1 and 2 are exactly what the model receives. Part 3 is a sample of a turn. The model's own hidden reasoning is not here, because Paracosm does not receive it.",
  sections: 'Prompt parts',
  system: '1. System prompt',
  systemNote: "The standing instructions the model reads first: the leader's orders and a description of its personality written from its six trait scores. A line that starts with ## marks a heading in that text.",
  systemNoteOther: "The standing instructions the model reads first: the leader's orders and a description of its personality. A line that starts with ## marks a heading in that text.",
  openingMessage: '2. Opening message',
  openingNote: 'Sent once, before turn 1. It says what the leader leads and repeats its personality as a decision style.',
  sample: '3. A sample turn',
  sampleNote: "The shape of what the leader receives each turn: the event, the department reports, the state, the options, and the leader's decision rule. The event and the reports are written during a run by other AI agents, so this sample marks where they go.",
  hexaco: 'HEXACO is a six-trait personality model: openness, conscientiousness, extraversion, agreeableness, emotionality and honesty-humility, each scored 0 to 1.',
  scoreLabel: (name: string, scores: string) => `${name}'s six scores: ${scores}`,
  speaks: (name: string, names: string) => `For ${name}: ${names}.`,
  middle: (name: string) => `For ${name}: every score is near the middle, so part 1 has no personality section.`,
  scoreRule: "Each score far from the middle adds one line to part 1's personality section.",
  twice: 'The leader hears about its personality twice, here and in the opening message. The two use different cut-offs, so a middling score can speak in one and stay quiet in the other.',
  barNote: "Bar: the chance at which this leader's rule says to take the bold option. The leader's personality sets it. The number here is the bar at the start of a run.",
  bar: (value: number) => `${value} in 100`,
  freeModel: 'Model on a free run:',
  ownModel: 'With your own API key, the model is the one chosen in Settings.',
  serverModel: 'On this server, the model is the one chosen in Settings.',
  notInRun: 'Paracosm writes new leaders for a run of this size, so this leader is not in the run Start launches. These are the words it gets in a run that includes it.',
  filled: 'This leader had no written orders, so Paracosm wrote these from its title and temperament.',
  loading: 'Loading the prompt',
  loaded: 'Prompt loaded',
  failed: 'The prompt did not load.',
  changed: 'The scenario has changed since this page loaded. Reload to read its leaders.',
  offline: 'You are offline. Try again when you are back online.',
  limited: 'Too many requests from this connection. Try again in a minute.',
  retry: 'Try again',
  trying: 'Trying…',
  reload: 'Reload',
} as const;
