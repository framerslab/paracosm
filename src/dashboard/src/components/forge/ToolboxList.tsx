import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useToolContext, type ActorSummary, type ForgeCounts, type RecordOutcome, type ToolEntry } from '../../hooks/useToolRegistry';
import { sendForgeEvent } from '../../analytics/forgeEvents';
import { ActorPicker } from './ActorPicker';
import { pickedActors } from './actorPicker.helpers';
import { FoldHead, foldKey, opensRows, type GroupHead } from './FoldHead';
import { STATIONS } from './forgeLine';
import { ForgeStrip } from './ForgeStrip';
import { TOOLBOX_GROUPS, defaultGroup, useForgeView, useToolboxView, type ToolboxGroup, type ToolboxShow } from './forgeViewContext';
import {
  FIND_WORDS,
  GROUP_WORDS,
  LINE_STATE_WORDS,
  OPEN_ALL_GROUPS,
  SHOW_WORDS,
  STATION_WORDS,
  TOOLBOX_EMPTY,
  actorsKeyLabel,
  chosenCountLine,
  countWord,
  groupKeyLabel,
  noToolMatches,
  toolboxCountLine,
} from './forgeWords';
import { ToolboxRow } from './ToolboxRow';
import { useLineFocus, useWindowedLines, type WindowLine } from './useWindowedLines';
import styles from './ToolboxList.module.scss';

export type { GroupHead } from './FoldHead';

/**
 * The rows a filter, a search and a choice of actors leave: the rows of one
 * outcome, a row showing under its latest attempt's outcome, whose names
 * hold the search's text, in any case, of the actors chosen by launch index.
 * Every row for 'all', an empty search and no actors (null) given.
 */
export function filterRows(
  rows: ToolEntry[],
  show: 'all' | RecordOutcome,
  find: string,
  actors: readonly number[] | null = null,
): ToolEntry[] {
  const query = find.trim().toLowerCase();
  const chosen = actors === null ? null : new Set(actors);
  if (show === 'all' && query === '' && chosen === null) return rows;
  return rows.filter((row) => (chosen === null || chosen.has(row.actorIndex))
    && (show === 'all' || row.outcome === show)
    && (query === '' || row.name.toLowerCase().includes(query)));
}

/** The forges of the actors chosen, added up: the count line's figures while actors are chosen. */
function countsOfActors(actors: ActorSummary[]): ForgeCounts {
  const counts: ForgeCounts = { tools: 0, forges: 0, reforges: 0, passed: 0, didNotPass: 0 };
  for (const actor of actors) {
    counts.tools += actor.counts.tools;
    counts.forges += actor.counts.forges;
    counts.reforges += actor.counts.reforges;
    counts.passed += actor.counts.passed;
    counts.didNotPass += actor.counts.didNotPass;
  }
  return counts;
}

/** The department a row is filed under: the one that first forged it. */
const departmentOf = (row: ToolEntry): string => row.firstForgedDepartment || LINE_STATE_WORDS.unknown;

/** Rows split by a key, the keys in the order each first appears and each key's rows in their own order. */
function byKey(rows: ToolEntry[], keyOf: (row: ToolEntry) => string): Array<[string, ToolEntry[]]> {
  const groups = new Map<string, ToolEntry[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups];
}

/** The forges of a set of rows, counted as the toolbox's count line counts them. */
function countsOf(rows: ToolEntry[]): ForgeCounts {
  const counts: ForgeCounts = { tools: 0, forges: 0, reforges: 0, passed: 0, didNotPass: 0 };
  for (const row of rows) {
    const passed = row.attempts.filter((a) => a.approved).length;
    counts.tools += 1;
    counts.forges += row.attempts.length;
    counts.reforges += Math.max(0, row.attempts.length - 1);
    counts.passed += passed;
    counts.didNotPass += row.attempts.length - passed;
  }
  return counts;
}

/**
 * The rows in their folds. Under Group: None, one group with no head and
 * every row in the run's order. Under Group: Department, one fold for each
 * department in the order each first forged a row, its rows in the run's
 * order, and its count line counting those rows. Under Group: Actor, one
 * fold for each actor in launch order, the actor's rows ordered by
 * department so they sit under a line for each, in the order the actor
 * first forged there; an actor with no row keeps its fold.
 */
