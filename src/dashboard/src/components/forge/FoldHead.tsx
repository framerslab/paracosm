import { useId } from 'react';
import { getActorColorVar } from '../../hooks/useGameState';
import type { ActorSummary, ForgeCounts } from '../../hooks/useToolRegistry';
import { useMediaQuery } from '../viz/grid/useMediaQuery';
import { ActorTile } from './ActorTile';
import { ForgeStrip } from './ForgeStrip';
import {
  NO_TOOLS,
  RECORD_WORDS,
  actorFoldName,
  actorFoldTitle,
  actorToolsUnreadable,
  departmentFoldName,
  foldCountLine,
  registryFull,
} from './forgeWords';
import styles from './ToolboxList.module.scss';

/**
 * The most tools one actor's registry holds: the orchestrator stops adding
 * tools to an actor's registry at 50 (src/runtime/orchestrator/emergent-setup.ts).
 */
export const REGISTRY_LIMIT = 50;

/** What heads a fold of the toolbox: one actor, or one department of every actor. */
export type GroupHead =
  | { kind: 'actor'; actor: ActorSummary }
  | { kind: 'department'; name: string; counts: ForgeCounts };

/** The key a fold is kept open by: its actor's slot label, or its department's name. */
export const foldKey = (head: GroupHead): string =>
  head.kind === 'actor' ? `actor:${head.actor.label}` : `department:${head.name}`;

/** Whether a fold head opens rows: an actor whose tools could not be read, or that forged none, holds no row. */
export const opensRows = (head: GroupHead): boolean =>
  head.kind === 'department' || (!head.actor.unreadable && head.actor.counts.tools > 0);

/**
 * The forge strip's cells by the window's width: every cell below 900 px,
 * where the strip wraps ten cells a row under the head; 30 from 900 px and
 * 50 from 1440 px, on the head's one line, then "+{n}".
 */
function useStripMax(): number {
  const wide = useMediaQuery('(min-width: 1440px)');
  const desktop = useMediaQuery('(min-width: 900px)');
  return wide ? 50 : desktop ? 30 : Number.POSITIVE_INFINITY;
}

/** A chevron pointing right, turned to point down while its fold is open. Drawn only. */
function Chevron() {
  return (
    <svg className={styles.chevron} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 3.5L10.5 8L6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface FoldHeadProps {
  head: GroupHead;
  open: boolean;
  onToggle: () => void;
  /** An actor whose tools could not be read: opens the Event Log on its events, the way forward. */
  onShowInEventLog?: () => void;
}

/**
 * A fold head of the toolbox, inside an h3.
 *
 * An actor's head holds its tile, its name and archetype, its count line and
 * its forge strip (one of the grid's cells a forge, in turn order: never a
 * five-cell line), and says so when the actor's registry is full. It is one
 * key, named by the actor and its counts in words, that opens and closes
 * the actor's rows. An actor whose tools could not be read, or that forged
 * none, has no rows to open: its head is the heading alone, and an
 * unreadable actor's carries Show in Event Log, which opens the Event Log on
 * that actor's events.
 *
 * A department's head holds its name and its count line.
 *
 * Below 900 px a head is two lines with the strip under them, wrapping ten
 * cells a row; from 900 px it is one line with the strip at its right end.
 */
export function FoldHead({ head, open, onToggle, onShowInEventLog }: FoldHeadProps) {
  const noteId = useId();
  const stripMax = useStripMax();

  if (head.kind === 'department') {
    return (
      <h3 className={styles.foldHeading} data-fold-head={head.name}>
        <button
          type="button"
          className={`${styles.foldHead} ${styles.foldHeadDept}`}
          aria-expanded={open}
          aria-label={departmentFoldName(head.name, head.counts)}
          onClick={onToggle}
        >
          <Chevron />
          <span className={styles.foldName} data-fold-name data-text="heading">{head.name}</span>
          <span className={styles.foldCount} data-fold-count>{foldCountLine(head.counts)}</span>
        </button>
      </h3>
    );
  }

  const { actor } = head;
  const full = !actor.unreadable && actor.counts.tools >= REGISTRY_LIMIT;
  const parts = (
    <>
      <span className={styles.foldTile}>
        <ActorTile index={actor.index} colour={getActorColorVar(actor.index)} />
      </span>
      <span className={styles.foldName} data-fold-name translate="no" data-text="heading">
        <span className={styles.foldActor}>{actor.name}</span>
        {actor.archetype ? ` · ${actor.archetype}` : ''}
      </span>
      {actor.unreadable ? (
        <span className={styles.foldCount} data-fold-error>{actorToolsUnreadable(actor.label)}</span>
      ) : (
        <span className={styles.foldCount} data-fold-count>
          {actor.counts.tools === 0 ? NO_TOOLS : foldCountLine(actor.counts)}
        </span>
      )}
      {full && <span id={noteId} className={styles.foldNote} data-fold-note>{registryFull(REGISTRY_LIMIT)}</span>}
      {!actor.unreadable && (
        <span className={styles.foldStrip}>
          <ForgeStrip cells={actor.strip} max={stripMax} />
        </span>
      )}
    </>
  );
  const name = actorFoldName({
    label: actor.label,
    name: actor.name,
    archetype: actor.archetype,
    tools: actor.counts.tools,
    didNotPass: actor.counts.didNotPass,
    unreadable: actor.unreadable,
  });

  if (!opensRows(head)) {
    return (
      <>
        <h3 className={styles.foldHeading} data-fold-head={actor.label}>
          <span className={`${styles.foldHead} ${styles.foldStill}`}>
            <span className={styles.chevronRoom} aria-hidden="true" />
            {parts}
          </span>
        </h3>
        {actor.unreadable && onShowInEventLog && (
          <div className={styles.foldWay}>
            <button type="button" className={styles.key} onClick={onShowInEventLog}>{RECORD_WORDS.showInEventLog}</button>
          </div>
        )}
      </>
    );
  }

  return (
    <h3 className={styles.foldHeading} data-fold-head={actor.label}>
      <button
        type="button"
        className={styles.foldHead}
        aria-expanded={open}
        aria-label={name}
        aria-describedby={full ? noteId : undefined}
        onClick={onToggle}
      >
        <Chevron />
        {parts}
      </button>
    </h3>
  );
}
