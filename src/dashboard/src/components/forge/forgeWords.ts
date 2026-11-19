/**
 * Every word the forged tool view shows, in one place, so the components and
 * their tests read the same strings.
 */
import type { RecordOutcome } from '../../hooks/useToolRegistry';
import type { GlyphKind, StationId, StationState } from './forgeLine';

/** The five stations' names, in the order a forge passes them. */
export const STATION_WORDS: Readonly<Record<StationId, string>> = {
  request: 'Request',
  code: 'Code',
  tests: 'Tests',
  judge: 'Judge',
  added: 'Added',
};

/** The one line a station shows when the record cannot say more. */
export const LINE_STATE_WORDS = {
  unknown: 'Unknown',
  notReached: 'Not reached',
} as const;

/** How a station's button names its state to a screen reader: "Request: reached", "Code: Unknown". */
export const STATION_STATE_NAMES: Readonly<Record<StationState, string>> = {
  reached: 'reached',
  stopped: 'stopped here',
  unknown: LINE_STATE_WORDS.unknown,
  notReached: LINE_STATE_WORDS.notReached,
};

export const stationName = (station: StationId, state: StationState): string =>
  `${STATION_WORDS[station]}: ${STATION_STATE_NAMES[state]}`;

/** The list the trace's stations sit in. */
export const STATIONS_LIST_NAME = "The forge's stations";

/** Each outcome's word, always shown beside its glyph. */
export const OUTCOME_WORDS: Readonly<Record<GlyphKind, string>> = {
  passed: 'Passed',
  rejected: 'Rejected by the judge',
  notJudged: 'Not judged',
  refused: 'Refused',
  failed: 'Failed',
  didNotPass: 'Did not pass',
};

/** An actor's slot label on its tile: "A1" to "A300". */
export const actorLabel = (index: number): string => `A${index + 1}`;

/** The forges a strip holds past the cells it draws. */
export const stripMore = (n: number): string => `+${n}`;

// ── The trace ───────────────────────────────────────────────────────────

/** The trace's name as a dialog: "mars_landing_site_score, forged tool 1". */
export const traceDialogName = (toolName: string, n: number): string => `${toolName}, forged tool ${n}`;

/** The tool's number in the header row: "Forged tool 5". */
export const forgedToolLabel = (n: number): string => `Forged tool ${n}`;

export const CLOSE_TRACE = 'Close the trace';

/** Copy link to this tool, in the header row, and what it says of the copy. */
export const COPY_LINK = {
  key: 'Copy link to this tool',
  copied: "Link copied. Anyone with it can open this tool's trace and replay the run.",
  failed: 'Could not copy. Select the link and copy it.',
  offline: 'You are offline',
} as const;

/** The look key's names, the page header's own. */
export const LOOK_KEY_NAMES = {
  toLight: 'Switch to light mode',
  toDark: 'Switch to dark mode',
} as const;

/** The one label at the top of every trace. */
export const AI_WRITTEN_LABEL = 'Written by an AI model during this paracosm run';

/** What happened to a forge, in one sentence, as far as the run's record says. */
export const RECORD_OUTCOME_SENTENCES: Readonly<Record<RecordOutcome, string>> = {
  passed: 'Passed. The judge approved it.',
  did_not_pass: "Did not pass. The run's record does not say where the forge stopped.",
};

/** Under the head of a forge that did not pass: the reason its run recorded, or that it recorded none. */
export const RECORDED_REASON = {
  heading: 'The reason the run recorded',
  limit: "The run's record keeps at most 240 characters of this reason.",
  none: 'The record gave no reason.',
} as const;

/** The one line of a station whose evidence the run did not record. */
export const NOT_RECORDED = {
  code: 'The code was not recorded for this run.',
  tests: 'The tests were not recorded for this run.',
} as const;

/** Judge's one line on an approved forge, the confidence to two places: "Approved · confidence 0.98 out of 1". */
export const judgeApprovedLine = (confidence: number): string =>
  `Approved · confidence ${confidence.toFixed(2)} out of 1`;

/** Added's one line on an approved forge: "Used 3 times", "Used 1 time". */
export const usedTimes = (n: number): string => (n === 1 ? 'Used 1 time' : `Used ${n} times`);

