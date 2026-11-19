import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameState, ProcessedEvent } from '../../hooks/useGameState';
import { useToolContext } from '../../hooks/useToolRegistry';
import type { StationId } from './forgeLine';
import { TraceDialog } from './TraceDialog';

/**
 * One actor's tool, named by the actor's launch index and the tool's name.
 *
 * A tool is never held by its number: the list's numbers are positions in
 * actor order, so while a run plays in, an earlier actor's first forge moves
 * every later actor's numbers up by one, and a number held from before would
 * then name another tool.
 */
export interface TraceTarget {
  actorIndex: number;
  toolName: string;
  /** The attempt to show, 1-based. The latest when not given. */
  attempt?: number;
  /** The stations to open beside the one that decided the outcome. */
  open?: StationId[];
}

/** The forge view's dialogs, opened from any surface of the dashboard. */
export interface ForgeView {
  /** Opens one tool's trace. `opener` is the key that asked: focus returns to it when the trace closes. */
  openTrace(target: TraceTarget, opener?: HTMLElement | null): void;
  /** Opens the forged toolbox. */
  openToolbox(opener?: HTMLElement | null): void;
  /**
   * Closes the open dialog. Focus returns to the key that opened it, or goes
   * to `focusTo` when given: an element of the run view the dialog pointed to.
   * `then` runs once the page's history is back where it stood before the
   * dialog opened, so a navigation it makes is not undone by that step back.
   */
  close(focusTo?: HTMLElement | null, then?: () => void): void;
  current: { trace: TraceTarget | null; toolbox: boolean };
}

const NOTHING_OPEN: ForgeView['current'] = { trace: null, toolbox: false };

const NO_EVENTS: readonly ProcessedEvent[] = [];

/** Outside the provider nothing opens: a card drawn on its own still renders. */
const OUTSIDE_PROVIDER: ForgeView = {
  openTrace: () => {},
  openToolbox: () => {},
  close: () => {},
  current: NOTHING_OPEN,
};

const ForgeViewContext = createContext<ForgeView>(OUTSIDE_PROVIDER);

export function useForgeView(): ForgeView {
  return useContext(ForgeViewContext);
}

export interface ForgeViewProviderProps {
  /** The run on the page: its actors and their events. */
  state: GameState;
  /** The run's key, which tells one run on this page from the next. Null with no run. */
  runKey: string | null;
  /** The saved session the page replays or the run last saved as. Null for a run with none. */
  sessionId: string | null;
  /** Opens the Settings tab's Event Log on one actor's tool: App's own navigation. */
  showToolLog?: (toolName: string, actorName: string) => void;
  children: ReactNode;
}

/**
 * The one host of the forge view's dialogs. Mounted once, inside the tool
 * registry's provider, it opens a tool's trace from any surface and renders
 * the one dialog.
 *
 * Opening adds one entry to the page's history, so a phone's Back closes the
 * dialog and leaves the run on the page. Closing by a key steps back over
 * that entry, so Back afterwards does what it did before the dialog opened.
 */
export function ForgeViewProvider({ state, runKey, showToolLog, children }: ForgeViewProviderProps) {
  const registry = useToolContext();
  const [current, setCurrent] = useState<ForgeView['current']>(NOTHING_OPEN);
  const openerRef = useRef<HTMLElement | null>(null);
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

  const openTrace = useCallback((target: TraceTarget, opener?: HTMLElement | null) => {
    // A forge with no name is not in the run's list of tools, so it has no trace to open.
    if (!registryRef.current.getEntryFor(target.actorIndex, target.toolName)) return;
    openerRef.current = opener ?? null;
    if (!entryRef.current) {
      window.history.pushState({ forgeView: true }, '');
      entryRef.current = true;
    }
    setCurrent({ trace: target, toolbox: false });
  }, []);

  // The Sim footer opens the forged toolbox in a dialog of its own.
  const openToolbox = useCallback(() => {}, []);

  const close = useCallback((focusTo?: HTMLElement | null, then?: () => void) => {
    // Focus goes to the element the dialog pointed to, in place of the key that opened it.
    if (focusTo instanceof HTMLElement) {
      openerRef.current = focusTo;
      landingRef.current = focusTo;
    }
    setCurrent(NOTHING_OPEN);
    if (entryRef.current) {
      entryRef.current = false;
      ownBacksRef.current += 1;
      afterBackRef.current = then ?? null;
      window.history.back();
    } else {
      then?.();
    }
  }, []);

  // A key that closes the dialog returns focus to the key that opened it.
  const closeByKey = useCallback(() => close(), [close]);

  // Back closes the open dialog. A step back this provider took itself, after
  // a close by a key, is counted off and closes nothing that opened since.
  useEffect(() => {
    const onPop = () => {
      if (ownBacksRef.current > 0) {
        ownBacksRef.current -= 1;
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
      entryRef.current = false;
      setCurrent(NOTHING_OPEN);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const target = current.trace;
  const entry = target ? registry.getEntryFor(target.actorIndex, target.toolName) : undefined;
  const actorEvents = entry ? state.actors[state.actorIds[entry.actorIndex]]?.events ?? NO_EVENTS : NO_EVENTS;

  // Show in Event Log: the trace closes, then the Event Log opens on this actor's tool by its whole name.
  const showInEventLog = useCallback(() => {
    if (!entry) return;
    const { name, actorName } = entry;
    close(null, () => showToolLog?.(name, actorName));
  }, [entry, close, showToolLog]);

  // The run on the page changed and no longer holds the open tool.
  useEffect(() => {
    if (target && !entry) close();
  }, [target, entry, close]);

  // Once the dialog is gone, focus returns to the key that opened it.
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
    () => ({ openTrace, openToolbox, close, current }),
    [openTrace, openToolbox, close, current],
  );

  return (
    <ForgeViewContext.Provider value={value}>
      {children}
      {target && entry && (
        <TraceDialog
          key={`${entry.actorIndex}:${entry.name}`}
          entry={entry}
          attempt={target.attempt}
          open={target.open}
          actorCount={state.actorIds.length}
          runKey={runKey}
          events={actorEvents}
          onClose={closeByKey}
          onGoToEvent={close}
          onShowInEventLog={showInEventLog}
        />
      )}
    </ForgeViewContext.Provider>
  );
}
