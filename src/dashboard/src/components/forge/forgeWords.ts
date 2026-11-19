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
