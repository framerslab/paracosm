import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { getActorColorVar } from '../../hooks/useGameState';
import { actorRange, sendForgeEvent } from '../../analytics/forgeEvents';
import type { ActorSummary } from '../../hooks/useToolRegistry';
import { useMediaQuery } from '../viz/grid/useMediaQuery';
import { ActorTile } from './ActorTile';
import { PICKER_SORTS, matchActors, pickerState, selectShown, sortActors, type PickerSort } from './actorPicker.helpers';
import { ForgeStrip } from './ForgeStrip';
import {
  ACTOR_PICKER_WORDS,
  SORT_WORDS,
  actorFoldName,
  actorToolsUnreadable,
  noActorMatches,
  pickerCounts,
  showingActors,
} from './forgeWords';
import { useWindowedLines, type WindowLine } from './useWindowedLines';
import list from './ToolboxList.module.scss';
import styles from './ActorPicker.module.scss';

export interface ActorPickerProps {
  /** The run's actors in launch order. */
  actors: ActorSummary[];
  /** The actors chosen, by launch index; none chosen shows every actor. */
  chosen: ReadonlySet<number>;
  /** The most actors that may be chosen (8 in Compare); no limit when not given. */
  max?: number;
  /** How many tools the run holds: a run with tools and no actor could not be read. */
  tools?: number;
  /** A choice, applied at once. */
  onChange: (chosen: Set<number>) => void;
  onClose: () => void;
  /** The key that opened the picker: the popover stands under it, and focus returns to it. */
  opener: HTMLElement | null;
  /** The surface the picker narrows, for the forge view's events: the toolbox when not given. */
  where?: 'toolbox' | 'compare' | 'event_log';
}

/** A row's height before it is measured: two lines on a phone and a tablet, one line from 900 px. */
const ROW_ESTIMATE = 56;

/** What takes focus by Tab inside the picker. */
const TABBABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where the popover stands from 900 px: under its key, kept inside the window. */
interface Place {
  top: number;
  left: number;
  maxHeight: number;
}

/** A check, drawn in a checked box. */
function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5L6.5 12L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The actor picker, one control for the toolbox, Compare and the Event Log:
 * a dialog named "Choose actors" over a listbox of the run's actors, each
 * with a box to choose it, its tile, its name and archetype, its counts and
 * its forge strip.
 *
 * Find an actor narrows the list by name, archetype or slot label as it is
 * typed, and Sort orders it by the run's order, most tools, or most forges
 * that did not pass. A choice applies at once and is announced politely:
 * "Showing 4 of 24 actors". Select shown chooses every actor the search
 * shows; Clear chooses none, so every actor shows. Past 50 actors the list
 * renders the rows in view as it scrolls, and each option still says its
 * place in the whole list.
 *
 * It opens with focus in Find an actor and holds focus until it closes. Up
 * and Down move through the list, Home and End to its ends, and Space or
 * Enter chooses an actor. Escape and Done close it with focus back on its
 * key; a press outside it closes it where the press lands.
 *
 * A full-screen sheet below 600 px, a sheet from the bottom 70 per cent of
 * the window tall from 600 px, and a popover under its key, 480 px wide,
 * from 900 px and 560 px wide from 1440 px. It is rendered in the dialog
 * that holds its key, or in the page's body, so it is never cut by the
 * list it narrows.
 */