export function groupRows(
  rows: ToolEntry[],
  group: 'actor' | 'department' | 'none',
  actors: ActorSummary[],
): Array<{ head: GroupHead | null; rows: ToolEntry[] }> {
  if (group === 'none') return [{ head: null, rows }];
  if (group === 'department') {
    return byKey(rows, departmentOf).map(([name, own]): { head: GroupHead; rows: ToolEntry[] } => ({
      head: { kind: 'department', name, counts: countsOf(own) },
      rows: own,
    }));
  }
  return actors.map((actor): { head: GroupHead; rows: ToolEntry[] } => {
    const own = rows.filter((row) => row.actorIndex === actor.index);
    return { head: { kind: 'actor', actor }, rows: byKey(own, departmentOf).flatMap(([, inDepartment]) => inDepartment) };
  });
}

/** The height a line is taken to have until a line of its kind is measured, in px. */
const LINE_ESTIMATE = { head: 64, dept: 40, row: 112 } as const;

/** A row's key: one actor's tool. */
const rowKeyOf = (entry: ToolEntry): string => `${entry.actorIndex}:${entry.name}`;

/**
 * One line of the list as it stands: a fold head, a department's line in an
 * actor's open fold, or a row. `fold` is the line's fold among the folds
 * shown (-1 under Group: None), and a row's `pos` its place among every row
 * the filter and the search leave, open fold or closed.
 */
export type ListLine = WindowLine & (
  | { kind: 'head'; fold: number }
  | { kind: 'dept'; fold: number; dept: string }
  | { kind: 'row'; fold: number; dept: string | null; entry: ToolEntry; pos: number }
);

/** A line's department: the line of a department, or a row under one in an actor's fold; null otherwise. */
const deptOf = (line: ListLine): string | null => (line.kind === 'head' ? null : line.dept);

/**
 * The list's lines in the order they stand: under Group: None every row; in
 * folds each head, then in an open fold its rows, under a line for each
 * department in an actor's fold. Rows are counted in this order whether
 * their fold is open or closed, so each row's place is its place in the
 * whole list.
 */
export function listLines(
  group: ToolboxGroup,
  rows: ToolEntry[],
  groups: Array<{ head: GroupHead | null; rows: ToolEntry[] }>,
  isOpen: (key: string) => boolean,
): { lines: ListLine[]; rowCount: number } {
  const lines: ListLine[] = [];
  if (group === 'none') {
    rows.forEach((entry, i) => {
      lines.push({ kind: 'row', key: rowKeyOf(entry), estimate: LINE_ESTIMATE.row, focusable: true, fold: -1, dept: null, entry, pos: i + 1 });
    });
    return { lines, rowCount: rows.length };
  }
  let pos = 0;
  groups.forEach((g, fold) => {
    const head = g.head;
    if (head === null) return;
    const key = foldKey(head);
    const open = opensRows(head) && g.rows.length > 0 && isOpen(key);
    // A head opens its fold, or for an actor whose tools could not be read holds Show in Event Log.
    const focusable = opensRows(head) || (head.kind === 'actor' && head.actor.unreadable);
    lines.push({ kind: 'head', key, estimate: LINE_ESTIMATE.head, focusable, fold });
    const parts: Array<[string | null, ToolEntry[]]> = head.kind === 'actor' ? byKey(g.rows, departmentOf) : [[null, g.rows]];
    for (const [dept, own] of parts) {
      if (open && dept !== null) {
        lines.push({ kind: 'dept', key: `${key}|dept:${dept}`, estimate: LINE_ESTIMATE.dept, focusable: false, headKey: key, fold, dept });
      }
      for (const entry of own) {
        pos += 1;
        if (open) {
          lines.push({ kind: 'row', key: `${key}|${rowKeyOf(entry)}`, estimate: LINE_ESTIMATE.row, focusable: true, headKey: key, fold, dept, entry, pos });
        }
      }
    }
  });
  return { lines, rowCount: pos };
}

/** Folds open on a run of up to this many actors, and start closed on a run of more. */
const FOLDS_OPEN_UP_TO = 8;

/**
 * Which folds are open, for one grouping: every fold at `all` (or at the
 * run's own start when `all` is null), but the ones toggled away from it.
 */
interface FoldState {
  group: ToolboxGroup;
  all: boolean | null;
  toggled: ReadonlySet<string>;
}

const NO_TOGGLES: ReadonlySet<string> = new Set();

const NO_FORGES: RecordOutcome[] = [];

/**
 * Group: a menu button that names the grouping it shows, "Group: Actor".
 * Its menu holds the three groupings, the one shown checked; it opens on the
 * checked one, Up and Down move through them, Enter or Space chooses, and
 * Escape or a press outside closes it with focus back on its key.
 */
