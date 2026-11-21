/**
 * The forge's line: the five stations every forge passes (Request, Code,
 * Tests, Judge, Added), read for one attempt of one actor's tool.
 *
 * This reads the run's record as the dashboard holds it: each forge's
 * `forge_attempt` frame says whether the judge approved it, and a tool a
 * department reported with no frame of its own takes its report's outcome.
 * The record does not say where a forge that did not pass stopped, so its
 * line fills Request alone and reads the three stations after it as
 * unknown; an approved forge fills all five. An earlier attempt's spur and
 * the next attempt's branch leave the line after Request.
 */
import type { RecordOutcome, ToolEntry } from '../../hooks/useToolRegistry';
import { getActorColorVar } from '../../hooks/useGameState';

export type StationId = 'request' | 'code' | 'tests' | 'judge' | 'added';

/** The stations in the order a forge passes them. */
export const STATIONS: readonly StationId[] = ['request', 'code', 'tests', 'judge', 'added'];

/**
 * - reached: the record holds this station's result; drawn filled in the line's colour.
 * - stopped: the forge stopped here; drawn as the outcome's glyph.
 * - notReached: the forge never got here; drawn hollow on a dashed line.
 * - unknown: the record does not say; drawn dashed.
 */
export type StationState = 'reached' | 'stopped' | 'notReached' | 'unknown';

export type GlyphKind = 'passed' | 'rejected' | 'notJudged' | 'refused' | 'failed' | 'didNotPass';

/** Another attempt of the same tool, drawn where it leaves the shown attempt's line. */
export interface AttemptMark {
  attempt: number;
  station: StationId;
  outcome: RecordOutcome;
}

export interface LineModel {
  stations: Record<StationId, StationState>;
  stop: { station: StationId; glyph: GlyphKind } | null;
  /** The station open when the trace opens: the one that decided the outcome. */
  deciding: StationId;
  /** The attempts before the shown one, in order. */
  spurs: AttemptMark[];
  /** The attempt after the shown one, if any. */
  branch: AttemptMark | null;
}

/** The glyph of an outcome on the run's record. */
export function glyphFor(outcome: RecordOutcome): GlyphKind {
  return outcome === 'passed' ? 'passed' : 'didNotPass';
}

/** Where another attempt leaves the line: the record does not say where a forge stopped, so after Request. */
const RECORD_FORK: StationId = 'request';

function recordLine(outcome: RecordOutcome): Pick<LineModel, 'stations' | 'stop' | 'deciding'> {
  if (outcome === 'passed') {
    return {
      stations: { request: 'reached', code: 'reached', tests: 'reached', judge: 'reached', added: 'reached' },
      stop: null,
      deciding: 'judge',
    };
  }
  return {
    stations: { request: 'reached', code: 'unknown', tests: 'unknown', judge: 'unknown', added: 'notReached' },
    stop: null,
    deciding: 'request',
  };
}

/**
 * The attempt a number names, 1-based: the nearest one the tool holds, the
 * latest for a number that is not finite, and 0 for a tool with no forge frame.
 */
export function attemptNumber(entry: ToolEntry, attempt: number): number {
  const count = entry.attempts.length;
  if (count === 0) return 0;
  return Number.isFinite(attempt) ? Math.min(Math.max(Math.trunc(attempt), 1), count) : count;
}

/**
 * The line of one attempt of a tool, 1-based. A tool with no forge frame (a
 * report-only run) reads its report's outcome. An attempt the tool does not
 * hold is read as the nearest one it does, and a number that is not finite
 * as the latest, so a stale address never throws.
 */
export function forgeLineModel(entry: ToolEntry, attempt: number): LineModel {
  const attempts = entry.attempts;
  if (attempts.length === 0) {
    return { ...recordLine(entry.outcome), spurs: [], branch: null };
  }
  const shownAt = attemptNumber(entry, attempt);
  const outcomeOf = (approved: boolean): RecordOutcome => (approved ? 'passed' : 'did_not_pass');
  const shown = attempts[shownAt - 1];
  const next = attempts[shownAt];
  return {
    ...recordLine(outcomeOf(shown.approved)),
    spurs: attempts.slice(0, shownAt - 1).map((a) => ({
      attempt: a.attempt, station: RECORD_FORK, outcome: outcomeOf(a.approved),
    })),
    branch: next ? { attempt: next.attempt, station: RECORD_FORK, outcome: outcomeOf(next.approved) } : null,
  };
}

/**
 * The colour of a tool's line. On a run of two actors it is the actor's run
 * colour, the colour the run view gives that side. From three actors the run
 * colours include the problem and pass colours, so the line takes the quiet
 * tone and the actor's colour stays on its tile's band and its rows' side marks.
 */
export function lineColour(actorIndex: number, actorCount: number): string {
  return actorCount <= 2 ? getActorColorVar(actorIndex) : 'var(--forge-quiet)';
}

/**
 * How many times a tool was used after it was forged, as its actor's reports
 * list it: the rows of its history after the first that are not forges of it.
 */
export function usesOf(entry: ToolEntry): number {
  return entry.history.slice(1).filter((row) => !row.isReforge).length;
}
