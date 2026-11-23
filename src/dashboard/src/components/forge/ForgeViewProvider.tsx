import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameState, ProcessedEvent } from '../../hooks/useGameState';
import { useToolContext } from '../../hooks/useToolRegistry';
import { sendForgeEvent, type ToolboxOpenFrom, type TraceOpenFrom } from '../../analytics/forgeEvents';
import { TRACE_PARAMS, parseForgeUrl, withForgeState, withToolbox, withoutForgeParams } from './forgeUrl';
import {
  ALL_ROWS,
  ForgeViewContext,
  TOOLBOX_GROUPS,
  TOOLBOX_SHOWS,
  ToolboxViewContext,
  type ForgeView,
  type ToolboxFilter,
  type ToolboxGroup,
  type ToolboxShow,
  type ToolboxView,
  type TraceTarget,
} from './forgeViewContext';
import { ToolboxDialog } from './ToolboxDialog';
import { TraceDialog, type TraceShown } from './TraceDialog';

export { useForgeView, useToolboxView } from './forgeViewContext';
export type { ForgeView, ToolboxFilter, ToolboxGroup, ToolboxShow, ToolboxView, TraceTarget } from './forgeViewContext';

const NOTHING_OPEN: ForgeView['current'] = { trace: null, toolbox: false };

const NO_EVENTS: readonly ProcessedEvent[] = [];

/**
 * The filter, the search, the grouping and the chosen actors an address
 * names: every row for a filter it does not know, the run's own grouping for
 * a grouping it does not know, and the actors by launch index, each once in
 * launch order, from the address's 1-based slots.
 */
function filterOf(href: string): ToolboxFilter {
  const { show, find, group, actors } = parseForgeUrl(href, { getEntryByNumber: () => undefined, actors: [] }, false).state.toolbox;
  return {
    show: TOOLBOX_SHOWS.includes(show as ToolboxShow) ? (show as ToolboxShow) : 'all',
    find: find ?? '',
    group: TOOLBOX_GROUPS.includes(group as ToolboxGroup) ? (group as ToolboxGroup) : null,
    actors: [...new Set((actors ?? []).map((slot) => slot - 1))].sort((a, b) => a - b),
  };
}

const sameActors = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((index, i) => index === b[i]);

const sameFilter = (a: ToolboxFilter, b: ToolboxFilter): boolean =>
  a.show === b.show && a.find === b.find && a.group === b.group && sameActors(a.actors, b.actors);

export interface ForgeViewProviderProps {
  /** The run on the page: its actors and their events. */
  state: GameState;
  /** The run's key, which tells one run on this page from the next. Null with no run. */
  runKey: string | null;
  /** The saved session the page replays or the run last saved as. Null for a run with none. */
  sessionId: string | null;
  /**
   * Opens the Settings tab's Event Log on one actor's tool: App's own
   * navigation. An empty tool name opens it on the actor's events alone.
   */
  showToolLog?: (toolName: string, actorName: string) => void;
  children: ReactNode;
}

/**
 * The one host of the forge view's dialogs. Mounted once, inside the tool
 * registry's provider, it opens a tool's trace or the forged toolbox from
 * any surface and renders them. A toolbox row's trace opens over the
 * toolbox, and closing that trace leaves the toolbox open with focus on the
 * row.
 *
 * Opening adds one entry to the page's history, so a phone's Back closes the
 * dialog and leaves the run on the page. Closing by a key steps back over
 * that entry, so Back afterwards does what it did before the dialog opened.
 * The toolbox and a trace over it share that one entry: Back closes the
 * trace, the toolbox takes a new entry, and the next Back closes the toolbox.
 *
 * What is open is written into its entry's address, so the page's link
 * names it: the toolbox, and a trace's tool by its number, an earlier
 * attempt and the open stations. The entry under it keeps the address
 * without them, so closing leaves neither. The toolbox's filter and search
 * are one for the dialog and the list in Reports' page; they are written
 * into the address of the page as well, so a link opens the same rows on
 * either.
 *
 * Once the run is complete the address is read: a link opens the toolbox,
 * one tool's trace, or both, and the parameters that point at nothing in the
 * run leave the address. A tool's number is never read while a run plays in,
 * since an earlier actor's first forge can still move it.
 */
