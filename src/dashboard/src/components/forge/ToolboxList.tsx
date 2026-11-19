import { useCallback, useId, useMemo, useRef } from 'react';
import { useToolContext, type RecordOutcome, type ToolEntry } from '../../hooks/useToolRegistry';
import { STATIONS } from './forgeLine';
import { ForgeStrip } from './ForgeStrip';
import { useForgeView, useToolboxView, type ToolboxShow } from './forgeViewContext';
import {
  FIND_WORDS,
  SHOW_WORDS,
  STATION_WORDS,
  TOOLBOX_EMPTY,
  countWord,
  noToolMatches,
  toolboxCountLine,
} from './forgeWords';
import { ToolboxRow } from './ToolboxRow';
import styles from './ToolboxList.module.scss';

/**
 * The rows a filter and a search leave: the rows of one outcome, a row
 * showing under its latest attempt's outcome, whose names hold the search's
 * text, in any case. Every row for 'all' and an empty search.
 */
export function filterRows(rows: ToolEntry[], show: 'all' | RecordOutcome, find: string): ToolEntry[] {
  const query = find.trim().toLowerCase();
  if (show === 'all' && query === '') return rows;
  return rows.filter((row) => (show === 'all' || row.outcome === show) && (query === '' || row.name.toLowerCase().includes(query)));
}

const NO_FORGES: RecordOutcome[] = [];

export interface ToolboxListProps {
  /** In Reports' page, where the list is part of the page; not given, the toolbox dialog's list. */
  inPage?: boolean;
}

/**
 * The forged toolbox's list, read from the run's record: a count line, one
 * row of keys (the filter and Find a tool), the five station names once,
 * then one row for each actor's tool.
 *
 * The count line counts forges: its outcomes add up to them, and its
 * bracket says how many were re-forges, so the tools and the forges
 * reconcile on sight. The filter counts the rows it shows, a row showing
 * under its latest forge's outcome; an outcome no row holds is left out. It
 * is a row of segments from 768 px and a one-row menu below that. Find a
 * tool narrows the rows by name as it is typed.
 *
 * The filter and the search are the provider's, one for the toolbox dialog
 * and for Reports' page, kept in the page's address. A row opens its tool's
 * trace, and focus returns to the row when the trace closes.
 */
export function ToolboxList({ inPage = false }: ToolboxListProps) {
  const registry = useToolContext();
  const { show, find, set } = useToolboxView();
  const { openTrace } = useForgeView();
  const findId = useId();
  const showName = useId();
  const keysRef = useRef<HTMLDivElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);

  const all = registry.list;
  const rows = useMemo(() => filterRows(all, show, find), [all, show, find]);

  // The filter's choices: All, each outcome a row holds, and the chosen one though no row holds it.
  const choices = useMemo(() => {
    const passed = all.filter((row) => row.outcome === 'passed').length;
    const counted: Array<{ id: ToolboxShow; count: number }> = [
      { id: 'all', count: all.length },
      { id: 'passed', count: passed },
      { id: 'did_not_pass', count: all.length - passed },
    ];
    return counted.filter((choice) => choice.id === 'all' || choice.count > 0 || choice.id === show);
  }, [all, show]);

  const openRow = useCallback((entry: ToolEntry, el: HTMLElement) => {
    openTrace({ actorIndex: entry.actorIndex, toolName: entry.name }, el);
  }, [openTrace]);

  // Clear empties the search and keeps focus in its field.
  const clearFind = () => {
    set({ find: '' });
    findRef.current?.focus();
  };
  // All, the way forward from a filter with no row: focus goes to the filter.
  const showAll = () => {
    set({ show: 'all' });
    const controls = keysRef.current?.querySelectorAll<HTMLElement>('input[type="radio"][value="all"], select');
    Array.from(controls ?? []).find((el) => el.offsetParent !== null)?.focus();
  };

  const actorCount = registry.actors.length;
  const choiceLabel = (choice: { id: ToolboxShow; count: number }) => `${SHOW_WORDS[choice.id]} ${countWord(choice.count)}`;

  return (
    <div className={styles.list} data-toolbox-list={inPage ? 'page' : 'dialog'}>
      <p className={styles.count} data-toolbox-count>{toolboxCountLine(registry.counts, actorCount)}</p>

      {all.length === 0 ? (
        <div className={styles.empty} data-toolbox-empty="no-tools">
          <ForgeStrip cells={NO_FORGES} />
          <p className={styles.emptyWords}>{TOOLBOX_EMPTY.noTools}</p>
        </div>
      ) : (
        <>
          <div ref={keysRef} className={styles.keys} data-toolbox-keys>
            <div className={styles.segments} role="radiogroup" aria-label={SHOW_WORDS.name}>
              {choices.map((choice) => (
                <label key={choice.id} className={styles.segment} data-show={choice.id}>
                  <input
                    type="radio"
                    name={showName}
                    value={choice.id}
                    checked={show === choice.id}
                    onChange={() => set({ show: choice.id })}
                  />
                  <span>{choiceLabel(choice)}</span>
                </label>
              ))}
            </div>
            <label className={styles.menu} data-toolbox-menu>
              <span aria-hidden="true">{SHOW_WORDS.menuLead}</span>
              <select
                className={styles.menuSelect}
                aria-label={SHOW_WORDS.name}
                value={show}
                onChange={(e) => set({ show: e.target.value as ToolboxShow })}
              >
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>{choiceLabel(choice)}</option>
                ))}
              </select>
              <svg className={styles.menuMark} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M3.5 6L8 10.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>
            <div className={styles.find}>
              <label className={styles.findLabel} htmlFor={findId}>{FIND_WORDS.label}</label>
              <span className={styles.field}>
                <input
                  id={findId}
                  ref={findRef}
                  className={styles.input}
                  type="search"
                  placeholder={FIND_WORDS.placeholder}
                  value={find}
                  onChange={(e) => set({ find: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
                {find !== '' && (
                  <button
                    type="button"
                    className={styles.clear}
                    aria-label={FIND_WORDS.clearName}
                    title={FIND_WORDS.clearName}
                    onClick={clearFind}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M3 3L13 13M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </span>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className={styles.empty} data-toolbox-empty={find.trim() !== '' ? 'no-match' : 'no-rows'}>
              {find.trim() !== '' ? (
                <>
                  <p className={styles.emptyWords}>{noToolMatches(find.trim())}</p>
                  <button type="button" className={styles.key} onClick={clearFind}>{FIND_WORDS.clear}</button>
                </>
              ) : (
                <>
                  {show === 'did_not_pass' && <p className={styles.emptyWords}>{TOOLBOX_EMPTY.everyToolPassed}</p>}
                  <button type="button" className={styles.key} onClick={showAll}>{SHOW_WORDS.all}</button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.rows}>
              <div className={styles.head} aria-hidden="true">
                <span className={styles.stations} data-toolbox-stations>
                  {STATIONS.map((station) => (
                    <span key={station}>{STATION_WORDS[station]}</span>
                  ))}
                </span>
              </div>
              <ol className={styles.items} data-toolbox-rows>
                {rows.map((entry) => (
                  <ToolboxRow
                    key={`${entry.actorIndex}:${entry.name}`}
                    entry={entry}
                    actorCount={actorCount}
                    onOpen={(el) => openRow(entry, el)}
                  />
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  );
}
