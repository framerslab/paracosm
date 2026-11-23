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
import { hasSessionProviderKey, sessionProviderKeys, type SavedProviderKeys } from '../../settings/sessionProviderKeys.js';
import type { ServerFacts } from './useServerFacts.js';
import { NBSP, countOf, minutesFigure } from './words.js';

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

/** The people a scenario that names none starts with (normalizeSimulationConfig in src/cli/sim-config.ts). */
const DEFAULT_PEOPLE = 100;

/**
 * The people the colony starts with, as the server works them out when the
 * run is posted (normalizeSimulationConfig, then applyDemoCaps on the host's
 * keys): the scenario's figure, raised to its count of departments, since
 * each department needs a person to head it; on the host's keys, the smaller
 * of that and the host's cap.
 */
export function effectivePeople(facts: ServerFacts, scenario: LaunchScenario, who: Payer): number {
  const own = Math.max(scenario.setup.defaultPopulation ?? DEFAULT_PEOPLE, scenario.departments.length);
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

/* The launch: one set of figures for the words on the screen and for the body Start posts. */

/** The body POST /setup takes. */
export type SetupBody = Record<string, unknown>;

/** How a launch request failed: the server's status and parsed answer, or no answer at all. Never a message string. */
export interface LaunchFailureInput {
  status?: number;
  body?: Record<string, unknown>;
  networkError?: boolean;
}

/** What the first screen gives the launch, so the screen stays in view and says each stage and failure itself. */
export interface LoadedRunOptions {
  /** The body to post to /setup; the launch adds the leaders it wrote. */
  body?: SetupBody;
  /** Called before the leaders are written, with how many, and before the run is posted. */
  onStage?: (stage: 'writing' | 'starting', count?: number) => void;
  /** Called when a request fails. */
  onFailure?: (failure: LaunchFailureInput) => void;
}

/** The scenario's parts a launch is worked out from. */
export type LaunchScenarioWithLeaders = LaunchScenario & Pick<ScenarioClientPayload, 'presets'>;

/** The run Start launches. */
export interface EffectiveLaunch {
  payer: Payer;
  /** How many leaders the run takes. */
  size: number;
  turns: number;
  people: number;
  departments?: number;
  events: number;
  /** The provider the visitor last launched with, on their own key or a self-hosted server. */
  provider?: string;
  /** The models the visitor last launched with, by the role each plays. */
  models?: Record<string, string>;
  /** How many leaders run at a time, where the visitor's last launch set it. */
  batch?: number;
  /** What POST /setup is sent. */
  body: SetupBody;
}

/** The seed a scenario that names none runs on. */
const DEFAULT_SEED = 42;
/** The measured seconds a turn of a pair's run on the host's keys takes. */
const SECONDS_A_TURN = 34;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The leaders a scenario writes: its first preset's, as the launch reads them. */
export function writtenLeaders(scenario: Pick<ScenarioClientPayload, 'presets'>): NonNullable<ScenarioClientPayload['presets'][number]['leaders']> {
  return scenario.presets[0]?.leaders ?? scenario.presets[0]?.actors ?? [];
}

/** The saved models that are named, by role; undefined when none is. */
function namedModels(models: unknown): Record<string, string> | undefined {
  if (!isRecord(models)) return undefined;
  const named: Record<string, string> = {};
  for (const [role, id] of Object.entries(models)) {
    if (typeof id === 'string' && id.trim()) named[role] = id;
  }
  return Object.keys(named).length > 0 ? named : undefined;
}

/**
 * The run Start launches, worked out once. Its body is what the launch has
 * always posted, with the run's own turns: the visitor's provider keys and
 * search keys, the provider, models and economics of their last launch, the
 * scenario's written leaders when they fill the run, the scenario's seed,
 * snapshots on, and the scenario's id.
 */
export function effectiveLaunch(
  facts: ServerFacts,
  scenario: LaunchScenarioWithLeaders,
  settings: LaunchSettings,
  size: number,
  who: Payer,
): EffectiveLaunch {
  const turns = effectiveTurns(facts, scenario, settings, who);
  const last = settings.lastLaunch;
  const { overrides } = settings;

  const body: SetupBody = { ...sessionProviderKeys(overrides) };
  if (overrides.serper) body.serperKey = overrides.serper;
  if (overrides.firecrawl) body.firecrawlKey = overrides.firecrawl;
  if (overrides.tavily) body.tavilyKey = overrides.tavily;
  if (overrides.cohere) body.cohereKey = overrides.cohere;
  const lastProvider: unknown = last?.provider;
  const lastModels: unknown = last?.models;
  const lastEconomics: unknown = last?.economics;
  if (lastProvider) body.provider = lastProvider;
  if (isRecord(lastModels)) body.models = lastModels;
  if (isRecord(lastEconomics)) body.economics = lastEconomics;
  const written = writtenLeaders(scenario);
  if (written.length >= size) {
    body.actors = written.slice(0, size).map((leader) => ({
      name: leader.name,
      archetype: leader.archetype,
      hexaco: leader.hexaco,
      instructions: leader.instructions,
    }));
  }
  body.turns = turns;
  body.seed = scenario.setup.defaultSeed ?? DEFAULT_SEED;
  body.captureSnapshots = true;
  body.quickstart = { scenarioId: scenario.id };

  // The words name a provider and models only for a run the visitor's last launch shapes.
  const shaped = who !== 'host';
  const provider = shaped && typeof lastProvider === 'string' && lastProvider.trim() ? lastProvider : undefined;
  const models = shaped ? namedModels(lastModels) : undefined;
  const lastBatch: unknown = isRecord(lastEconomics) ? lastEconomics.batch : undefined;
  const batchSet: unknown = isRecord(lastBatch) ? lastBatch.maxConcurrency : undefined;

  return {
    payer: who,
    size,
    turns,
    people: effectivePeople(facts, scenario, who),
    departments: effectiveDepartments(facts, scenario, who),
    events: eventsPerTurn(scenario),
    ...(provider ? { provider } : {}),
    ...(models ? { models } : {}),
    ...(isCount(batchSet) ? { batch: batchSet } : {}),
    body,
  };
}

/** About how long a run of this many turns takes on the host's keys, in minutes, to the nearest half. */
export function minutesForTurns(turns: number): number {
  return Math.round((turns * SECONDS_A_TURN) / 60 * 2) / 2;
}

/** Half minutes as a figure: 3.5 gives "3½", 4 gives "4", 0.5 gives "½". */
export const formatMinutes = minutesFigure;

/** A provider's id as its name is written. */
export function providerName(id: string): string {
  const known: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic' };
  return known[id.trim().toLowerCase()] ?? id;
}

/** The saved models as one list of their ids, each once, in the order they were saved. */
export function modelNames(models: Record<string, string>): string {
  return [...new Set(Object.values(models))].join(', ');
}

/**
 * The provider whose key the visitor saved, by name, when the saved keys
 * tell which: the one provider with a key, or with a key for both, the
 * provider of their last launch.
 */
export function keyProviderName(settings: LaunchSettings): string | undefined {
  const keys = sessionProviderKeys(settings.overrides);
  if (keys.apiKey && !keys.anthropicKey) return providerName('openai');
  if (keys.anthropicKey && !keys.apiKey) return providerName('anthropic');
  const last = settings.lastLaunch?.provider;
  if (keys.apiKey && keys.anthropicKey && (last === 'openai' || last === 'anthropic')) return providerName(last);
  return undefined;
}