export function ForgeViewProvider({ state, runKey, sessionId, showToolLog, children }: ForgeViewProviderProps) {
  const registry = useToolContext();
  const [current, setCurrent] = useState<ForgeView['current']>(NOTHING_OPEN);
  /** The key that opened the first dialog: focus returns to it once every dialog is closed. */
  const openerRef = useRef<HTMLElement | null>(null);
  /** The toolbox row whose trace is open over the toolbox: focus returns to it when that trace closes. */
  const rowRef = useRef<HTMLElement | null>(null);
  /** Whether the toolbox is open, known the moment it opens or closes. */
  const toolboxOpenRef = useRef(false);
  /** Whether the history entry added for the open dialog is the page's current one. */
  const entryRef = useRef(false);
  /** Steps back this provider asked for and whose popstate it has yet to see. */
  const ownBacksRef = useRef(0);
  /** The element of the run view a closed dialog sent focus to, kept in view once the step back lands. */
  const landingRef = useRef<HTMLElement | null>(null);
  /** What a close asked to run once its step back lands. */
  const afterBackRef = useRef<(() => void) | null>(null);
  const registryRef = useRef(registry);
  registryRef.current = registry;
  const completeRef = useRef(state.isComplete);
  completeRef.current = state.isComplete;
  const currentRef = useRef(current);
  currentRef.current = current;
  /** The page's address when the open dialog added its history entry: the address the page shows once it closes. */
  const baseHrefRef = useRef<string | null>(null);
  /** The attempt and the open stations of the trace on show, as the dialog reports them. */
  const [shown, setShown] = useState<TraceShown | null>(null);

  // The toolbox's filter and search, read from the address the page opened on.
  const [filter, setFilter] = useState<ToolboxFilter>(() => (typeof window === 'undefined' ? ALL_ROWS : filterOf(window.location.href)));
  const filterRef = useRef(filter);

  /**
   * The filter, the search, the grouping and the chosen actors in the
   * address of the entry on show: the open toolbox's own, which names the
   * toolbox too, else the page's, whose `toolbox` stays as a link wrote it
   * until the run is complete and read.
   */
  const writeFilter = useCallback(() => {
    const href = window.location.href;
    const next = withToolbox(href, {
      ...(toolboxOpenRef.current && entryRef.current ? { open: true } : {}),
      ...filterRef.current,
    });
    if (next === href) return;
    try {
      window.history.replaceState(window.history.state, '', next);
    } catch {
      // A browser that limits how often a page may rewrite its address refused
      // this one. The rows are filtered all the same, and the next change writes the address.
    }
  }, []);

  const changeFilter = useCallback((next: Partial<ToolboxFilter>) => {
    const was = filterRef.current;
    const now: ToolboxFilter = { ...was, ...next };
    if (sameFilter(now, was)) return;
    filterRef.current = now;
    setFilter(now);
    writeFilter();
  }, [writeFilter]);

  /** Adds the open dialog's entry to the page's history, over the address the page shows. */
  const addEntry = useCallback(() => {
    if (entryRef.current) return;
    baseHrefRef.current = window.location.href;
    window.history.pushState({ forgeView: true }, '');
    entryRef.current = true;
  }, []);

  const openTrace = useCallback((target: TraceTarget, opener?: HTMLElement | null, from?: TraceOpenFrom) => {
    // A forge with no name is not in the run's list of tools, so it has no trace to open.
    if (!registryRef.current.getEntryFor(target.actorIndex, target.toolName)) return;
    if (from) sendForgeEvent({ name: 'forge_trace_open', from });
    // Over the toolbox, the key that asked is one of its rows.
    if (toolboxOpenRef.current) rowRef.current = opener ?? null;
    else openerRef.current = opener ?? null;
    addEntry();
    setShown(null);
    setCurrent((was) => ({ trace: target, toolbox: was.toolbox }));
  }, [addEntry]);

  const openToolbox = useCallback((opener?: HTMLElement | null, from?: ToolboxOpenFrom) => {
    if (toolboxOpenRef.current) return;
    if (from) sendForgeEvent({ name: 'forge_toolbox_open', from });
    openerRef.current = opener ?? null;
    toolboxOpenRef.current = true;
    addEntry();
    writeFilter();
    setCurrent((was) => ({ trace: was.trace, toolbox: true }));
  }, [addEntry, writeFilter]);

  const close = useCallback((focusTo?: HTMLElement | null, then?: () => void) => {
    // Focus goes to the element the dialog pointed to, in place of the key that opened it.
    if (focusTo instanceof HTMLElement) {
      openerRef.current = focusTo;
      landingRef.current = focusTo;
    }
    rowRef.current = null;
    toolboxOpenRef.current = false;
    setCurrent(NOTHING_OPEN);
    if (entryRef.current) {
      entryRef.current = false;
      // The dialog's entry takes back the address it had before the dialog
      // wrote itself in, so the page shows no dialog while the step back lands.
      const base = baseHrefRef.current;
      baseHrefRef.current = null;
      if (base !== null && base !== window.location.href) window.history.replaceState(window.history.state, '', base);
      ownBacksRef.current += 1;
      afterBackRef.current = then ?? null;
      window.history.back();
    } else {
      then?.();
    }
  }, []);

  /**
   * Closes the trace by its own keys. Over the toolbox the trace closes
   * alone: the toolbox keeps the history entry, and its address drops the
   * tool. With no toolbox under it, everything closes.
   */
  const closeTrace = useCallback(() => {
    if (!toolboxOpenRef.current) {
      close();
      return;
    }
    setShown(null);
    setCurrent({ trace: null, toolbox: true });
    const href = window.location.href;
    const next = withoutForgeParams(href, TRACE_PARAMS);
    if (next !== href) window.history.replaceState(window.history.state, '', next);
  }, [close]);

  // A key that closes the toolbox returns focus to the key that opened it.
  const closeByKey = useCallback(() => close(), [close]);

  // Back closes the dialog on top. A step back this provider took itself,
  // after a close by a key, is counted off and closes nothing that opened since.
  useEffect(() => {
    const onPop = () => {
      if (ownBacksRef.current > 0) {
        ownBacksRef.current -= 1;
        // The page's own entry keeps the filter and the search the toolbox was closed on.
        writeFilter();
        // A navigation the close asked for, made on the address the page had before the dialog.
        const then = afterBackRef.current;
        afterBackRef.current = null;
        then?.();
        // The step back can put the page back where it stood when the dialog
        // opened; the element focus went to is brought back into view.
        const landing = landingRef.current;
        landingRef.current = null;
        if (landing?.isConnected) {
          requestAnimationFrame(() => {
            landing.scrollIntoView({ block: 'nearest' });
            if (document.activeElement !== landing) landing.focus({ preventScroll: true });
          });
        }
        return;
      }
      if (!entryRef.current) {
        // Forward onto an entry a dialog added: the dialog its address names
        // opens again on that entry, and Close and Back leave it as before.
        if ((window.history.state as { forgeView?: unknown } | null)?.forgeView !== true) return;
        const { state: linked } = parseForgeUrl(window.location.href, registryRef.current, completeRef.current);
        if (!linked.trace && !linked.toolbox.open) return;
        entryRef.current = true;
        baseHrefRef.current = withToolbox(withoutForgeParams(window.location.href, TRACE_PARAMS), { open: false, ...filterRef.current });
        toolboxOpenRef.current = linked.toolbox.open;
        setShown(null);
        setCurrent({ trace: linked.trace ?? null, toolbox: linked.toolbox.open });
        return;
      }
      if (currentRef.current.trace && toolboxOpenRef.current) {
        // Back over a row's trace closes the trace alone. The step back took
        // the entry the two shared, so the toolbox takes a new one.
        setShown(null);
        setCurrent({ trace: null, toolbox: true });
        entryRef.current = false;
        addEntry();
        writeFilter();
        return;
      }
      entryRef.current = false;
      baseHrefRef.current = null;
      rowRef.current = null;
      toolboxOpenRef.current = false;
      setCurrent(NOTHING_OPEN);
      writeFilter();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [addEntry, writeFilter]);

  const target = current.trace;
  const entry = target ? registry.getEntryFor(target.actorIndex, target.toolName) : undefined;
  const actorEvents = entry ? state.actors[state.actorIds[entry.actorIndex]]?.events ?? NO_EVENTS : NO_EVENTS;

  // Show in Event Log: every dialog closes, then the Event Log opens on this actor's tool by its whole name.
  const showInEventLog = useCallback(() => {
    if (!entry) return;
    const { name, actorName } = entry;
    close(null, () => showToolLog?.(name, actorName));
  }, [entry, close, showToolLog]);

  // An actor's Show in Event Log, from its fold head when its tools cannot be
  // read: every dialog closes, then the Event Log opens on that actor's events.
  const showActorLog = useCallback((actorIndex: number) => {
    const actorName = state.actorIds[actorIndex];
    if (!actorName) return;
    close(null, () => showToolLog?.('', actorName));
  }, [state.actorIds, close, showToolLog]);

  // The run on the page changed and no longer holds the open tool.
  useEffect(() => {
    if (target && !entry) closeTrace();
  }, [target, entry, closeTrace]);

  // The open trace in its entry's address: the tool's number, read at each
  // render from the tool held by actor and name, an earlier attempt, and the
  // open stations. The toolbox's parameters stay as they are.
  useEffect(() => {
    if (!target || !entry || !entryRef.current) return;
    const href = window.location.href;
    const trace = {
      actorIndex: entry.actorIndex,
      toolName: entry.name,
      ...(shown && shown.attempt > 0 ? { attempt: shown.attempt } : {}),
      ...(shown ? { open: shown.open } : {}),
    };
    const next = withForgeState(href, { trace, toolbox: parseForgeUrl(href, registry, false).state.toolbox }, registry);
    if (next !== href) window.history.replaceState(window.history.state, '', next);
  }, [target, entry, shown, registry]);

  // Once the run is complete, the address is read once for it: a link opens
  // the toolbox, one tool's trace, or both, and parameters that point at
  // nothing leave.
  const complete = state.isComplete;
  const readForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!complete) return;
    const run = `${runKey ?? ''}|${sessionId ?? ''}`;
    if (readForRef.current === run) return;
    readForRef.current = run;
    const href = window.location.href;
    const { state: linked, dangling } = parseForgeUrl(href, registry, true);
    if (dangling.length > 0) window.history.replaceState(window.history.state, '', withoutForgeParams(href, dangling));
    // The filter, the search, the grouping and the chosen actors as this run's
    // address names them; a value the toolbox does not know leaves, and so
    // does an actor the run lacks.
    const read = filterOf(window.location.href);
    const named: ToolboxFilter = { ...read, actors: read.actors.filter((index) => index < registry.actors.length) };
    if (!sameFilter(named, filterRef.current)) {
      filterRef.current = named;
      setFilter(named);
    }
    // A dialog already open (from a key pressed while the run played in) stays as it is.
    if (currentRef.current.trace || currentRef.current.toolbox) return;
    // The page's own entry keeps the run without the dialog, and the dialog
    // adds its entry over it, so Close and Back leave the run on the page.
    const page = withToolbox(withoutForgeParams(window.location.href, TRACE_PARAMS), { open: false, ...named });
    if (page !== window.location.href) window.history.replaceState(window.history.state, '', page);
    // A toolbox's open event names the surface a visitor pressed, so a link's toolbox sends none; a link's trace is a trace open from a link.
    if (linked.toolbox.open) openToolbox(null);
    if (linked.trace) openTrace(linked.trace, null, 'link');
  }, [complete, runKey, sessionId, registry, openTrace, openToolbox]);

  // A row's trace closed over the toolbox: focus returns to the row, or to
  // the toolbox's title when the row is no longer in the list.
  const traceOpen = target !== null;
  const traceWasOpenRef = useRef(false);
  useEffect(() => {
    if (traceOpen) {
      traceWasOpenRef.current = true;
      return;
    }
    if (!traceWasOpenRef.current) return;
    traceWasOpenRef.current = false;
    if (!current.toolbox) return;
    const row = rowRef.current;
    rowRef.current = null;
    if (row?.isConnected) row.focus();
    else document.querySelector<HTMLElement>('[data-toolbox-title]')?.focus();
  }, [traceOpen, current.toolbox]);

  // Once every dialog is gone, focus returns to the key that opened the first.
  const isOpen = target !== null || current.toolbox;
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [isOpen]);

  const value = useMemo<ForgeView>(
    () => ({ openTrace, openToolbox, close, showActorLog, current }),
    [openTrace, openToolbox, close, showActorLog, current],
  );
  const toolboxView = useMemo<ToolboxView>(() => ({ ...filter, set: changeFilter }), [filter, changeFilter]);

  return (
    <ForgeViewContext.Provider value={value}>
      <ToolboxViewContext.Provider value={toolboxView}>
        {children}
        {current.toolbox && <ToolboxDialog covered={target !== null} onClose={closeByKey} />}
        {target && entry && (
          <TraceDialog
            key={`${entry.actorIndex}:${entry.name}`}
            entry={entry}
            attempt={target.attempt}
            open={target.open}
            actorCount={state.actorIds.length}
            runKey={runKey}
            sessionId={complete ? sessionId : null}
            events={actorEvents}
            onShown={setShown}
            onClose={closeTrace}
            onGoToEvent={close}
            onShowInEventLog={showInEventLog}
          />
        )}
      </ToolboxViewContext.Provider>
    </ForgeViewContext.Provider>
  );
}
