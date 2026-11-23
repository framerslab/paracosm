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
