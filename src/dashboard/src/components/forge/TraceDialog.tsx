import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { getActorColorVar, type ProcessedEvent } from '../../hooks/useGameState';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useToolContext, type RecordOutcome, type ToolEntry } from '../../hooks/useToolRegistry';
import { ActorTile } from './ActorTile';
import { STATIONS, attemptNumber, forgeLineModel, glyphFor, lineColour, usesOf, type StationId } from './forgeLine';
import { ForgeLine } from './ForgeLine.tsx';
import {
  AI_WRITTEN_LABEL,
  ATTEMPT_WORDS,
  CLOSE_TRACE,
  OPEN_ALL,
  RECORD_OUTCOME_SENTENCES,
  RECORD_WORDS,
  actorLabel,
  attemptCount,
  attemptOfTotal,
  forgedToolLabel,
  judgeApprovedLine,
  traceDialogName,
  usedTimes,
} from './forgeWords';
import { LookKey } from './LookKey';
import { initialOpen, keepStations, readKeptStations, recordEvidence, runKeyOf } from './openStations';
import { OutcomeGlyph } from './OutcomeGlyph';
import { RecordPanel, recordFrames } from './RecordPanel';
import { AddedStation } from './stations/AddedStation';
import { JudgeStation } from './stations/JudgeStation';
import { NotRecorded } from './stations/NotRecorded';
import { RecordedReason } from './stations/RecordedReason';
import { RequestStation } from './stations/RequestStation';
import styles from './TraceDialog.module.scss';

export interface TraceDialogProps {
  /** The actor's tool the trace shows. */
  entry: ToolEntry;
  /** The attempt to show, 1-based. The latest when not given. */
  attempt?: number;
  /** Stations to open beside the one that decided the outcome and the ones kept on this device. */
  open?: StationId[];
  /** How many actors the run holds: the line takes the actor's run colour on a run of two. */
  actorCount: number;
  /** The run's key: the stations a visitor opens are kept on this device for the run it names. */
  runKey: string | null;
  /** The actor's events: Record shows the ones that name the tool. */
  events: readonly ProcessedEvent[];
  onClose: () => void;
  /** Closes the trace and moves focus to an element of the run view: the event a tool was made for. */
  onGoToEvent: (target: HTMLElement) => void;
  /** Closes the trace and opens the Event Log on this actor's tool. */
  onShowInEventLog: () => void;
}

/** The device's storage, or none where the page may not use it. */
function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * One forged tool's trace, read from the run's record: whose tool it is and
 * its number, one sentence saying what happened to it, and the forge's line
 * of five stations, each a key that opens what the run recorded in place.
 *
 * The record says whether a forge was approved and no more. An approved
 * forge fills its five stations; any other fills Request alone, and the
 * reason the run recorded stands under the head with no station named.
 * Request opens the actor's line and the tool's fields on every forge, Judge
 * the confidence and Added the uses of a passed one; the record holds no
 * code and no tests, so Code and Tests have nothing to open.
 *
 * The trace opens with the station that decided the outcome open: Judge on a
 * passed forge, Request on any other. The stations a visitor opens are kept
 * on this device for the run, and open beside the deciding one on the run's
 * next tool. Open all opens every station that holds evidence.
 *
 * A tool forged more than once opens at its latest attempt, so its head says
 * what its forge said last. Previous attempt and Next attempt swap the trace
 * in place, and every other attempt leaves the line where it stopped as a
 * row that links to it. Record, one key at the line's foot, opens the
 * actor's frames that name the tool.
 *
 * A dialog over the run: a full-screen sheet with its header row fixed on a
 * phone, a centred dialog from 900 px. It opens with focus on the tool's
 * name, holds focus until it closes, and Escape closes it.
 */