export function ActorPicker({ actors, chosen, max, tools = 0, onChange, onClose, opener, where = 'toolbox' }: ActorPickerProps) {
  const findId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PickerSort>('run');
  const [said, setSaid] = useState('');
  const desktop = useMediaQuery('(min-width: 900px)');
  const wide = useMediaQuery('(min-width: 1440px)');

  const state = pickerState(actors, tools);
  const shown = useMemo(() => sortActors(matchActors(actors, query), sort), [actors, query, sort]);
  const allShownChosen = shown.length > 0 && shown.every((actor) => chosen.has(actor.index));
  const full = max !== undefined && chosen.size >= max;

  // The picker's open counts once.
  const openSentRef = useRef(false);
  useEffect(() => {
    if (openSentRef.current) return;
    openSentRef.current = true;
    sendForgeEvent({ name: 'forge_actor_picker_open', where });
  }, [where]);

  // Focus is in Find an actor when the picker opens. The sheet is still on its
  // way up then, so the focus must not scroll the toolbox under it to reach the field.
  useEffect(() => {
    findRef.current?.focus({ preventScroll: true });
  }, []);

  const closeToOpener = useCallback(() => {
    onClose();
    if (opener?.isConnected) opener.focus();
  }, [onClose, opener]);

  // Tab stays inside the picker and Escape closes it. Both are taken before
  // the toolbox's own focus trap and its Escape see the key.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeToOpener();
        return;
      }
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      e.stopPropagation();
      const items = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE))
        .filter((el) => el.tabIndex >= 0 && el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey ? at <= 0 : at === -1 || at === items.length - 1) {
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0].focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [closeToOpener]);

  // A press outside the picker and its key closes it, and focus stays where the press lands.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || opener?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, opener]);

  // From 900 px the popover stands under its key, and follows it as the toolbox scrolls.
  const [place, setPlace] = useState<Place | null>(null);
  useLayoutEffect(() => {
    if (!desktop || !opener) {
      setPlace(null);
      return undefined;
    }
    const width = wide ? 560 : 480;
    const measure = () => {
      const key = opener.getBoundingClientRect();
      const top = Math.round(key.bottom + 4);
      const left = Math.round(Math.max(8, Math.min(key.left, window.innerWidth - width - 8)));
      const maxHeight = Math.round(Math.max(240, Math.min(560, window.innerHeight - top - 16)));
      setPlace((was) => (was && was.top === top && was.left === left && was.maxHeight === maxHeight ? was : { top, left, maxHeight }));
    };
    measure();
    document.addEventListener('scroll', measure, { capture: true, passive: true });
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('scroll', measure, { capture: true });
      window.removeEventListener('resize', measure);
    };
  }, [desktop, wide, opener]);

  // A choice applies at once, and the picker says how many actors the toolbox now shows.
  const choose = useCallback((next: Set<number>) => {
    onChange(next);
    // How many actors are chosen, as a range; Clear chooses none, which is every actor and no filter.
    const range = actorRange(next.size);
    if (range) sendForgeEvent({ name: 'forge_actor_filter', actors: range });
    const n = actors.length;
    setSaid(showingActors(next.size === 0 ? n : Math.min(next.size, n), n));
  }, [onChange, actors.length]);

  const toggle = (index: number) => {
    const next = new Set(chosen);
    if (next.has(index)) next.delete(index);
    else if (full) return;
    else next.add(index);
    choose(next);
  };

  // ── The list, windowed past 50 rows, with one row in the Tab order ──
  const lines = useMemo<WindowLine[]>(
    () => shown.map((actor) => ({ key: actor.label, kind: 'option', estimate: ROW_ESTIMATE, focusable: true })),
    [shown],
  );
  const [active, setActive] = useState(0);
  const [inList, setInList] = useState(false);
  const [innerEl, setInnerEl] = useState<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const focusPending = useRef(false);
  const at = Math.min(active, Math.max(0, shown.length - 1));
  const win = useWindowedLines(lines, innerEl, inList ? at : null);
  // The row a Tab into the list lands on: the active one while it is rendered, else the first in view.
  const tabStop = (at >= win.first && at <= win.last) || at === win.kept ? at : win.first;

  // A new search or sort starts the list from its top.
  useEffect(() => {
    setActive(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query, sort]);

  // Up and Down move focus to the row asked for, once it is rendered.
  useLayoutEffect(() => {
    if (!focusPending.current || !innerEl) return;
    const row = innerEl.querySelector<HTMLElement>(`[data-line="${at}"]`);
    if (row) {
      focusPending.current = false;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    } else {
      win.scrollToLine(at);
    }
  });

  const moveTo = (next: number) => {
    if (shown.length === 0) return;
    focusPending.current = true;
    setActive(Math.max(0, Math.min(shown.length - 1, next)));
  };

  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(at + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveTo(at - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveTo(0);
        break;
      case 'End':
        e.preventDefault();
        moveTo(shown.length - 1);
        break;
      case ' ':
      case 'Enter':
        e.preventDefault();
        if (shown[at]) toggle(shown[at].index);
        break;
      default:
        break;
    }
  };

  const clearSearch = () => {
    setQuery('');
    findRef.current?.focus();
  };

  const showAll = () => {
    choose(new Set());
    closeToOpener();
  };

  // The rows in view, and the focused row apart from them when it is far
  // away, with the room of the rows between kept before the later of the two.
  const rows: number[] = [];
  const keptAbove = win.kept !== undefined && win.kept < win.first;
  if (win.kept !== undefined && keptAbove) rows.push(win.kept);
  for (let i = win.first; i <= win.last; i += 1) rows.push(i);
  if (win.kept !== undefined && !keptAbove) rows.push(win.kept);
  const gapAt = win.kept === undefined || !win.gap ? -1 : keptAbove ? win.first : win.kept;
  const pads: CSSProperties | undefined = win.windowed ? { paddingTop: win.padTop, paddingBottom: win.padBottom } : undefined;
  const placed: CSSProperties | undefined = desktop && place ? { top: place.top, left: place.left, maxHeight: place.maxHeight } : undefined;

  const renderRow = (i: number) => {
    const actor = shown[i];
    if (!actor) return null;
    const checked = chosen.has(actor.index);
    const inactive = !checked && full;
    const counts = actor.unreadable
      ? actorToolsUnreadable(actor.label)
      : actor.status === 'waiting' ? ACTOR_PICKER_WORDS.waiting : pickerCounts(actor.counts);
    return (
      <div
        key={actor.label}
        role="option"
        aria-selected={checked}
        aria-disabled={inactive ? true : undefined}
        aria-setsize={shown.length}
        aria-posinset={i + 1}
        aria-label={actorFoldName({
          label: actor.label,
          name: actor.name,
          archetype: actor.archetype,
          tools: actor.counts.tools,
          didNotPass: actor.counts.didNotPass,
          unreadable: actor.unreadable,
        })}
        tabIndex={i === tabStop ? 0 : -1}
        className={styles.option}
        data-actor={actor.label}
        data-line={i}
        onClick={() => {
          setActive(i);
          toggle(actor.index);
        }}
        onFocus={() => setActive(i)}
      >
        <span className={styles.box} data-checked={checked} aria-hidden="true">{checked && <Check />}</span>
        <span className={styles.tile}>
          <ActorTile index={actor.index} colour={getActorColorVar(actor.index)} />
        </span>
        <span className={styles.who} translate="no">
          <span className={styles.name} data-picker-name>{actor.name}</span>
          {actor.archetype && (
            <>
              <span className={styles.dot} aria-hidden="true">{' · '}</span>
              <span className={styles.archetype} data-picker-archetype>{actor.archetype}</span>
            </>
          )}
        </span>
        <span className={styles.second}>
          <span className={styles.counts} data-picker-counts>{counts}</span>
          {!actor.unreadable && (
            <span className={styles.strip}>
              <ForgeStrip cells={actor.strip} max={wide ? 20 : 10} />
            </span>
          )}
        </span>
      </div>
    );
  };

  const picker = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={ACTOR_PICKER_WORDS.dialogName}
      className={styles.picker}
      style={placed}
      data-actor-picker
    >
      {state === 'error' ? (
        <div className={styles.empty} data-picker-error>
          <p className={styles.emptyWords} data-text="body">{ACTOR_PICKER_WORDS.unreadable}</p>
          <button type="button" className={list.key} onClick={showAll}>{ACTOR_PICKER_WORDS.showAll}</button>
        </div>
      ) : (
        <>
          <div className={styles.top}>
            <div className={styles.find}>
              <label className={list.findLabel} htmlFor={findId}>{ACTOR_PICKER_WORDS.findLabel}</label>
              <span className={list.field}>
                <input
                  id={findId}
                  ref={findRef}
                  className={list.input}
                  type="search"
                  placeholder={ACTOR_PICKER_WORDS.findPlaceholder}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                {query !== '' && (
                  <button
                    type="button"
                    className={list.clear}
                    aria-label={ACTOR_PICKER_WORDS.clearSearchName}
                    title={ACTOR_PICKER_WORDS.clearSearchName}
                    onClick={clearSearch}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <path d="M3 3L13 13M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </span>
            </div>
            <label className={styles.sort}>
              <span aria-hidden="true">{ACTOR_PICKER_WORDS.sortLead}</span>
              <select
                className={list.menuSelect}
                aria-label={ACTOR_PICKER_WORDS.sortName}
                value={sort}
                onChange={(e) => setSort(e.target.value as PickerSort)}
              >
                {PICKER_SORTS.map((id) => (
                  <option key={id} value={id}>{SORT_WORDS[id]}</option>
                ))}
              </select>
              <svg className={list.menuMark} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M3.5 6L8 10.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>
          </div>

          {shown.length === 0 ? (
            <div className={styles.empty} data-picker-empty>
              <p className={styles.emptyWords} data-text="body">{noActorMatches(query.trim())}</p>
              <button type="button" className={list.key} onClick={clearSearch}>{ACTOR_PICKER_WORDS.clear}</button>
            </div>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-multiselectable="true"
              aria-label={ACTOR_PICKER_WORDS.listName}
              className={styles.list}
              onKeyDown={onListKey}
              onFocus={() => setInList(true)}
              onBlur={(e) => {
                if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setInList(false);
              }}
            >
              <div ref={setInnerEl} className={styles.rows} style={pads} data-windowed={win.windowed}>
                {rows.flatMap((i) => [
                  i === gapAt ? <div key="gap" aria-hidden="true" data-lines-gap style={{ height: win.gap }} /> : null,
                  renderRow(i),
                ])}
              </div>
            </div>
          )}

          <p className={styles.said} role="status">{said}</p>

          <div className={styles.foot} data-picker-foot>
            <button
              type="button"
              className={list.key}
              aria-disabled={allShownChosen || full || shown.length === 0 ? true : undefined}
              onClick={() => {
                if (allShownChosen || full || shown.length === 0) return;
                choose(selectShown(chosen, shown, max));
              }}
            >
              {ACTOR_PICKER_WORDS.selectShown}
            </button>
            <button type="button" className={list.key} onClick={() => choose(new Set())}>{ACTOR_PICKER_WORDS.clear}</button>
            <button type="button" className={`${list.key} ${styles.done}`} onClick={closeToOpener}>{ACTOR_PICKER_WORDS.done}</button>
          </div>
        </>
      )}
    </div>
  );

  // In the dialog that holds the key, so the toolbox keeps it inside its own
  // modal reach; in the page's body for Reports' page.
  const host = opener?.closest<HTMLElement>('[role="dialog"]') ?? (typeof document === 'undefined' ? null : document.body);
  return host ? createPortal(picker, host) : picker;
}