function GroupMenu({ value, onChoose }: { value: ToolboxGroup; onChoose: (group: ToolboxGroup) => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const keyRef = useRef<HTMLButtonElement | null>(null);
  const itemsRef = useRef<Array<HTMLDivElement | null>>([]);

  // The menu opens on the grouping shown.
  useEffect(() => {
    if (open) itemsRef.current[TOOLBOX_GROUPS.indexOf(value)]?.focus();
  }, [open, value]);

  // A press outside the menu closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const closeToKey = () => {
    setOpen(false);
    keyRef.current?.focus();
  };
  const choose = (group: ToolboxGroup) => {
    onChoose(group);
    closeToKey();
  };
  const focusItem = (i: number) => itemsRef.current[(i + TOOLBOX_GROUPS.length) % TOOLBOX_GROUPS.length]?.focus();

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = itemsRef.current.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(at + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(at - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(TOOLBOX_GROUPS.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (at >= 0) choose(TOOLBOX_GROUPS[at]);
        break;
      case 'Escape':
        // The menu takes this Escape: the dialog around it stays open.
        e.preventDefault();
        closeToKey();
        break;
      case 'Tab':
        // Focus moves on from the key, as it would from the closed menu.
        closeToKey();
        break;
      default:
        break;
    }
  };

  const onKeyKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div ref={wrapRef} className={styles.groupMenu}>
      <button
        ref={keyRef}
        type="button"
        className={`${styles.key} ${styles.menuKey}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={onKeyKey}
      >
        <span>{groupKeyLabel(value)}</span>
        <svg className={styles.menuKeyMark} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M3.5 6L8 10.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={GROUP_WORDS.name} className={styles.groupList} onKeyDown={onMenuKey}>
          {TOOLBOX_GROUPS.map((group, i) => (
            <div
              key={group}
              ref={(el) => { itemsRef.current[i] = el; }}
              role="menuitemradio"
              aria-checked={group === value}
              tabIndex={-1}
              className={styles.groupItem}
              onClick={() => choose(group)}
            >
              <svg className={styles.groupCheck} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M3 8.5L6.5 12L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{GROUP_WORDS[group]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ToolboxListProps {
  /** In Reports' page, where the list is part of the page; not given, the toolbox dialog's list. */
  inPage?: boolean;
}

/**
 * The forged toolbox's list, read from the run's record: a count line, the
 * keys (Group, Actors, the filter and Find a tool), Open all groups and the
 * five station names once, then the rows, folded as Group says.
 *
 * The count line counts forges: its outcomes add up to them, and its
 * bracket says how many were re-forges, so the tools and the forges
 * reconcile on sight. The filter counts the rows it shows, a row showing
 * under its latest forge's outcome; an outcome no row holds is left out. It
 * is a row of segments from 768 px and a one-row menu below that. Find a
 * tool narrows the rows by name as it is typed.
 *
 * Group folds the rows by actor or by department, or lists them as one:
 * None on a run of two actors and Actor on a run of more. Folds start open
 * on a run of up to 8 actors and closed past 8, and Open all groups opens or
 * closes them all. A filter or a search leaves out the folds it empties; an
 * actor whose tools could not be read keeps its fold, which says so.
 *
 * Actors opens the actor picker, and the actors it chooses narrow the rows,
 * the folds, the filter's counts and Export JSON at once; the count line
 * then reads "Showing 3 of 24 actors · …" with those actors' figures, and
 * the key "Actors: 3 of 24". Below 1440 px Group and Actors stand on a row
 * of their own over the filter and Find a tool; from 1440 px the four share
 * one row.
 *
 * The filter, the search, the grouping and the chosen actors are the
 * provider's, one for the toolbox dialog and for Reports' page, kept in the
 * page's address. A row
 * opens its tool's trace, and focus returns to the row when the trace
 * closes. Which folds are open is this list's own.
 */
export function ToolboxList({ inPage = false }: ToolboxListProps) {
  const registry = useToolContext();
  const { show, find, group: chosenGroup, actors: chosenActors, set } = useToolboxView();
  const { openTrace, showActorLog } = useForgeView();
  const findId = useId();
  const showName = useId();
  const keysRef = useRef<HTMLDivElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const actorsKeyRef = useRef<HTMLButtonElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const actorCount = registry.actors.length;
  // The actors chosen, in launch order, or null for every actor.
  const picked = useMemo(() => pickedActors(chosenActors, actorCount), [chosenActors, actorCount]);
  const pickedSummaries = useMemo(
    () => (picked === null ? registry.actors : picked.map((index) => registry.actors[index])),
    [picked, registry.actors],
  );
  const chosenSet = useMemo(() => new Set(chosenActors.filter((index) => index < actorCount)), [chosenActors, actorCount]);
  // The chosen actors' rows, and of those the rows the filter and the search leave.
  const all = useMemo(() => filterRows(registry.list, 'all', '', picked), [registry.list, picked]);
  const rows = useMemo(() => filterRows(all, show, find), [all, show, find]);
  const group: ToolboxGroup = chosenGroup ?? defaultGroup(actorCount);
  const narrowed = show !== 'all' || find.trim() !== '';

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

  // The folds to show: the chosen actors', and a filter or a search leaves out the folds it empties.
  const groups = useMemo(() => {
    const folded = groupRows(rows, group, pickedSummaries);
    if (!narrowed) return folded;
    return folded.filter((g) => g.head === null || g.rows.length > 0 || (g.head.kind === 'actor' && g.head.actor.unreadable));
  }, [rows, group, pickedSummaries, narrowed]);

  // The count line: the run's, or while actors are chosen how many it shows and their figures.
  const countLine = picked === null
    ? toolboxCountLine(registry.counts, actorCount)
    : chosenCountLine(picked.length, actorCount, countsOfActors(pickedSummaries));
  const chooseActors = useCallback((next: Set<number>) => {
    set({ actors: [...next].sort((a, b) => a - b) });
  }, [set]);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Which folds are open: a new grouping starts from the run's own start.
  const [folds, setFolds] = useState<FoldState>({ group, all: null, toggled: NO_TOGGLES });
  const foldState: FoldState = useMemo(
    () => (folds.group === group ? folds : { group, all: null, toggled: NO_TOGGLES }),
    [folds, group],
  );
  const openAtStart = actorCount <= FOLDS_OPEN_UP_TO;
  const isOpen = useCallback(
    (key: string): boolean => (foldState.all ?? openAtStart) !== foldState.toggled.has(key),
    [foldState, openAtStart],
  );
  const openable = groups.filter((g): g is { head: GroupHead; rows: ToolEntry[] } => g.head !== null && opensRows(g.head) && g.rows.length > 0);
  const allOpen = openable.length > 0 && openable.every((g) => isOpen(foldKey(g.head)));
  const groupsInactive = group === 'none' || openable.length === 0;

  const toggleFold = (key: string) => {
    sendForgeEvent({ name: 'forge_group_toggle', scope: 'one' });
    setFolds((was) => {
      const base: FoldState = was.group === group ? was : { group, all: null, toggled: NO_TOGGLES };
      const toggled = new Set(base.toggled);
      if (toggled.has(key)) toggled.delete(key);
      else toggled.add(key);
      return { ...base, toggled };
    });
  };
  const toggleAll = () => {
    sendForgeEvent({ name: 'forge_group_toggle', scope: 'all' });
    setFolds({ group, all: !allOpen, toggled: NO_TOGGLES });
  };
  // The run's own grouping is kept as no choice, so the page's link names a grouping only when a visitor chose another.
  const chooseGroup = (next: ToolboxGroup) => {
    if (next !== group) sendForgeEvent({ name: 'forge_toolbox_group', group: next });
    set({ group: next === defaultGroup(actorCount) ? null : next });
  };
  /** The filter a visitor chose: the rows of one outcome, or every row. */
  const chooseShow = (next: ToolboxShow) => {
    if (next !== show) sendForgeEvent({ name: 'forge_toolbox_filter', show: next });
    set({ show: next });
  };

  const openRow = useCallback((entry: ToolEntry, el: HTMLElement) => {
    openTrace({ actorIndex: entry.actorIndex, toolName: entry.name }, el, 'toolbox');
  }, [openTrace]);

  // The lines, and past 50 the ones in view: the line that holds focus stays rendered.
  const { lines, rowCount } = useMemo(() => listLines(group, rows, groups, isOpen), [group, rows, groups, isOpen]);
  const [linesEl, setLinesEl] = useState<HTMLElement | null>(null);
  const focus = useLineFocus(lines, linesEl);
  const win = useWindowedLines(lines, linesEl, focus.keep);
  focus.scrollTo.current = win.scrollToLine;

  // Clear empties the search and keeps focus in its field.
  const clearFind = () => {
    set({ find: '' });
    findRef.current?.focus();
  };
  // All, the way forward from a filter with no row: focus goes to the filter.
  const showAll = () => {
    chooseShow('all');
    const controls = keysRef.current?.querySelectorAll<HTMLElement>('input[type="radio"][value="all"], select');
    Array.from(controls ?? []).find((el) => el.offsetParent !== null)?.focus();
  };

  const choiceLabel = (choice: { id: ToolboxShow; count: number }) => `${SHOW_WORDS[choice.id]} ${countWord(choice.count)}`;
  const renderRow = (at: number) => {
    const line = lines[at];
    if (line.kind !== 'row') return null;
    return (
      <ToolboxRow
        key={rowKeyOf(line.entry)}
        entry={line.entry}
        actorCount={actorCount}
        onOpen={(el) => openRow(line.entry, el)}
        line={at}
        setSize={rowCount}
        posInSet={line.pos}
      />
    );
  };

  // The lines rendered, in order, and the room kept for the ones left out
  // above and below. A line that holds focus far from the view renders apart
  // from the lines in view, above or below them, with the room of the lines
  // between kept before the later of the two.
  const shown: number[] = [];
  const keptAbove = win.kept !== undefined && win.kept < win.first;
  if (win.kept !== undefined && keptAbove) shown.push(win.kept);
  for (let at = win.first; at <= win.last; at += 1) shown.push(at);
  if (win.kept !== undefined && !keptAbove) shown.push(win.kept);
  const gapAt = win.kept === undefined || !win.gap ? -1 : keptAbove ? win.first : win.kept;
  /** The room of the lines between, drawn only, before the line it stands before. */
  const gapBefore = (at: number, inList: boolean) => {
    if (at !== gapAt) return null;
    const style: CSSProperties = { height: win.gap };
    return inList
      ? <li key="gap" role="presentation" aria-hidden="true" data-lines-gap style={style} />
      : <div key="gap" aria-hidden="true" data-lines-gap style={style} />;
  };
  const rowsWithGap = (at: number[]) => at.flatMap((i) => [gapBefore(i, true), renderRow(i)]);
  const pads: CSSProperties | undefined = win.windowed ? { paddingTop: win.padTop, paddingBottom: win.padBottom } : undefined;
  // Grouped, the rendered lines by their fold, and within an actor's fold by department.
  const foldsShown: Array<{ fold: number; at: number[] }> = [];
  for (const at of shown) {
    const lastFold = foldsShown[foldsShown.length - 1];
    if (lastFold && lastFold.fold === lines[at].fold) lastFold.at.push(at);
    else foldsShown.push({ fold: lines[at].fold, at: [at] });
  }
  const byDepartment = (at: number[]): Array<{ dept: string; at: number[] }> => {
    const parts: Array<{ dept: string; at: number[] }> = [];
    for (const i of at) {
      const dept = deptOf(lines[i]) ?? '';
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart.dept === dept) lastPart.at.push(i);
      else parts.push({ dept, at: [i] });
    }
    return parts;
  };

  return (
    <div className={styles.list} data-toolbox-list={inPage ? 'page' : 'dialog'}>
      <p className={styles.count} data-toolbox-count>{countLine}</p>

      {registry.list.length === 0 ? (
        <div className={styles.empty} data-toolbox-empty="no-tools">
          <ForgeStrip cells={NO_FORGES} />
          <p className={styles.emptyWords} data-text="body">{TOOLBOX_EMPTY.noTools}</p>
        </div>
      ) : (
        <>
          <div className={styles.keyRows}>
            <div className={styles.lead} data-toolbox-lead>
              <GroupMenu value={group} onChoose={chooseGroup} />
              <div className={styles.actorsMenu}>
                <button
                  ref={actorsKeyRef}
                  type="button"
                  className={styles.key}
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  onClick={() => setPickerOpen((was) => !was)}
                >
                  {actorsKeyLabel(picked === null ? null : picked.length, actorCount)}
                </button>
                {pickerOpen && (
                  <ActorPicker
                    actors={registry.actors}
                    tools={registry.list.length}
                    chosen={chosenSet}
                    onChange={chooseActors}
                    onClose={closePicker}
                    opener={actorsKeyRef.current}
                  />
                )}
              </div>
            </div>
            <div ref={keysRef} className={styles.keys} data-toolbox-keys>
              <div className={styles.segments} role="radiogroup" aria-label={SHOW_WORDS.name}>
                {choices.map((choice) => (
                  <label key={choice.id} className={styles.segment} data-show={choice.id}>
                    <input
                      type="radio"
                      name={showName}
                      value={choice.id}
                      checked={show === choice.id}
                      onChange={() => chooseShow(choice.id)}
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
                  onChange={(e) => chooseShow(e.target.value as ToolboxShow)}
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
          </div>

          {rows.length === 0 && narrowed ? (
            <div className={styles.empty} data-toolbox-empty={find.trim() !== '' ? 'no-match' : 'no-rows'}>
              {find.trim() !== '' ? (
                <>
                  <p className={styles.emptyWords} data-text="body">{noToolMatches(find.trim())}</p>
                  <button type="button" className={styles.key} onClick={clearFind}>{FIND_WORDS.clear}</button>
                </>
              ) : (
                <>
                  {/* The sentence speaks of the whole run, so it stands only while every actor is shown. */}
                  {show === 'did_not_pass' && picked === null && <p className={styles.emptyWords} data-text="body">{TOOLBOX_EMPTY.everyToolPassed}</p>}
                  <button type="button" className={styles.key} onClick={showAll}>{SHOW_WORDS.all}</button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.rows}>
              <div className={styles.head}>
                <button
                  type="button"
                  className={`${styles.key} ${styles.openAll}`}
                  aria-disabled={groupsInactive ? true : undefined}
                  tabIndex={groupsInactive ? -1 : undefined}
                  onClick={groupsInactive ? undefined : toggleAll}
                >
                  {allOpen ? OPEN_ALL_GROUPS.close : OPEN_ALL_GROUPS.open}
                </button>
                <span className={styles.stations} data-toolbox-stations aria-hidden="true">
                  {STATIONS.map((station) => (
                    <span key={station}>{STATION_WORDS[station]}</span>
                  ))}
                </span>
              </div>
              {group === 'none' ? (
                <ol
                  ref={setLinesEl}
                  className={styles.items}
                  data-toolbox-rows
                  data-line-count={lines.length}
                  data-windowed={win.windowed}
                  style={pads}
                >
                  {rowsWithGap(shown)}
                </ol>
              ) : (
                <div
                  ref={setLinesEl}
                  role="list"
                  className={styles.groups}
                  data-toolbox-rows
                  data-line-count={lines.length}
                  data-windowed={win.windowed}
                  style={pads}
                >
                  {foldsShown.map(({ fold, at }) => {
                    const g = groups[fold];
                    const head = g?.head ?? null;
                    if (head === null) return null;
                    const key = foldKey(head);
                    const open = opensRows(head) && g.rows.length > 0 && isOpen(key);
                    const headAt = at.find((i) => lines[i].kind === 'head');
                    const body = at.filter((i) => lines[i].kind !== 'head');
                    // Each fold is one of the list's groups, and says its place among them.
                    return (
                      <div
                        key={key}
                        role="listitem"
                        aria-setsize={groups.length}
                        aria-posinset={fold + 1}
                        className={styles.fold}
                        data-fold={head.kind === 'actor' ? head.actor.label : head.name}
                      >
                        {headAt !== undefined && gapBefore(headAt, false)}
                        {headAt !== undefined && (
                          <div className={styles.foldTop} data-line={headAt}>
                            <FoldHead
                              head={head}
                              open={open}
                              onToggle={() => toggleFold(key)}
                              onShowInEventLog={head.kind === 'actor' && head.actor.unreadable ? () => showActorLog(head.actor.index) : undefined}
                            />
                          </div>
                        )}
                        {head.kind === 'actor' ? (
                          byDepartment(body).map(({ dept, at: part }) => {
                            const deptAt = part.find((i) => lines[i].kind === 'dept');
                            const rowsAt = part.filter((i) => lines[i].kind === 'row');
                            return (
                              <div key={dept} className={styles.department}>
                                {deptAt !== undefined && gapBefore(deptAt, false)}
                                {deptAt !== undefined && (
                                  <h4 className={styles.deptLine} data-dept-line data-line={deptAt}>{dept}</h4>
                                )}
                                {rowsAt.length > 0 && <ol className={styles.items}>{rowsWithGap(rowsAt)}</ol>}
                              </div>
                            );
                          })
                        ) : (
                          body.length > 0 && <ol className={styles.items}>{rowsWithGap(body)}</ol>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
