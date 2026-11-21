import { Fragment, useId, type CSSProperties } from 'react';
import { getActorColorVar } from '../../hooks/useGameState';
import type { ToolEntry } from '../../hooks/useToolRegistry';
import { forgeLineModel, glyphFor, lineColour, usesOf } from './forgeLine';
import { ForgeLine } from './ForgeLine.tsx';
import { OUTCOME_WORDS, actorLabel, sameName, toolMetaLine, toolRowName } from './forgeWords';
import { OutcomeGlyph } from './OutcomeGlyph';
import styles from './ToolboxList.module.scss';

export interface ToolboxRowProps {
  /** One actor's tool. */
  entry: ToolEntry;
  /** How many actors the run holds: the row's line takes the actor's run colour on a run of two. */
  actorCount: number;
  /** Opens the tool's trace; `el` is the row's key, where focus returns when the trace closes. */
  onOpen: (el: HTMLElement) => void;
  /** The row's place among the list's lines, by which a windowed list renders and measures it. */
  line?: number;
  /** How many rows the whole list holds, and this row's place among them: a screen reader counts the rows a windowed list does not render. */
  setSize?: number;
  posInSet?: number;
}

/** A tool's name with a place to break after each underscore, so a long name wraps between its words. */
function breakable(name: string) {
  const parts = name.split('_');
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i < parts.length - 1 ? `${part}_` : part}
      {i < parts.length - 1 && <wbr />}
    </Fragment>
  ));
}

/**
 * One row of the forged toolbox: one actor's tool, behind a 4 px side mark
 * in the actor's run colour. It holds the tool's number and name, its
 * latest forge's outcome as a word beside its glyph, the forge's line in
 * small, what the tool does, and a meta line led by the actor's label and
 * name: its department and turn, its uses when it was added, and its
 * re-forges when it was forged more than once. A name another actor forged
 * too says which actors.
 *
 * The whole row is one key that opens the tool's trace at its latest
 * attempt. A screen reader hears the tool, its outcome and its actor in the
 * key's name, and what it does and its meta line as the key's description;
 * the line and the side mark are drawn only. The row says its place in the
 * whole list (aria-posinset of aria-setsize), so past 50 lines, where the
 * list renders only the lines in view, a screen reader still counts every
 * row.
 */
export function ToolboxRow({ entry, actorCount, onOpen, line, setSize, posInSet }: ToolboxRowProps) {
  const id = useId();
  const label = actorLabel(entry.actorIndex);
  const kind = glyphFor(entry.outcome);
  const outcome = OUTCOME_WORDS[kind];
  const forges = entry.attempts.length;
  const describes = entry.description !== '' && entry.description !== entry.name;
  const others = entry.sameNameActors.map(actorLabel);
  const style = { '--actor': getActorColorVar(entry.actorIndex) } as CSSProperties;
  return (
    <li
      className={styles.item}
      style={style}
      data-tool-row={entry.n}
      data-tool-name={entry.name}
      data-actor={label}
      data-outcome={entry.outcome}
      data-line={line}
      aria-setsize={setSize}
      aria-posinset={posInSet}
    >
      <span className={styles.sideMark} data-side-mark aria-hidden="true" />
      <button
        type="button"
        className={styles.row}
        aria-label={toolRowName({ name: entry.name, outcome, actorLabel: label, actorName: entry.actorName, forges })}
        aria-describedby={describes ? `${id}-does ${id}-meta` : `${id}-meta`}
        onClick={(e) => onOpen(e.currentTarget)}
      >
        <span className={styles.top}>
          <span className={styles.name} data-row-name data-text="heading">
            <span>[{entry.n}]</span>{' '}
            <span translate="no">{breakable(entry.name)}</span>
          </span>
          <span className={styles.outcome} data-row-outcome>
            <OutcomeGlyph kind={kind} size={20} />
            <span>{outcome}</span>
          </span>
        </span>
        <span className={styles.lineCell}>
          <ForgeLine model={forgeLineModel(entry, Number.NaN)} size="row" colour={lineColour(entry.actorIndex, actorCount)} />
        </span>
        {describes && (
          <span id={`${id}-does`} className={styles.does} data-row-does data-text="body">{entry.description}</span>
        )}
        <span id={`${id}-meta`} className={styles.metaCell}>
          <span className={styles.meta} data-row-meta>
            <span className={styles.actor} data-row-actor>{`${label} ${entry.actorName}`}</span>
            {` · ${toolMetaLine({
              department: entry.firstForgedDepartment,
              turn: entry.firstForgedTurn,
              uses: entry.outcome === 'passed' ? usesOf(entry) : null,
              reforges: Math.max(0, forges - 1),
            })}`}
          </span>
          {others.length > 0 && (
            <span className={styles.same} data-row-same>{sameName(others)}</span>
          )}
        </span>
      </button>
    </li>
  );
}