export function TraceDialog({
  entry, attempt, open, actorCount, runKey, events, onClose, onGoToEvent, onShowInEventLog,
}: TraceDialogProps) {
  const registry = useToolContext();
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const rowNameRef = useRef<HTMLHeadingElement | null>(null);
  const headNameRef = useRef<HTMLHeadingElement | null>(null);
  const recordId = useId();

  // The tool's name is the dialog's heading. It stands in the header row from
  // 900 px and under the row below that, so focus goes to the one on show.
  useEffect(() => {
    const shown = [rowNameRef.current, headNameRef.current].find((el) => el !== null && el.offsetParent !== null);
    shown?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The attempt on show: the one asked for, else the latest, which follows a
  // re-forge that arrives while the trace is open.
  const [chosen, setChosen] = useState<number | undefined>(attempt);
  const total = entry.attempts.length;
  const shownAt = attemptNumber(entry, chosen ?? Number.NaN);
  const shown = shownAt > 0 ? entry.attempts[shownAt - 1] : null;
  const outcome: RecordOutcome = shown ? (shown.approved ? 'passed' : 'did_not_pass') : entry.outcome;
  const passed = outcome === 'passed';
  const reason = shown ? shown.errorReason : entry.errorReason ?? null;
  const confidence = shown?.confidence ?? entry.confidence;
  const model = forgeLineModel(entry, shownAt);
  const hasEvidence = useMemo(() => recordEvidence(passed), [passed]);
  /** The stations whose keys open something: the forge got there and the record holds evidence for it. */
  const openable = STATIONS.filter((s) => (model.stations[s] === 'reached' || model.stations[s] === 'stopped') && hasEvidence(s));

  // The run the open stations are kept for, and the set this trace opens with.
  const keptFor = useMemo(() => runKeyOf(window.location.href, runKey), [runKey]);
  const [openSet, setOpenSet] = useState<Set<StationId>>(() => {
    const storage = deviceStorage();
    const kept = storage ? readKeptStations(storage, keptFor) : [];
    return initialOpen(model, [...kept, ...(open ?? [])], hasEvidence);
  });

  /** Opens and closes stations, and keeps the open set on this device for the run. */
  const changeOpen = (next: Set<StationId>) => {
    setOpenSet(next);
    const storage = deviceStorage();
    if (storage) keepStations(storage, keptFor, [...next]);
  };
  const toggleStation = (station: StationId) => {
    const next = new Set(openSet);
    if (next.has(station)) next.delete(station);
    else next.add(station);
    changeOpen(next);
  };
  // Open all opens every station with evidence; Close all leaves the one that decided the outcome.
  const allOpen = openable.every((s) => openSet.has(s));
  const toggleAll = () => {
    changeOpen(new Set(allOpen ? openable.filter((s) => s === model.deciding) : openable));
  };

  // Another attempt swaps the trace in place: the stations open on this one
  // stay open where that one holds evidence, beside its own deciding station.
  /** After a row's link swaps the attempt, focus goes to the row now in its place: the attempt just left. */
  const focusRowRef = useRef<number | null>(null);
  const showAttempt = (n: number, fromRow: boolean) => {
    const next = attemptNumber(entry, n);
    if (next === 0 || next === shownAt) return;
    const nextPassed = entry.attempts[next - 1].approved;
    setOpenSet(initialOpen(forgeLineModel(entry, next), [...openSet], recordEvidence(nextPassed)));
    focusRowRef.current = fromRow ? shownAt : null;
    setChosen(next);
  };
  useEffect(() => {
    const row = focusRowRef.current;
    focusRowRef.current = null;
    if (row === null) return;
    dialogRef.current?.querySelector<HTMLElement>(`[data-fork-attempt="${row}"]`)?.focus();
  }, [shownAt, dialogRef]);

  // Record: the actor's frames that name the tool, opened in place at the line's foot.
  const [recordOpen, setRecordOpen] = useState(false);
  const frames = useMemo(() => (recordOpen ? recordFrames(events, entry.name) : []), [recordOpen, events, entry.name]);

  // Each closed station's one line. A station the record says nothing of keeps the line's own word for it.
  const stationResult = (station: StationId): ReactNode => {
    switch (station) {
      case 'request': return shown?.description || entry.description;
      case 'code': return passed ? <NotRecorded station="code" /> : null;
      case 'tests': return passed ? <NotRecorded station="tests" /> : null;
      case 'judge': return passed ? judgeApprovedLine(confidence) : null;
      case 'added': return passed ? usedTimes(usesOf(entry)) : null;
    }
  };

  // What each station opens: the run's record of it, or nothing where the record holds none.
  const actor = registry.actors[entry.actorIndex];
  const renderEvidence = (station: StationId): ReactNode => {
    if (!hasEvidence(station)) return null;
    switch (station) {
      case 'request':
        return (
          <RequestStation
            entry={entry}
            attempt={shown}
            actor={{
              label: actor?.label ?? actorLabel(entry.actorIndex),
              name: entry.actorName,
              archetype: actor?.archetype ?? '',
              colour: getActorColorVar(entry.actorIndex),
            }}
            onGoToEvent={onGoToEvent}
          />
        );
      case 'judge': return <JudgeStation confidence={confidence} />;
      case 'added': return <AddedStation entry={entry} />;
      default: return null;
    }
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={traceDialogName(entry.name, entry.n)}
        tabIndex={-1}
        className={styles.dialog}
      >
        <div className={styles.header} data-forge-header>
          <button
            type="button"
            className={`${styles.key} ${styles.iconKey}`}
            onClick={() => onClose()}
            aria-label={CLOSE_TRACE}
            title={CLOSE_TRACE}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3 3L13 13M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <ActorTile index={entry.actorIndex} colour={getActorColorVar(entry.actorIndex)} />
          <span className={styles.number}>{forgedToolLabel(entry.n)}</span>
          <h2 ref={rowNameRef} className={`${styles.name} ${styles.nameInRow}`} tabIndex={-1} translate="no">
            {entry.name}
          </h2>
          <span className={styles.headerEnd}>
            <LookKey />
          </span>
        </div>

        <div className={styles.head} data-forge-head>
          {total > 1 && (
            <div className={styles.attempts} role="group" aria-label={attemptOfTotal(shownAt, total)}>
              <button
                type="button"
                className={`${styles.key} ${styles.iconKey}`}
                aria-label={ATTEMPT_WORDS.previous}
                title={ATTEMPT_WORDS.previous}
                aria-disabled={shownAt <= 1 || undefined}
                onClick={() => { if (shownAt > 1) showAttempt(shownAt - 1, false); }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M10 3.5L5.5 8L10 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span className={styles.attemptLine} data-attempt-line aria-hidden="true">
                {shownAt === total ? attemptCount(shownAt, total) : attemptOfTotal(shownAt, total)}
              </span>
              <button
                type="button"
                className={`${styles.key} ${styles.iconKey}`}
                aria-label={ATTEMPT_WORDS.next}
                title={ATTEMPT_WORDS.next}
                aria-disabled={shownAt >= total || undefined}
                onClick={() => { if (shownAt < total) showAttempt(shownAt + 1, false); }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
          <p className={styles.label}>{AI_WRITTEN_LABEL}</p>
          <h2 ref={headNameRef} className={`${styles.name} ${styles.nameInHead}`} tabIndex={-1} translate="no">
            {entry.name}
          </h2>
          <p className={styles.outcome} data-forge-outcome>
            <OutcomeGlyph kind={glyphFor(outcome)} size={20} />
            <span>{RECORD_OUTCOME_SENTENCES[outcome]}</span>
          </p>
          {!passed && <RecordedReason reason={reason} />}
        </div>

        <div className={styles.line}>
          {openable.length > 1 && (
            <div className={styles.lineHead}>
              <button
                type="button"
                className={styles.key}
                aria-label={allOpen ? OPEN_ALL.closeName : OPEN_ALL.openName}
                onClick={toggleAll}
              >
                {allOpen ? OPEN_ALL.close : OPEN_ALL.open}
              </button>
            </div>
          )}
          <ForgeLine
            model={model}
            size="trace"
            colour={lineColour(entry.actorIndex, actorCount)}
            open={openSet}
            onToggle={toggleStation}
            stationResult={stationResult}
            renderEvidence={renderEvidence}
            onAttempt={(n) => showAttempt(n, true)}
          />
        </div>

        <div className={styles.recordFoot}>
          <button
            type="button"
            className={`${styles.key} ${styles.recordKey}`}
            aria-expanded={recordOpen}
            aria-controls={recordId}
            onClick={() => setRecordOpen((was) => !was)}
          >
            {RECORD_WORDS.key}
          </button>
          <div id={recordId} className={styles.recordBody} hidden={!recordOpen}>
            {recordOpen && <RecordPanel entry={entry} frames={frames} onShowInEventLog={onShowInEventLog} />}
          </div>
        </div>
      </div>
    </div>
  );
}