// ── The stations, opened ─────────────────────────────────────────────────

/** The key at the line's head: its label, and its name for a screen reader. */
export const OPEN_ALL = {
  open: 'Open all',
  close: 'Close all',
  openName: 'Open all stations',
  closeName: 'Close all stations',
} as const;

/** The actor a tool was forged under, by its tile's label and name: "A1 Aria Chen, The Visionary · engineering · turn 1 · for “Landfall”". */
export function actorLine(parts: {
  label: string; name: string; archetype: string; department: string; turn: number; eventTitle: string;
}): string {
  const who = parts.archetype ? `${parts.label} ${parts.name}, ${parts.archetype}` : `${parts.label} ${parts.name}`;
  return [
    who,
    parts.department,
    `turn ${parts.turn}`,
    parts.eventTitle ? `for “${parts.eventTitle}”` : '',
  ].filter(Boolean).join(' · ');
}

/** The link from Request to the event the tool was made for. */
export const goToEvent = (eventTitle: string): string => `Go to the event: ${eventTitle}`;

/** Request: what the tool does and its declared fields. */
export const REQUEST_WORDS = {
  whatItDoes: 'What it does',
  inputFields: 'Input fields',
  outputFields: 'Output fields',
  columns: ['Field', 'Type', 'Required', 'Description'],
  rawJson: 'Raw JSON',
  noInputFields: 'This tool declares no input fields.',
  noOutputFields: 'This tool declares no output fields.',
  /** A field the record names with no schema to give its type. */
  notRecorded: 'Not recorded',
  yes: 'Yes',
  no: 'No',
} as const;

/** Judge on the run's record: the verdict's confidence, and no words of the judge's own. */
export const JUDGE_WORDS = {
  heading: 'What the judge said',
  notice: "A model's review of this code, not a security audit. Check before reuse.",
  meterName: "The judge's confidence",
  wordsNotRecorded: "The judge's words were not recorded for this run.",
} as const;

/** "The judge's confidence: 0.98 out of 1", the confidence to two places. */
export const judgeConfidence = (confidence: number): string =>
  `The judge's confidence: ${confidence.toFixed(2)} out of 1`;

/** Added on the run's record: each history row with the output its run recorded. */
export const ADDED_WORDS = {
  output: 'Output the run recorded',
  testNotRecorded: "This forge's test was not recorded.",
  notUsed: 'Not used after it was forged.',
} as const;

/** One row of a tool's history: "Turn 1 · engineering · “Landfall”". */
export function historyRowLine(turn: number, department: string, eventTitle: string): string {
  return [`Turn ${turn}`, department, eventTitle ? `“${eventTitle}”` : ''].filter(Boolean).join(' · ');
}

// ── Record ──────────────────────────────────────────────────────────────

/** Record, the key at the line's foot, and what it opens on a run with no trace. */
export const RECORD_WORDS = {
  key: 'Record',
  rawRecord: 'The raw record',
  copy: 'Copy record',
  copied: 'Copied',
  copyFailed: 'Could not copy. Select the record and copy it.',
  download: 'Download JSON',
  downloadFailed: 'Could not download. Try again, or use Copy record.',
  showInEventLog: 'Show in Event Log',
  unreadable: 'This record could not be shown.',
} as const;

/** The file Download JSON saves: "mars_landing_site_score-trace.json". */
export const recordFileName = (toolName: string): string => `${toolName}-trace.json`;

// ── Attempts ────────────────────────────────────────────────────────────

/** The keys either side of the attempt line. */
export const ATTEMPT_WORDS = {
  previous: 'Previous attempt',
  next: 'Next attempt',
} as const;

/** The attempt line on the latest attempt: "2 of 2". */
export const attemptCount = (n: number, total: number): string => `${n} of ${total}`;

/** The attempt line on an earlier attempt, and its name on every attempt: "Attempt 1 of 2". */
export const attemptOfTotal = (n: number, total: number): string => `Attempt ${n} of ${total}`;

/** Another attempt's row where it leaves the line: "Attempt 1 · Did not pass". */
export const attemptRow = (n: number, outcome: string): string => `Attempt ${n} · ${outcome}`;

// ── The forged toolbox ──────────────────────────────────────────────────

