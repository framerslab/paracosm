import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { getActorColorVar, type ProcessedEvent } from '../../hooks/useGameState';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useShareLink } from '../../hooks/useShareLink';
import { sendForgeEvent } from '../../analytics/forgeEvents';
import { useToolContext, type RecordOutcome, type ToolEntry } from '../../hooks/useToolRegistry';
import { ActorTile } from './ActorTile';
import { STATIONS, attemptNumber, forgeLineModel, glyphFor, lineColour, usesOf, type StationId } from './forgeLine';
import { ForgeLine } from './ForgeLine.tsx';
import {
  AI_WRITTEN_LABEL,
  ATTEMPT_WORDS,
  CLOSE_TRACE,
  COPY_LINK,
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
import { linkTab, toolLink } from './forgeUrl';
import { initialOpen, keepStations, readKeptStations, recordEvidence, runKeyOf } from './openStations';
import { OutcomeGlyph } from './OutcomeGlyph';
import { RecordPanel, recordFrames } from './RecordPanel';
import { AddedStation } from './stations/AddedStation';
import { JudgeStation } from './stations/JudgeStation';
import { NotRecorded } from './stations/NotRecorded';
import { RecordedReason } from './stations/RecordedReason';
import { RequestStation } from './stations/RequestStation';
import styles from './TraceDialog.module.scss';

/** What the trace shows, for the page's address: its attempt (0 with none) and its open stations, in the line's order. */
export interface TraceShown {
  attempt: number;
  open: StationId[];
}

/** How long Copy link to this tool says the link was copied. */
const LINK_COPIED_FOR_MS = 5_000;

/** Whether the browser says it is online, kept as it changes. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

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
  /** The saved session the page replays or the run last saved as: Copy link to this tool shows when there is one. */
  sessionId?: string | null;
  /** The actor's events: Record shows the ones that name the tool. */
  events: readonly ProcessedEvent[];
  onClose: () => void;
  /** Closes the trace and moves focus to an element of the run view: the event a tool was made for. */
  onGoToEvent: (target: HTMLElement) => void;
  /** Closes the trace and opens the Event Log on this actor's tool. */
  onShowInEventLog: () => void;
  /** Told the attempt on show and the open stations whenever they change, so the page's address names them. */
  onShown?: (shown: TraceShown) => void;
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
 * Copy link to this tool, in the header row when the run has a replay link,
 * copies that link with the tool's number, an earlier attempt and the open
 * stations, and says what became of the copy under the row: copied for five
 * seconds, or not copied with the link shown to select by hand. Offline, it
 * copies as usual and says the page is offline, since the link opens once
 * the connection returns.
 *
 * A dialog over the run: a full-screen sheet with its header row fixed on a
 * phone, a centred dialog from 900 px. It opens with focus on the tool's
 * name, holds focus until it closes, and Escape closes it.
 */
export function TraceDialog({
  entry, attempt, open, actorCount, runKey, sessionId = null, events, onClose, onGoToEvent, onShowInEventLog, onShown,
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

  // The stations the trace opened with beyond the one that decided the
  // outcome were kept on this device or named by a link: each counts once as
  // a station opened from the kept set. The deciding station counts as none.
  const openedWithRef = useRef(false);
  useEffect(() => {
    if (openedWithRef.current) return;
    openedWithRef.current = true;
    for (const station of STATIONS) {
      if (station !== model.deciding && openSet.has(station)) sendForgeEvent({ name: 'forge_station_open', station, via: 'kept' });
    }
  }, [model.deciding, openSet]);

  /** Opens and closes stations, and keeps the open set on this device for the run. */
  const changeOpen = (next: Set<StationId>) => {
    setOpenSet(next);
    const storage = deviceStorage();
    if (storage) keepStations(storage, keptFor, [...next]);
  };
  const toggleStation = (station: StationId) => {
    const next = new Set(openSet);
    if (next.has(station)) next.delete(station);
    else {
      next.add(station);
      sendForgeEvent({ name: 'forge_station_open', station, via: 'press' });
    }
    changeOpen(next);
  };
  // Open all opens every station with evidence; Close all leaves the one that decided the outcome.
  const allOpen = openable.every((s) => openSet.has(s));
  const toggleAll = () => {
    if (!allOpen) {
      for (const station of openable) {
        if (!openSet.has(station)) sendForgeEvent({ name: 'forge_station_open', station, via: 'open_all' });
      }
    }
    changeOpen(new Set(allOpen ? openable.filter((s) => s === model.deciding) : openable));
  };

  // Another attempt swaps the trace in place: the stations open on this one
  // stay open where that one holds evidence, beside its own deciding station.
  /**
   * After a row's link swaps the attempt, focus goes to the row now in its
   * place, the attempt just left, or to the tool's name where the attempt now
   * on show draws no row for it, so focus stays in the trace.
   */
  const focusRowRef = useRef<number | null>(null);
  const showAttempt = (n: number, fromRow: boolean) => {
    const next = attemptNumber(entry, n);
    if (next === 0 || next === shownAt) return;
    const nextPassed = entry.attempts[next - 1].approved;
    setOpenSet(initialOpen(forgeLineModel(entry, next), [...openSet], recordEvidence(nextPassed)));
    focusRowRef.current = fromRow ? shownAt : null;
    setChosen(next);
  };
  // A re-forge that arrives while the trace follows the latest attempt swaps
  // it in place as a key does: the stations open stay open where the new
  // attempt holds evidence, beside its own deciding station.
  const followedRef = useRef(shownAt);
  useEffect(() => {
    if (followedRef.current === shownAt) return;
    followedRef.current = shownAt;
    if (chosen !== undefined) return;
    setOpenSet((now) => initialOpen(model, [...now], hasEvidence));
  }, [shownAt, chosen, model, hasEvidence]);
  useEffect(() => {
    const row = focusRowRef.current;
    focusRowRef.current = null;
    if (row === null) return;
    const target = dialogRef.current?.querySelector<HTMLElement>(`[data-fork-attempt="${row}"]`)
      ?? [rowNameRef.current, headNameRef.current].find((el) => el !== null && el.offsetParent !== null);
    target?.focus();
  }, [shownAt, dialogRef]);

  // The attempt on show and the open stations, for the page's address.
  useEffect(() => {
    onShown?.({ attempt: shownAt, open: STATIONS.filter((s) => openSet.has(s)) });
  }, [onShown, shownAt, openSet]);

  // Copy link to this tool: the run's replay link, naming this tool as it shows now.
  const { shared, share, clear } = useShareLink();
  const online = useOnline();
  const linkNoteId = useId();
  useEffect(() => {
    if (shared?.state !== 'copied') return;
    const timer = window.setTimeout(clear, LINK_COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [shared, clear]);
  const copyLink = () => {
    if (!sessionId) return;
    sendForgeEvent({ name: 'forge_link_copy' });
    share(toolLink(window.location.origin, sessionId, linkTab(window.location.href), {
      actorIndex: entry.actorIndex,
      toolName: entry.name,
      ...(shownAt > 0 ? { attempt: shownAt } : {}),
      open: STATIONS.filter((s) => openSet.has(s)),
    }, registry));
  };
  const copyFailed = shared?.state === 'refused' || shared?.state === 'unanswered';

  // Record: the actor's frames that name the tool, opened in place at the line's foot.
  const [recordOpen, setRecordOpen] = useState(false);
  const frames = useMemo(() => (recordOpen ? recordFrames(events, entry.name) : []), [recordOpen, events, entry.name]);
  const jumpToLog = () => {
    sendForgeEvent({ name: 'forge_log_jump' });
    onShowInEventLog();
  };

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
          <h2 ref={rowNameRef} className={`${styles.name} ${styles.nameInRow}`} tabIndex={-1} translate="no" data-text="heading">
            {entry.name}
          </h2>
          <span className={styles.headerEnd}>
            {sessionId && (
              <button
                type="button"
                className={`${styles.key} ${styles.iconKey}`}
                onClick={copyLink}
                aria-label={COPY_LINK.key}
                aria-describedby={linkNoteId}
                title={COPY_LINK.key}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    d="M6.5 9.5L9.5 6.5M7 4.5L8.5 3a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5L7.5 13A2.5 2.5 0 0 1 4 9.5L5.5 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <LookKey />
          </span>
        </div>

        {sessionId && (
          <div id={linkNoteId} className={styles.linkNote} role="status" aria-live="polite" data-link-note>
            {!online && <p className={styles.linkSaid}>{COPY_LINK.offline}</p>}
            {shared?.state === 'copied' && <p className={styles.linkSaid}>{COPY_LINK.copied}</p>}
            {copyFailed && shared && (
              <>
                <p className={styles.linkSaid}>{COPY_LINK.failed}</p>
                <p className={styles.linkText} data-tool-link translate="no">{shared.url}</p>
              </>
            )}
          </div>
        )}

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
          <h2 ref={headNameRef} className={`${styles.name} ${styles.nameInHead}`} tabIndex={-1} translate="no" data-text="heading">
            {entry.name}
          </h2>
          <p className={styles.outcome} data-forge-outcome data-text="heading">
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
            {recordOpen && <RecordPanel entry={entry} frames={frames} onShowInEventLog={jumpToLog} />}
          </div>
        </div>
      </div>
    </div>
  );
}
