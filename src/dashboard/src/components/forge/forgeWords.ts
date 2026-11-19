/**
 * Every word the forged tool view shows, in one place, so the components and
 * their tests read the same strings.
 */
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
