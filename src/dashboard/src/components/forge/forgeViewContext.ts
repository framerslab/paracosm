/**
 * The forge view's two contexts, apart from the provider that fills them, so
 * the dialogs the provider renders can read them without importing it.
 */
import { createContext, useContext } from 'react';
import type { RecordOutcome } from '../../hooks/useToolRegistry';
import type { StationId } from './forgeLine';
import type { ToolboxOpenFrom, TraceOpenFrom } from '../../analytics/forgeEvents';

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
  /**
   * Opens one tool's trace. `opener` is the key that asked: focus returns to
   * it when the trace closes. `from` names where the visitor opened it, for
   * the forge view's events; none sends no event.
   */
  openTrace(target: TraceTarget, opener?: HTMLElement | null, from?: TraceOpenFrom): void;
  /**
   * Opens the forged toolbox. `opener` is the key that asked: focus returns
   * to it when the toolbox closes. `from` names where the visitor opened it,
   * for the forge view's events; none (a link) sends no event.
   */
  openToolbox(opener?: HTMLElement | null, from?: ToolboxOpenFrom): void;
  /**
   * Closes every open dialog. Focus returns to the key that opened the
   * first, or goes to `focusTo` when given: an element of the run view the
   * dialog pointed to. `then` runs once the page's history is back where it
   * stood before the dialog opened, so a navigation it makes is not undone
   * by that step back.
   */
  close(focusTo?: HTMLElement | null, then?: () => void): void;
  /** Closes every open dialog and opens the Event Log on one actor's events, by the actor's launch index. */
  showActorLog(actorIndex: number): void;
  current: { trace: TraceTarget | null; toolbox: boolean };
}

const NOTHING_OPEN: ForgeView['current'] = { trace: null, toolbox: false };

/** Outside the provider nothing opens: a card drawn on its own still renders. */
const OUTSIDE_PROVIDER: ForgeView = {
  openTrace: () => {},
  openToolbox: () => {},
  close: () => {},
  showActorLog: () => {},
  current: NOTHING_OPEN,
};

export const ForgeViewContext = createContext<ForgeView>(OUTSIDE_PROVIDER);

export function useForgeView(): ForgeView {
  return useContext(ForgeViewContext);
}

/** The rows the toolbox shows: every row, or the rows of one outcome. */
export type ToolboxShow = 'all' | RecordOutcome;

export const TOOLBOX_SHOWS: readonly ToolboxShow[] = ['all', 'passed', 'did_not_pass'];

/** How the toolbox folds its rows: by actor, by department, or not at all. */
export type ToolboxGroup = 'actor' | 'department' | 'none';

export const TOOLBOX_GROUPS: readonly ToolboxGroup[] = ['actor', 'department', 'none'];

/** The grouping a run opens on: None on a run of two actors, Actor on a run of more. */
export const defaultGroup = (actors: number): ToolboxGroup => (actors > 2 ? 'actor' : 'none');

/** The toolbox's filter, search, grouping and chosen actors. */
export interface ToolboxFilter {
  show: ToolboxShow;
  /** The text in Find a tool, as typed. */
  find: string;
  /** The grouping a visitor chose, or null for the run's own default. */
  group: ToolboxGroup | null;
  /** The actors the actor picker chose, by launch index in launch order; none for every actor. */
  actors: readonly number[];
}

/**
 * The toolbox's filter, search, grouping and chosen actors, one for the
 * toolbox dialog and the list in Reports' page, kept in the page's address
 * so a link opens the same rows.
 */
export interface ToolboxView extends ToolboxFilter {
  set(next: Partial<ToolboxFilter>): void;
}

export const ALL_ROWS: ToolboxFilter = { show: 'all', find: '', group: null, actors: [] };

/** Outside the provider the list shows every row and a change does nothing. */
const UNFILTERED: ToolboxView = { ...ALL_ROWS, set: () => {} };

export const ToolboxViewContext = createContext<ToolboxView>(UNFILTERED);

export function useToolboxView(): ToolboxView {
  return useContext(ToolboxViewContext);
}
