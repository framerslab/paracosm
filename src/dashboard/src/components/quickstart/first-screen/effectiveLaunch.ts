/**
 * The run the Run tab's first screen launches, worked out once from what
 * the server answers and what the visitor saved, so the words on the screen
 * and the body Start posts come from the same figures.
 *
 * Who pays for the run decides its figures: a run on the host's keys (the
 * hosted demo with no key saved) is cut to the host's caps, and a run on
 * the visitor's own key or on a self-hosted server takes the scenario's own
 * figures and the turns the visitor last launched with.
 *
 * @module paracosm/dashboard/quickstart/first-screen/effectiveLaunch
 */
import type { ScenarioClientPayload } from '../../../hooks/useScenario.js';
import {
  isLastLaunchFor,
  readKeyOverrides,
  readLastLaunchConfig,
  type KeyOverrides,
} from '../../../hooks/useLastLaunchConfig.js';
import { hasSessionProviderKey, type SavedProviderKeys } from '../../settings/sessionProviderKeys.js';
import type { ServerFacts } from './useServerFacts.js';
import { NBSP, countOf } from './words.js';

/** Who pays for the run: the host's keys, the visitor's own key, or the server it runs on. */
export type Payer = 'host' | 'own' | 'server';

/** What the visitor saved in this browser: their provider keys and their last launch. */
export interface LaunchSettings {
  overrides: KeyOverrides;
  lastLaunch: Record<string, unknown> | null;
}

/** The parts of the scenario the run's figures come from. */
export type LaunchScenario = Pick<ScenarioClientPayload, 'id' | 'setup' | 'departments'>;

/** The most turns a run takes on the visitor's key or a self-hosted server (MAX_SIMULATION_TURNS). */
const MAX_TURNS = 100;
/** The events a turn may hold when a scenario names no cap (the engine's own default). */
const DEFAULT_EVENTS = 2;
/** The most events a turn ever holds (the director's own limit). */
const MAX_EVENTS = 3;

/** A whole number above 0. */
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** The browser's storage, or null where reading it throws (a private window that blocks it). */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The visitor's saved keys and last launch. Storage that throws, or holds
 * JSON that does not parse, reads as nothing saved.
 */
export function readLaunchSettings(storage: Storage | null): LaunchSettings {
  if (!storage) return { overrides: {}, lastLaunch: null };
  try {
    return { overrides: readKeyOverrides(storage), lastLaunch: readLastLaunchConfig(storage) };
  } catch {
    return { overrides: {}, lastLaunch: null };
  }
}

/**
 * Who pays: the visitor when they saved a provider key the server reads as
 * one (the launch posts it), else the host on the hosted demo, else the
 * server the dashboard runs on.
 */
export function payer(facts: ServerFacts, overrides: SavedProviderKeys): Payer {
  if (hasSessionProviderKey(overrides)) return 'own';
  if (facts.adminConfig.hostedDemo === true) return 'host';
  return 'server';
}

/**
 * The run's turns. On the host's keys, the smaller of the scenario's turns
 * and the host's cap. Otherwise the turns of the visitor's last launch on
 * this scenario when it holds a whole number from 1 to 100, else the
 * scenario's own.
 */
export function effectiveTurns(facts: ServerFacts, scenario: LaunchScenario, settings: LaunchSettings, who: Payer): number {
  const own = scenario.setup.defaultTurns;
  if (who === 'host') {
    const cap = facts.adminConfig.demoCaps?.maxTurns;
    return isCount(cap) ? Math.min(own, cap) : own;
  }
  const last = settings.lastLaunch;
  if (last && isLastLaunchFor(last, scenario.id)) {
    const turns = last.turns;
    if (isCount(turns) && turns <= MAX_TURNS) return turns;
  }
  return own;
}

/** The people the colony starts with: on the host's keys, the smaller of the scenario's figure and the host's cap. */
export function effectivePeople(facts: ServerFacts, scenario: LaunchScenario, who: Payer): number {
  const own = scenario.setup.defaultPopulation;
  if (who !== 'host') return own;
  const cap = facts.adminConfig.demoCaps?.maxPopulation;
  return isCount(cap) ? Math.min(own, cap) : own;
}

/**
 * The departments the run uses: on the host's keys, the smaller of the
 * scenario's count and the host's cap. Undefined for a scenario with none,
 * whose figures line leaves the figure out.
 */
export function effectiveDepartments(facts: ServerFacts, scenario: LaunchScenario, who: Payer): number | undefined {
  const own = scenario.departments.length;
  const cap = facts.adminConfig.demoCaps?.maxActiveDepartments;
  const value = who === 'host' && isCount(cap) ? Math.min(own, cap) : own;
  return value > 0 ? value : undefined;
}

/** The events a turn may hold: the scenario's cap, 2 when it names none, never more than 3. */
export function eventsPerTurn(scenario: LaunchScenario): number {
  const cap = scenario.setup.maxEventsPerTurn;
  return isCount(cap) ? Math.min(cap, MAX_EVENTS) : DEFAULT_EVENTS;
}

/** The run's figures, as the figures line names them. */
export interface RunFigures {
  people: number;
  departments?: number;
  turns: number;
  events: number;
}

/** Each figure with its unit, in the line's order: people, departments, turns, events a turn. */
export function figureParts(f: RunFigures): string[] {
  return [
    countOf(f.people, 'person', 'people'),
    ...(f.departments === undefined ? [] : [countOf(f.departments, 'department', 'departments')]),
    countOf(f.turns, 'turn', 'turns'),
    `up to ${f.events}${NBSP}${f.events === 1 ? 'event' : 'events'} a turn`,
  ];
}

/** The figures line: "30 people · 3 departments · 6 turns · up to 2 events a turn". */
export function figuresLine(f: RunFigures): string {
  return figureParts(f).join(' · ');
}

/** The figures as a screen reader reads them, as one sentence: "30 people, 3 departments, 6 turns, up to 2 events a turn". */
export function figuresSpoken(f: RunFigures): string {
  return figureParts(f).join(', ');
}
