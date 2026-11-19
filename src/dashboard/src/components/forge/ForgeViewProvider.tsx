import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameState } from '../../hooks/useGameState';
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
   */
  close(focusTo?: HTMLElement | null): void;
  current: { trace: TraceTarget | null; toolbox: boolean };
}

const NOTHING_OPEN: ForgeView['current'] = { trace: null, toolbox: false };

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
export function ForgeViewProvider({ state, runKey, children }: ForgeViewProviderProps) {
  const registry = useToolContext();
  const [current, setCurrent] = useState<ForgeView['current']>(NOTHING_OPEN);
  const openerRef = useRef<HTMLElement | null>(null);
  /** Whether the history entry added for the open dialog is the page's current one. */
  const entryRef = useRef(false);
  /** Steps back this provider asked for and whose popstate it has yet to see. */
  const ownBacksRef = useRef(0);
  /** The element of the run view a closed dialog sent focus to, kept in view once the step back lands. */
  const landingRef = useRef<HTMLElement | null>(null);
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

  const close = useCallback((focusTo?: HTMLElement | null) => {
    // Focus goes to the element the dialog pointed to, in place of the key that opened it.
    if (focusTo instanceof HTMLElement) {
      openerRef.current = focusTo;
      landingRef.current = focusTo;
    }
    setCurrent(NOTHING_OPEN);
    if (entryRef.current) {
      entryRef.current = false;
      ownBacksRef.current += 1;
      window.history.back();
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
          onClose={closeByKey}
          onGoToEvent={close}
        />
      )}
    </ForgeViewContext.Provider>
  );
}
