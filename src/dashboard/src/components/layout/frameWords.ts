/** The foot's navigation name. */
export const SITE_LINKS = 'Site links';
/** Opens the extra links when the complete row does not fit. */
export const MORE_LINKS = 'More links';
/** Links at the end of each tab. */
export const FOOT_LINKS = [
  { label: 'Docs', href: '/docs', external: false },
  { label: 'GitHub', href: 'https://github.com/framerslab/paracosm', external: true },
  { label: 'npm', href: 'https://www.npmjs.com/package/paracosm', external: true },
  { label: 'Privacy', href: '/#privacy', external: false },
] as const;
/** Credits and licence in the foot. */
export const LICENCE_LINE = 'Paracosm · Apache-2.0 · Frame.dev';
/** The heading of the saved runs in Library. */
export const SAVED_RUNS = 'Saved runs';
/** What Saved runs says while the browser keeps none. */
export const NO_SAVED_RUNS = 'No saved runs yet.';
/** The heading over the runs this browser keeps. */
export const LOCAL_RUNS = 'Kept in this browser';
/** The key that puts a kept run back on screen. */
export const RESTORE_RUN = 'Restore';
/** The key that clears the runs this browser keeps. */
export const CLEAR_LIST = 'Clear this list';
/** The question Clear this list asks before it clears anything. */
export const CLEAR_LIST_QUESTION = 'Clear the runs kept in this browser?\n\n' +
  "This also clears the run on screen and its cached events. It lets go of this browser's run on the server, and stops it if it is running.\n\n" +
  'Server run records, saved replays and output files are kept.';
/** The question Restore asks while another run is on screen. */
export const REPLACE_RUN = 'Replace the run on screen with this one?';
/** Studio's dashboard file picker. */
export const OPEN_RUN_FILE = 'Open a run file';
/** The line under Open a run file: which file it opens. */
export const OPEN_RUN_FILE_HINT = 'A run you saved with Save in the run actions menu, as a .json file.';
/** Settings group for resetting dashboard and server data. */
export const STORED_DATA = 'Stored data';

/** The name of the header's How it works key. */
export { HOW_IT_WORKS } from '../quickstart/first-screen/words';
/** The name of the wordmark's link to the landing page. */
export const HOME_NAME = 'Paracosm home';
/** The look switch's name while the page is dark. */
export const SWITCH_TO_LIGHT = 'Switch to light look';
/** The look switch's name while the page is light. */
export const SWITCH_TO_DARK = 'Switch to dark look';
/** The payer state when the visitor saved a provider key: it runs on that key. */
export const OWN_KEYS = { long: 'Your API key', short: 'Your key' };
/** The payer state on a server that runs on its own keys. */
export const SERVER_KEYS = { long: "This server's API keys", short: 'Server keys' };
/** The quota state once the hosted demo's free run for the day is used. */
export const NO_FREE_RUNS = { long: 'Free demo: no run left today', short: 'No free run' };
/** The quota words for a positive run count. */
export function freeRuns(remaining: number) {
  const runs = remaining === 1 ? 'run' : 'runs';
  return { long: `Free demo: ${remaining} ${runs} left today`, short: `${remaining} free ${runs}` };
}

/** The name of the header's tab row and of its More menu. */
export const SECTIONS = 'Sections';
/** The label of the key that opens the More menu. */
export const MORE = 'More';
/** The name of the tab row's arrow key that scrolls back. */
export const PREVIOUS_SECTIONS = 'Previous sections';
/** The name of the tab row's arrow key that scrolls on. */
export const NEXT_SECTIONS = 'Next sections';
/** Each tab's name, as the tab row and the More menu show it. */
export const TAB_NAMES = {
  quickstart: 'Run',
  sim: 'Watch',
  reports: 'Reports',
  studio: 'Studio',
  viz: 'Visualization',
  chat: 'Chat',
  library: 'Library',
  settings: 'Settings',
  about: 'About',
} as const;
/** The line under each tab's name in the More menu. */
export const MORE_TAB_LINES = {
  studio: 'Open run files and branch a run.',
  viz: 'Everyone in the run, drawn as a living map.',
  chat: 'Talk with a character from the run.',
  library: 'Your saved runs.',
  settings: 'Leaders, models and your own API key.',
  about: 'What Paracosm is.',
} as const;
const MORE_LINK_LINES = ['The API reference and guides.', 'The source code.', 'The package to install.'];
/** The package's links below the More menu's rule, each with its line. */
export const PACKAGE_LINKS = FOOT_LINKS.slice(0, 3).map((link, index) => ({
  ...link,
  description: MORE_LINK_LINES[index],
}));

/** Watch your last run again, and a failed tab's Try again key with its busy label. */
export { WATCH_LAST_RUN, TRY_AGAIN, trying as TRYING } from '../quickstart/first-screen/words';
/** The link from an empty Watch or Reports to the Run tab. */
export const GO_TO_RUN = 'Go to Run';
/** Watch's title with no run. */
export const EMPTY_WATCH_TITLE = 'No run yet.';
/** Watch's line with no run: how a run gets there. */
export const EMPTY_WATCH_BODY = 'Set up a run on the Run tab, then press Start. The run shows here, turn by turn.';
/** Reports' title with no run. */
export const EMPTY_REPORTS_TITLE = 'No report yet.';
/** Reports' line with no run: when a report is written. */
export const EMPTY_REPORTS_BODY = 'A report is written when a run ends: a verdict for a pair, a ranking by quarters for 3 or more leaders.';
/** What a tab says when its module did not load. */
export const TAB_FAILED = 'This tab did not load.';
/** What a tab says when it cannot load because the page is offline. */
export const TAB_OFFLINE = 'You are offline. This tab loads when you are back online.';
/** What a loading tab says to a screen reader. */
export const TAB_LOADING = 'Loading tab…';