/** A count as the toolbox writes it: "3,612". */
export const countWord = (n: number): string => n.toLocaleString('en-US');

/** A count with its noun, the noun in the singular for one: "1 tool", "12 tools". */
const counted = (n: number, one: string, many: string): string => `${countWord(n)} ${n === 1 ? one : many}`;

/** The toolbox's title, the forge view's one run of capitals. */
export const TOOLBOX_TITLE = 'FORGED TOOLBOX';

/** The toolbox's name as a dialog: "Forged toolbox, 12 tools". */
export const toolboxDialogName = (tools: number): string => `Forged toolbox, ${counted(tools, 'tool', 'tools')}`;

export const CLOSE_TOOLBOX = 'Close the toolbox';

/**
 * The count line, on the run's record: "12 tools from 13 forges (1 re-forge)
 * · 9 passed · 4 did not pass". The outcomes count forges and add up to
 * them; the bracket shows only when a tool was forged more than once; an
 * outcome with no forge is left out; a run of more than two actors ends
 * "· 24 actors".
 */
export function toolboxCountLine(
  counts: { tools: number; forges: number; reforges: number; passed: number; didNotPass: number },
  actors: number,
): string {
  const reforged = counts.reforges > 0 ? ` (${counted(counts.reforges, 're-forge', 're-forges')})` : '';
  return [
    `${counted(counts.tools, 'tool', 'tools')} from ${counted(counts.forges, 'forge', 'forges')}${reforged}`,
    counts.passed > 0 ? `${countWord(counts.passed)} passed` : '',
    counts.didNotPass > 0 ? `${countWord(counts.didNotPass)} did not pass` : '',
    actors > 2 ? `${countWord(actors)} actors` : '',
  ].filter(Boolean).join(' · ');
}

/** The filter: its name, the word before the menu's choice, and each choice's word. */
export const SHOW_WORDS = {
  name: 'Show',
  menuLead: 'Show:',
  all: 'All',
  passed: OUTCOME_WORDS.passed,
  did_not_pass: OUTCOME_WORDS.didNotPass,
} as const;

/** Find a tool: its label, its placeholder and its clear keys. */
export const FIND_WORDS = {
  label: 'Find a tool',
  placeholder: 'Tool name…',
  clear: 'Clear',
  clearName: 'Clear the search',
} as const;

/** What the list says when it holds no row. */
export const TOOLBOX_EMPTY = {
  noTools: 'No department forged a tool in this run.',
  everyToolPassed: 'Every tool in this run passed.',
} as const;

/** A search that matches no tool: "No tool matches “zzz”." */
export const noToolMatches = (query: string): string => `No tool matches “${query}”.`;

export const EXPORT_JSON = 'Export JSON';

/** The file Export JSON saves. */
export const TOOLBOX_FILE_NAME = 'paracosm-toolbox.json';

/**
 * A row's meta line after its actor: "engineering · turn 1 · used 1 time ·
 * 1 re-forge". The uses show on a tool that was added, the re-forges on a
 * tool forged more than once.
 */
export function toolMetaLine(parts: { department: string; turn: number; uses: number | null; reforges: number }): string {
  return [
    parts.department,
    `turn ${parts.turn}`,
    parts.uses === null ? '' : `used ${counted(parts.uses, 'time', 'times')}`,
    parts.reforges > 0 ? counted(parts.reforges, 're-forge', 're-forges') : '',
  ].filter(Boolean).join(' · ');
}

/** The other actors that forged a tool of this name: "Same name: A2, A9", and past three, "Same name in 5 other actors". */
export function sameName(labels: string[]): string {
  return labels.length > 3 ? `Same name in ${countWord(labels.length)} other actors` : `Same name: ${labels.join(', ')}`;
}

/**
 * A row's name for a screen reader: "mars_landing_site_score, Passed, made
 * by A1 Aria Chen", and on a tool forged again, ", forged 2 times".
 */
export function toolRowName(parts: { name: string; outcome: string; actorLabel: string; actorName: string; forges: number }): string {
  const made = `${parts.name}, ${parts.outcome}, made by ${parts.actorLabel} ${parts.actorName}`;
  return parts.forges > 1 ? `${made}, forged ${countWord(parts.forges)} times` : made;
}
