import { useEffect, useRef, type ReactNode } from 'react';
import { getActorColorVar } from '../../hooks/useGameState';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { RecordOutcome, ToolEntry } from '../../hooks/useToolRegistry';
import { ActorTile } from './ActorTile';
import { attemptNumber, forgeLineModel, glyphFor, lineColour, usesOf, type StationId } from './forgeLine';
import { ForgeLine } from './ForgeLine.tsx';
import {
  AI_WRITTEN_LABEL,
  CLOSE_TRACE,
  NOT_RECORDED,
  RECORD_OUTCOME_SENTENCES,
  forgedToolLabel,
  judgeApprovedLine,
  traceDialogName,
  usedTimes,
} from './forgeWords';
import { LookKey } from './LookKey';
import { OutcomeGlyph } from './OutcomeGlyph';
import { RecordedReason } from './stations/RecordedReason';
import styles from './TraceDialog.module.scss';

export interface TraceDialogProps {
  /** The actor's tool the trace shows. */
  entry: ToolEntry;
  /** The attempt to show, 1-based. The latest when not given. */
  attempt?: number;
  /** How many actors the run holds: the line takes the actor's run colour on a run of two. */
  actorCount: number;
  onClose: () => void;
}

/**
 * One forged tool's trace, read from the run's record: whose tool it is and
 * its number, one sentence saying what happened to it, and the forge's line
 * of five stations, each closed to the one line the record gives it.
 *
 * The record says whether a forge was approved and no more. An approved
 * forge fills its five stations; any other fills Request alone, and the
 * reason the run recorded stands under the head with no station named.
 *
 * A dialog over the run: a full-screen sheet with its header row fixed on a
 * phone, a centred dialog from 900 px. It opens with focus on the tool's
 * name, holds focus until it closes, and Escape closes it.
 */
export function TraceDialog({ entry, attempt, actorCount, onClose }: TraceDialogProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const rowNameRef = useRef<HTMLHeadingElement | null>(null);
  const headNameRef = useRef<HTMLHeadingElement | null>(null);

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

  const shownAt = attemptNumber(entry, attempt ?? Number.NaN);
  const shown = shownAt > 0 ? entry.attempts[shownAt - 1] : null;
  const outcome: RecordOutcome = shown ? (shown.approved ? 'passed' : 'did_not_pass') : entry.outcome;
  const passed = outcome === 'passed';
  const reason = shown ? shown.errorReason : entry.errorReason ?? null;
  const confidence = shown?.confidence ?? entry.confidence;
  const model = forgeLineModel(entry, shownAt);

  // Each closed station's one line. A station the record says nothing of keeps the line's own word for it.
  const stationResult = (station: StationId): ReactNode => {
    switch (station) {
      case 'request': return shown?.description || entry.description;
      case 'code': return passed ? NOT_RECORDED.code : null;
      case 'tests': return passed ? NOT_RECORDED.tests : null;
      case 'judge': return passed ? judgeApprovedLine(confidence) : null;
      case 'added': return passed ? usedTimes(usesOf(entry)) : null;
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
            onClick={onClose}
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
          <ForgeLine
            model={model}
            size="trace"
            colour={lineColour(entry.actorIndex, actorCount)}
            stationResult={stationResult}
          />
        </div>
      </div>
    </div>
  );
}
