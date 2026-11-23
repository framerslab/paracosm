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
/** Headings and actions for saved runs. */
export const SAVED_RUNS = 'Saved runs';
export const NO_SAVED_RUNS = 'No saved runs yet.';
export const LOCAL_RUNS = 'Kept in this browser';
export const RESTORE_RUN = 'Restore';
export const CLEAR_LIST = 'Clear this list';
export const CLEAR_LIST_QUESTION = 'Clear the runs kept in this browser?\n\n' +
  "This also clears the run on screen and its cached events. It lets go of this browser's run on the server, and stops it if it is running.\n\n" +
  'Server run records, saved replays and output files are kept.';
export const REPLACE_RUN = 'Replace the run on screen with this one?';
/** Studio's dashboard file picker. */
export const OPEN_RUN_FILE = 'Open a run file';
export const OPEN_RUN_FILE_HINT = 'A run you saved with Save in the run actions menu, as a .json file.';
/** Settings group for resetting dashboard and server data. */
export const STORED_DATA = 'Stored data';

/** Names and words in the dashboard banner. */
export { HOW_IT_WORKS } from '../quickstart/first-screen/words';
export const HOME_NAME = 'Paracosm home';
export const SWITCH_TO_LIGHT = 'Switch to light look';
export const SWITCH_TO_DARK = 'Switch to dark look';
export const OWN_KEYS = { long: 'Your API key', short: 'Your key' };
export const SERVER_KEYS = { long: "This server's API keys", short: 'Server keys' };
export const NO_FREE_RUNS = { long: 'Free demo: no run left today', short: 'No free run' };
/** The quota words for a positive run count. */
export function freeRuns(remaining: number) {
  const runs = remaining === 1 ? 'run' : 'runs';
  return { long: `Free demo: ${remaining} ${runs} left today`, short: `${remaining} free ${runs}` };
}

export const SECTIONS = 'Sections';
export const MORE = 'More';
export const PREVIOUS_SECTIONS = 'Previous sections';
export const NEXT_SECTIONS = 'Next sections';
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
export const MORE_TAB_LINES = {
  studio: 'Open run files and branch a run.',
  viz: 'Everyone in the run, drawn as a living map.',
  chat: 'Talk with a character from the run.',
  library: 'Your saved runs.',
  settings: 'Leaders, models and your own API key.',
  about: 'What Paracosm is.',
} as const;
const MORE_LINK_LINES = ['The API reference and guides.', 'The source code.', 'The package to install.'];
export const PACKAGE_LINKS = FOOT_LINKS.slice(0, 3).map((link, index) => ({
  ...link,
  description: MORE_LINK_LINES[index],
}));
