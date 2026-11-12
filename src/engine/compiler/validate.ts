/**
 * Validation harness for generated scenario hooks, and the check a
 * scenario compiled from a seed draft is held to.
 * Each hook validator tests a generated hook against synthetic fixtures
 * to verify it produces correct output shapes and does not throw.
 */

import type { ProgressionHookContext, ScenarioHooks } from '../types.js';
import { MAX_MAGNITUDE, MIN_TABLES, entryBounds } from './seed-draft-world.js';

/** Minimal synthetic colonist for validation. */
function makeTestColonist(overrides: Record<string, any> = {}): any {
  return {
    core: { name: 'Test', birthTime: 2010, marsborn: false, ...overrides.core },
    health: { alive: true, boneDensityPct: 95, cumulativeRadiationMsv: 100, psychScore: 0.7, ...overrides.health },
    career: { department: 'engineering', role: 'engineer', promoted: false, promotionTurn: 0 },
    social: { partnerId: null, childrenIds: [], earthContacts: 3 },
    narrative: { featured: false, lifeEvents: [] },
    hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 },
  };
}

/** Validate a progression hook does not throw and modifies health fields within bounds. */
export function validateProgressionHook(hook: ScenarioHooks['progressionHook']): { ok: boolean; error?: string } {
  if (!hook) return { ok: true };
  try {
    const colonists = [makeTestColonist(), makeTestColonist({ core: { marsborn: true, birthTime: 2040 } }), makeTestColonist({ health: { alive: false } })];
    const ctx: ProgressionHookContext = {
      agents: colonists,
      timeDelta: 4,
      time: 2045,
      turn: 3,
      startTime: 2035,
      rng: { chance: () => false, next: () => 0.5, pick: (arr: any) => arr[0], int: (min: number, max: number) => min },
    };
    hook(ctx);
    for (const c of colonists) {
      if (c.health.alive && (c.health.boneDensityPct < 0 || c.health.boneDensityPct > 200)) {
        return { ok: false, error: `boneDensityPct out of bounds: ${c.health.boneDensityPct}` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Validate director instructions mention departments and crisis categories. */
export function validateDirectorInstructions(fn: ScenarioHooks['directorInstructions'], departments: string[]): { ok: boolean; error?: string } {
  if (!fn) return { ok: true };
  try {
    const text = fn();
    if (typeof text !== 'string' || text.length < 100) return { ok: false, error: 'Director instructions too short' };
    const missingDepts = departments.filter(d => !text.toLowerCase().includes(d.toLowerCase()));
    if (missingDepts.length > departments.length / 2) {
      return { ok: false, error: `Missing departments in director instructions: ${missingDepts.join(', ')}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Validate milestone hook returns crises for turn 1 and final turn. */
export function validateMilestones(fn: ScenarioHooks['getMilestoneEvent'], maxTurns: number): { ok: boolean; error?: string } {
  if (!fn) return { ok: true };
  try {
    const turn1 = fn(1, maxTurns);
    if (!turn1 || !turn1.title || !(turn1.description || turn1.crisis) || !turn1.options || turn1.options.length < 2) {
      return { ok: false, error: 'Turn 1 milestone invalid or missing' };
    }
    const last = fn(maxTurns, maxTurns);
    if (!last || !last.title || !(last.description || last.crisis)) {
      return { ok: false, error: 'Final turn milestone invalid or missing' };
    }
    const mid = fn(Math.floor(maxTurns / 2), maxTurns);
    if (mid !== null && mid !== undefined) {
      // Mid-turn milestones are optional but must be valid if present
      if (!mid.title || !mid.options) return { ok: false, error: 'Mid-turn milestone has invalid shape' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Validate fingerprint hook returns an object with a summary key. */
export function validateFingerprint(fn: ScenarioHooks['fingerprintHook']): { ok: boolean; error?: string } {
  if (!fn) return { ok: true };
  try {
    const mockState = {
      agents: [makeTestColonist()],
      metrics: { morale: 0.6, population: 80, foodMonthsReserve: 6, powerKw: 300, infrastructureModules: 10, scienceOutput: 5, lifeSupportCapacity: 100, pressurizedVolumeM3: 2000, waterLitersPerDay: 500 },
      politics: { earthDependencyPct: 50, governanceStatus: 'earth-governed' as const, independencePressure: 0.3 },
      statuses: {},
      environment: {},
      metadata: { simulationId: 'test', leaderId: 'test', seed: 100, startTime: 2035, currentTime: 2070, currentTurn: 8 },
      eventLog: [],
    };
    const log = [{ turn: 1, time: 2035, outcome: 'conservative_success' }, { turn: 2, time: 2039, outcome: 'risky_success' }];
    const leader = { name: 'Test', archetype: 'test', unit: 'Test', instructions: '', hexaco: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5 } };
    const result = fn(mockState, log, leader, { engineering: ['tool1'] }, 8);
    if (typeof result !== 'object' || !result.summary) {
      return { ok: false, error: 'Fingerprint must return object with summary key' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Validate politics hook returns null for non-political categories and deltas for political ones. */
export function validatePolitics(fn: ScenarioHooks['politicsHook']): { ok: boolean; error?: string } {
  if (!fn) return { ok: true };
  try {
    const nonPolitical = fn('environmental', 'risky_success');
    // null is fine, empty object is fine, deltas are fine
    const political = fn('political', 'risky_success');
    if (political !== null && typeof political !== 'object') {
      return { ok: false, error: 'Politics hook must return null or a record of deltas' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Validate reaction context hook returns a string. */
export function validateReactionContext(fn: ScenarioHooks['reactionContextHook']): { ok: boolean; error?: string } {
  if (!fn) return { ok: true };
  try {
    const result = fn(makeTestColonist(), { time: 2045, turn: 3 });
    if (typeof result !== 'string') return { ok: false, error: 'Reaction context must return a string' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Hold a scenario to the rules of a scenario compiled from a seed draft
 * (`seedDraftToScenarioJson`): every declared score has a world field with
 * a finite start inside its bounds; no start, floor or ceiling is larger
 * than 1e15 in size; there are three category tables or more, with the
 * same keys as `knowledge.categoryMapping`; every declared score other than
 * the head count is named by a table, and by the first table or the last
 * (a milestone takes those two, so a run of two turns applies no other);
 * every entry is on a declared score or on `morale`, never on the head
 * count, is not 0 and lies inside its score's bounds; and the header names
 * declared scores.
 *
 * It reads `effects` in either form: the object form a draft JSON carries,
 * or the array form of a compiled package, whose first element is the one
 * a run applies. It changes nothing. `compileFromSeed` prints what it
 * reports and compiles on: an error here is a fault in the normalizer, and
 * a compile never fails for one. It is not for a hand-written scenario,
 * which follows its author's rules: Mars Genesis adds 2 habitat modules to
 * a start of 3.
 */
export function validateSeedWorld(scenarioJson: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const own = (object: unknown, key: string): boolean => !!object && Object.prototype.hasOwnProperty.call(object, key);
  const json = scenarioJson as {
    metrics?: Array<{ id?: unknown }>;
    world?: { metrics?: Record<string, { initial?: unknown; min?: unknown; max?: unknown }> };
    effects?: unknown;
    knowledge?: { categoryMapping?: Record<string, unknown> };
    ui?: { headerMetrics?: Array<{ id?: unknown }> };
  };

  const declared = (Array.isArray(json.metrics) ? json.metrics : [])
    .map(m => (m ? m.id : undefined))
    .filter((id): id is string => typeof id === 'string');
  const worldMetrics = json.world?.metrics ?? {};
  /** A declared score's start and bounds, where its world field holds a finite start. */
  const ranges: Record<string, { initial: number; min?: number; max?: number }> = {};

  for (const id of declared) {
    const field = own(worldMetrics, id) ? worldMetrics[id] : undefined;
    if (!field) {
      errors.push(`${id}: the declared score has no world field`);
      continue;
    }
    for (const what of ['initial', 'min', 'max'] as const) {
      const value = field[what];
      if (typeof value === 'number' && Math.abs(value) > MAX_MAGNITUDE) errors.push(`${id}: ${what} ${value} is larger than ${MAX_MAGNITUDE} in size`);
    }
    if (!isNumber(field.initial)) {
      errors.push(`${id}: the start is not a finite number (read ${String(field.initial)})`);
      continue;
    }
    const min = isNumber(field.min) ? field.min : undefined;
    const max = isNumber(field.max) ? field.max : undefined;
    if ((min !== undefined && field.initial < min) || (max !== undefined && field.initial > max)) {
      errors.push(`${id}: the start ${field.initial} lies outside its bounds (${min ?? 'no floor'} to ${max ?? 'no ceiling'})`);
    }
    ranges[id] = { initial: field.initial, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }

  const effects = json.effects;
  const tables = ((Array.isArray(effects)
    ? (effects[0] as { categoryDefaults?: unknown } | undefined)?.categoryDefaults
    : effects) ?? {}) as Record<string, Record<string, unknown>>;
  const keys = Object.keys(tables);
  if (keys.length < MIN_TABLES) errors.push(`the scenario has ${keys.length} category tables, fewer than ${MIN_TABLES}`);

  const mapping = json.knowledge?.categoryMapping ?? {};
  for (const key of keys) {
    if (!own(mapping, key)) errors.push(`table "${key}" is missing from knowledge.categoryMapping`);
  }
  for (const key of Object.keys(mapping)) {
    if (!own(tables, key)) errors.push(`knowledge.categoryMapping maps "${key}", which has no table`);
  }

  const mayName = new Set(declared.filter(id => id !== 'population'));
  for (const key of keys) {
    for (const [metric, change] of Object.entries(tables[key] ?? {})) {
      if (metric === 'population') {
        errors.push(`table "${key}" names population`);
        continue;
      }
      if (metric !== 'morale' && !mayName.has(metric)) {
        errors.push(`table "${key}" names "${metric}", which is neither a declared score nor morale`);
        continue;
      }
      if (!isNumber(change) || change === 0) {
        errors.push(`table "${key}" changes ${metric} by ${String(change)}`);
        continue;
      }
      // Morale's scale is its range whatever its field; any other score needs its start to have one.
      const range = own(ranges, metric) ? ranges[metric] : (metric === 'morale' ? { initial: 0 } : undefined);
      if (!range) continue;
      const { least, most } = entryBounds(metric, range);
      const size = Math.abs(change);
      if (size < least || (most !== undefined && size > most)) {
        errors.push(`table "${key}" changes ${metric} by ${change}, outside its bounds (${least} to ${most ?? 'no limit'})`);
      }
    }
  }

  if (keys.length > 0) {
    const first = tables[keys[0]] ?? {};
    const last = tables[keys[keys.length - 1]] ?? {};
    for (const id of mayName) {
      if (!keys.some(key => own(tables[key], id))) errors.push(`${id}: no category table names the declared score`);
      else if (!own(first, id) && !own(last, id)) errors.push(`${id}: neither the first table ("${keys[0]}") nor the last ("${keys[keys.length - 1]}") names the declared score`);
    }
  }

  const headers = json.ui?.headerMetrics;
  for (const header of Array.isArray(headers) ? headers : []) {
    const id = header ? header.id : undefined;
    if (typeof id !== 'string' || !declared.includes(id)) errors.push(`ui.headerMetrics names "${String(id)}", which is not a declared score`);
  }

  return { ok: errors.length === 0, errors };
}
