/**
 * From a seed draft to the scenario JSON the compiler takes.
 *
 * `compileFromSeed` asks a model for a draft: the scenario's nouns, its
 * departments, its metrics with each one's start and range, and the
 * category tables its events use. `seedDraftToScenarioJson` turns that
 * draft into the JSON `compileScenario` takes: a `world` that holds every
 * declared score, `metrics` with a label and a source, category tables in
 * the object form, the knowledge bundle's categories keyed by the tables,
 * the header's scores, and a `setup` that keeps one death die for each
 * person's whole life.
 *
 * A draft may mark a metric as a supply that sustains its people
 * (`sustains: true`). `sustainsVeto` holds the rules a mark must pass; the
 * normalizer drops a mark the veto refuses, with the rule and the reason,
 * and no metric is marked unless its draft marks it.
 *
 * It repairs and never rejects. A field the model left out takes a
 * default, a value outside its rule is moved inside it, and each default
 * and repair is noted. It calls no model, it never throws on a draft the
 * draft schema accepted, and the same draft gives the same JSON text.
 *
 * Every number below is the simulation's own choice, not a measured rate.
 *
 * @module paracosm/engine/compiler/seed-draft-world
 */
import type { DraftScenario } from './compile-from-seed.js';
import { unitsToYears, yearsPerTimeUnit } from '../core/time-unit.js';

/** One default or repair the normalizer applied to a draft. */
export interface DraftNote {
  /** Where in the draft, e.g. `metrics[1].initial` or `effects[0].entries[2]`. */
  path: string;
  /** The rule that fired, e.g. `default-start` or `entry-above-most`. */
  rule: string;
  /** One line a person can read; `compileFromSeed` prints it. */
  message: string;
}

/** Where a metric starts when its draft gives no start and no ceiling, by format. */
export const DEFAULT_STARTS = { number: 100, percent: 50, currency: 1_000_000 } as const;
/** The kernel's own starting morale, for a declared `morale` with no usable start. */
export const MORALE_START = 0.85;
/**
 * The largest size a start, a floor or a ceiling is held to, and an entry
 * on a count that starts empty, which has no scale to hold it.
 */
export const MAX_MAGNITUDE = 1e15;
/** A default table entry is this share of its score's scale: a twentieth. */
export const DEFAULT_ENTRY_SHARE = 1 / 20;
/** No table entry is more than this share of its score's scale: a twelfth. */
export const MOST_ENTRY_SHARE = 1 / 12;
/** No table entry is less than this share of its score's scale: a hundredth. */
export const LEAST_ENTRY_SHARE = 1 / 100;
/** The smallest entry of any size: the outcome step rounds a change to two decimals. */
export const SMALLEST_ENTRY = 0.01;
/** The default entry of a count that starts empty, which has no scale. */
export const COUNT_FROM_ZERO_ENTRY = 1;
/** A compiled scenario has at least this many category tables. */
export const MIN_TABLES = 3;
/** At most this many of a draft's tables are kept. */
export const MAX_TABLES = 8;
/** At most this many of a draft table's entries are kept. */
export const MAX_DRAFT_ENTRIES = 4;
/**
 * The categories added, with the default table, while a draft has fewer
 * than {@link MIN_TABLES}: the categories of the Event Director's own
 * canned events, so a director call that fails still lands on a table.
 */
export const DEFAULT_CATEGORIES = ['infrastructure', 'resource', 'psychological'] as const;
/** How many declared scores the header shows. */
export const HEADER_METRICS = 4;
/**
 * A supply is marked as sustaining the people only in a scenario whose
 * default run spans at least this many years: in a shorter one too few
 * people die of age or accident for a supply to show in who lives.
 */
export const SUSTAINS_MIN_YEARS = 5;
/** At most this many supplies are marked in one scenario, as many as Mars Genesis marks. */
export const SUSTAINS_MAX_MARKS = 5;

const LABEL_MAX = 48;
const UNIT_MAX = 16;
const CATEGORY_MAX = 32;
const DEPARTMENT_ID_MAX = 48;

type Format = 'number' | 'percent' | 'currency';
type DraftMetric = DraftScenario['metrics'][number];

/** A world field as the normalizer writes one (`WorldMetricSchema`, engine/types.ts). */
export interface SeedWorldField {
  id: string;
  label: string;
  unit: string;
  type: 'number';
  initial: number;
  min?: number;
  max?: number;
  category: 'metric';
  /** Present, and true, only on a supply the draft marks and the veto passes. */
  sustains?: true;
}

/** A number the normalizer computed, held to six decimals. */
const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * The distance a score can move before something stops it.
 *
 * `morale` has its range, 1. Any other score has the smallest of: its start
 * less its floor (when it starts above one), its ceiling less its start
 * (when it starts under one), and the size of its start (when that is not
 * 0). A count that starts empty (a start of 0, no ceiling) has none.
 */
export function scoreScale(id: string, field: { initial: number; min?: number; max?: number }): number | undefined {
  if (id === 'morale') return 1;
  const distances: number[] = [];
  if (isNumber(field.min) && field.initial > field.min) distances.push(field.initial - field.min);
  if (isNumber(field.max) && field.initial < field.max) distances.push(field.max - field.initial);
  if (field.initial !== 0) distances.push(Math.abs(field.initial));
  return distances.length > 0 ? Math.min(...distances) : undefined;
}

/** The sizes a table entry on one score may have, and the size of its default entry. */
export interface EntryBounds {
  /** The smallest size an entry may have. */
  least: number;
  /** The largest size an entry may have; absent for a count that starts empty. */
  most?: number;
  /** The size of the score's default entry. */
  standard: number;
}

/**
 * What a category table's entry on a score is held to: between a hundredth
 * and a twelfth of the score's scale, with a twentieth as its default, and
 * never under 0.01. A count that starts empty has no scale: its entry is
 * 0.01 or more, 1 by default, and the normalizer holds it to 1e15 in
 * size, as it holds a start.
 *
 * One decision moves a score by its event's outcome and by the department
 * effects the leader adopts. The outcome multiplies a cost by at most 4.81
 * (a bold failure with every modifier against it), and the adopted effects
 * add at most the score's largest entry, so at a twelfth the worst decision
 * moves a score 5.81 twelfths of its scale: under half of it.
 */
export function entryBounds(id: string, field: { initial: number; min?: number; max?: number }): EntryBounds {
  const scale = scoreScale(id, field);
  if (scale === undefined) return { least: SMALLEST_ENTRY, standard: COUNT_FROM_ZERO_ENTRY };
  return {
    least: round6(Math.max(scale * LEAST_ENTRY_SHARE, SMALLEST_ENTRY)),
    most: round6(Math.max(scale * MOST_ENTRY_SHARE, SMALLEST_ENTRY)),
    standard: round6(Math.max(scale * DEFAULT_ENTRY_SHARE, SMALLEST_ENTRY)),
  };
}

/** `population` is a head count and `morale` a share, whatever a draft says. */
function formatOf(metric: { id: string; format?: Format }): Format {
  if (metric.id === 'population') return 'number';
  if (metric.id === 'morale') return 'percent';
  return metric.format ?? 'number';
}

/** The first of `base`, `base-2`, `base-3`, ... that `taken` does not hold, cut to `max` characters. */
function firstFree(base: string, taken: Set<string>, max: number, startAt: number): string {
  for (let n = startAt; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const candidate = `${base.slice(0, max - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A category as a table key: lower case, every run of other characters one hyphen, trimmed, cut to 32. */
function categoryKey(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CATEGORY_MAX)
    .replace(/-+$/, '');
}

/** A `sustains` mark the veto refuses. */
export interface SustainsFinding {
  /** The world key that carries the mark. */
  key: string;
  /** The rule that refuses it, 1 to 7. A mark several rules refuse is reported under the first. */
  rule: number;
  /** Why, in one line a person can read. */
  reason: string;
}

/**
 * The rules a supply marked as sustaining the people must pass.
 *
 * A scenario marks a field of `world.metrics` or `world.capacities` with
 * `sustains: true`, and the yearly age and accident rates then divide by
 * the supply level: the geometric mean of the marked supplies, each
 * against its amount on day one. A wrong mark makes two leaders lose
 * different people for a reason that is not one. This reads a scenario
 * JSON, with `effects` in the object form a draft carries or the array
 * form of a compiled package, and returns the marks it refuses, in the
 * order the world declares them. It changes nothing.
 *
 * A mark is refused when:
 *
 * 1. its key is `population` or `morale`: the engine's own two values;
 * 2. it is not a plain quantity: its type is not `number`, the score that
 *    reads it is a percent or a currency, or its unit is `%`, `frac` or
 *    `score`, or names USD, EUR or `$`;
 * 3. the score that reads it is better lower;
 * 4. it does not start above 0, so the kernel keeps no amount on day one;
 * 5. no category table names it, so no outcome moves it;
 * 6. the default run spans under {@link SUSTAINS_MIN_YEARS} years, on the
 *    kernel's own reading of the time unit;
 * 7. {@link SUSTAINS_MAX_MARKS} marks before it already pass rules 1 to 6.
 *
 * The rules catch what a machine can see. A plain stock that passes all
 * seven and yet is not something the people live on stays its author's
 * mistake. The rules and their two numbers are the simulation's own
 * choices, not measured rates.
 */
export function sustainsVeto(scenarioJson: Record<string, unknown>): SustainsFinding[] {
  const json = scenarioJson as {
    labels?: { timeUnitNoun?: string } | null;
    setup?: { defaultTurns?: unknown; defaultTimePerTurn?: unknown; yearsPerTimeUnit?: number } | null;
    world?: { metrics?: unknown; capacities?: unknown } | null;
    metrics?: unknown;
    effects?: unknown;
  };
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

  // The declared score that reads a world key, found as the outcome step
  // finds one: by the last part of its source, or by its id.
  const scores = new Map<string, Record<string, unknown>>();
  for (const metric of Array.isArray(json.metrics) ? json.metrics : []) {
    if (!isObject(metric)) continue;
    const key = (text(metric.source) ?? text(metric.id))?.split('.').pop();
    if (key && !scores.has(key)) scores.set(key, metric);
  }

  // The category tables: the object form's values, or the tables of the
  // array form's first element, the one a run applies.
  const effects = json.effects;
  const bag = Array.isArray(effects) ? (isObject(effects[0]) ? effects[0].categoryDefaults : undefined) : effects;
  const tables = isObject(bag) ? Object.values(bag) : [];
  const named = (key: string): boolean => tables.some(table => isObject(table) && Object.prototype.hasOwnProperty.call(table, key));

  // The years the default run spans: its turns after the first, each a
  // turn's time long. A run whose turns cannot be read spans none.
  const turns = json.setup?.defaultTurns;
  const perTurn = json.setup?.defaultTimePerTurn;
  const years = isNumber(turns)
    ? unitsToYears((turns - 1) * (isNumber(perTurn) ? perTurn : 1), yearsPerTimeUnit(json.labels, json.setup))
    : undefined;

  /** The first of rules 1 to 6 that refuses a marked field, or nothing. */
  const refusal = (key: string, field: Record<string, unknown>): { rule: number; reason: string } | undefined => {
    if (key === 'population') return { rule: 1, reason: 'the head count is the roster, not a supply: it would feed its own death rates' };
    if (key === 'morale') return { rule: 1, reason: 'morale is a mood, not a supply' };
    const score = scores.get(key);
    const format = score?.format;
    const unit = typeof field.unit === 'string' ? field.unit.trim() : '';
    if (field.type !== undefined && field.type !== 'number') {
      return { rule: 2, reason: `it is not a plain quantity: its type is ${JSON.stringify(field.type)}, not a number` };
    }
    if (format === 'percent' || format === 'currency') {
      return { rule: 2, reason: `it is not a plain quantity: its score is a ${format}` };
    }
    if (/^(%|frac|score)$/i.test(unit)) {
      return { rule: 2, reason: `it is not a plain quantity: its unit, "${unit}", is a share's or a score's` };
    }
    // USD and EUR as words of their own, so a unit such as "heures" keeps its mark.
    if (/\$|(^|[^a-z])(usd|eur)([^a-z]|$)/i.test(unit)) {
      return { rule: 2, reason: `it is not a plain quantity: its unit, "${unit}", names money` };
    }
    if (score?.better === 'lower') {
      return { rule: 3, reason: 'its score is better lower, and a supply is something the people are better off with more of' };
    }
    if (!(typeof field.initial === 'number' && field.initial > 0)) {
      const start = field.initial === undefined ? 'nothing' : JSON.stringify(field.initial);
      return { rule: 4, reason: `it does not start above 0 (it starts at ${start}), so there is no amount on day one to hold it against` };
    }
    if (!named(key)) return { rule: 5, reason: 'no category table names it, so no outcome moves it' };
    if (years === undefined) {
      return { rule: 6, reason: `the length of the default run cannot be read, and a supply needs a run of ${SUSTAINS_MIN_YEARS} years or more` };
    }
    if (!(years >= SUSTAINS_MIN_YEARS)) {
      return { rule: 6, reason: `the default run spans ${round6(years)} years, under ${SUSTAINS_MIN_YEARS}: too short for a supply to show in who lives` };
    }
    return undefined;
  };

  const findings: SustainsFinding[] = [];
  let passed = 0;
  for (const fields of [json.world?.metrics, json.world?.capacities]) {
    if (!isObject(fields)) continue;
    for (const [key, field] of Object.entries(fields)) {
      if (!isObject(field) || field.sustains !== true) continue;
      const refused = refusal(key, field)
        ?? (passed >= SUSTAINS_MAX_MARKS ? { rule: 7, reason: `${SUSTAINS_MAX_MARKS} supplies are marked before it, the most one scenario marks` } : undefined);
      if (refused) findings.push({ key, rule: refused.rule, reason: refused.reason });
      else passed++;
    }
  }
  return findings;
}

/**
 * Turn a draft the draft schema accepted into the scenario JSON
 * `compileScenario` takes, with a note for each default and repair.
 */
export function seedDraftToScenarioJson(draft: DraftScenario): { scenario: Record<string, unknown>; notes: DraftNote[] } {
  const notes: DraftNote[] = [];
  const note = (path: string, rule: string, message: string) => { notes.push({ path, rule, message }); };

  // ---- Ids ------------------------------------------------------------------
  // `constructor` is the one name every object inherits that the id pattern
  // allows; a table keyed by it would read the inherited function. The
  // rename runs first, so a renamed id cannot land on one another metric holds.
  const writtenIds = new Set(draft.metrics.map(m => m.id));
  const renamed = new Map<string, string>();
  const seenIds = new Set<string>();
  const metrics: Array<{ metric: DraftMetric; id: string; index: number }> = [];
  draft.metrics.forEach((metric, index) => {
    let id = metric.id;
    if (id === 'constructor') {
      id = renamed.get('constructor') ?? firstFree('constructor-score', writtenIds, 32, 1);
      if (!renamed.has('constructor')) {
        renamed.set('constructor', id);
        note(`metrics[${index}].id`, 'id-renamed', `metric "constructor" is renamed "${id}": the name is one every object inherits`);
      }
    }
    if (seenIds.has(id)) {
      note(`metrics[${index}].id`, 'id-duplicate', `metric "${metric.id}" is declared twice; the second is dropped`);
      return;
    }
    seenIds.add(id);
    metrics.push({ metric, id, index });
  });

  // A run keys its per-department state by id, so a second department under
  // one id is renamed, which keeps the count the draft gave.
  const departmentIds = new Set(draft.departments.map(d => d.id));
  const usedDepartmentIds = new Set<string>();
  const departments = draft.departments.map((department, index) => {
    let id = department.id;
    if (usedDepartmentIds.has(id)) {
      id = firstFree(department.id, new Set([...departmentIds, ...usedDepartmentIds]), DEPARTMENT_ID_MAX, 2);
      note(`departments[${index}].id`, 'id-renamed', `department "${department.id}" is declared twice; the second is renamed "${id}"`);
    }
    usedDepartmentIds.add(id);
    return { ...department, id };
  });

  // ---- A draft written in fractions -------------------------------------------
  // Decided once, before any start is defaulted: two or more percent metrics
  // other than morale, a start on at least one, and every start given above
  // 0 and under 1. A model that wrote fractions is far likelier than a
  // scenario whose every percentage is under 1 percent.
  const percents = metrics.filter(m => m.id !== 'morale' && formatOf({ id: m.id, format: m.metric.format }) === 'percent');
  const percentStarts = percents.map(m => m.metric.initial).filter(isNumber);
  const fractions = percents.length >= 2 && percentStarts.length >= 1 && percentStarts.every(v => v > 0 && v < 1);
  const percentIds = new Set(percents.map(m => m.id));
  if (fractions) {
    note('metrics', 'fractions', 'every percent start given lies between 0 and 1, so the draft is read as fractions: each percent start and each table entry on a percent metric is multiplied by 100');
  }

  // ---- Each metric's fields ---------------------------------------------------
  const fields: Record<string, SeedWorldField> = {};
  const definitions: Array<{ id: string; label: string; source: string; format: Format; better?: 'higher' | 'lower' }> = [];
  const lowerIsBetter = new Set<string>();

  for (const { metric, id, index } of metrics) {
    const path = `metrics[${index}]`;
    const format = formatOf({ id, format: metric.format });

    const givenLabel = typeof metric.label === 'string' ? metric.label.trim() : '';
    let label = givenLabel.slice(0, LABEL_MAX).trim();
    if (givenLabel.length < 2) {
      const words = id.replace(/-+/g, ' ').trim();
      label = (words ? words.charAt(0).toUpperCase() + words.slice(1) : id).slice(0, LABEL_MAX).trim();
      note(`${path}.label`, 'default-label', `${id}: no label given; it reads "${label}"`);
    }

    /** A start, a floor or a ceiling, held to 1e15 in size. */
    const held = (value: unknown, what: 'initial' | 'min' | 'max'): number | undefined => {
      if (!isNumber(value)) return undefined;
      if (Math.abs(value) <= MAX_MAGNITUDE) return value;
      const moved = Math.sign(value) * MAX_MAGNITUDE;
      note(`${path}.${what}`, 'size-over-limit', `${id}: ${what} ${value} is larger than ${MAX_MAGNITUDE} in size and is moved to ${moved}`);
      return moved;
    };
    let initial = held(metric.initial, 'initial');
    let min = held(metric.min, 'min');
    let max = held(metric.max, 'max');
    let unit = (typeof metric.unit === 'string' ? metric.unit.trim() : '').slice(0, UNIT_MAX).trim();

    if (id === 'population') {
      // The roster is the head count whatever a scenario declares, and a
      // declared ceiling would cap hires.
      if (initial !== undefined || min !== undefined || max !== undefined) {
        note(path, 'population-own', 'population: the head count is the roster, so the draft\'s start and range for it are not kept');
      }
      if (unit === '%' || unit === 'frac') unit = '';
      fields[id] = { id, label, unit, type: 'number', initial: draft.setup.defaultPopulation, min: 0, category: 'metric' };
    } else if (id === 'morale') {
      // The kernel holds morale from 0 to 1.
      let start = MORALE_START;
      if (initial === undefined) {
        note(`${path}.initial`, 'default-start', `morale: no start given; it starts at ${MORALE_START}`);
      } else if (initial >= 0 && initial <= 1) {
        start = initial;
      } else if (initial > 1 && initial <= 100) {
        start = round6(initial / 100);
        note(`${path}.initial`, 'morale-in-points', `morale: a start of ${initial} is read as a percentage and held as ${start}`);
      } else {
        note(`${path}.initial`, 'start-outside-bounds', `morale: a start of ${initial} is outside 0 to 100; it starts at ${MORALE_START}`);
      }
      fields[id] = { id, label, unit: '%', type: 'number', initial: start, min: 0, max: 1, category: 'metric' };
    } else if (format === 'percent') {
      // A percent is held in points, 0 to 100: the outcome step rounds a
      // change to two decimals, which on a 0 to 1 fraction is a whole point.
      if ((min !== undefined && min !== 0) || (max !== undefined && max !== 100)) {
        note(path, 'percent-bounds', `${id}: a percent is held from 0 to 100; the draft's range for it is not kept`);
      }
      if (initial !== undefined && fractions) initial = round6(initial * 100);
      if (initial === undefined) {
        initial = DEFAULT_STARTS.percent;
        note(`${path}.initial`, 'default-start', `${id}: no start given; it starts at ${initial}`);
      } else if (initial < 0 || initial > 100) {
        const moved = initial < 0 ? 0 : 100;
        note(`${path}.initial`, 'start-outside-bounds', `${id}: a start of ${initial} is outside 0 to 100 and is moved to ${moved}`);
        initial = moved;
      }
      fields[id] = { id, label, unit: '%', type: 'number', initial, min: 0, max: 100, category: 'metric' };
    } else {
      // A number or a currency. The format is what the verdict and the
      // header read, so a unit that says percent is dropped.
      if (unit === '%' || unit === 'frac') {
        note(`${path}.unit`, 'unit-dropped', `${id}: unit "${unit}" on a ${format} is dropped`);
        unit = '';
      }
      if (unit === '' && format === 'currency') unit = (draft.labels.currency ?? '').trim().slice(0, UNIT_MAX);
      if (min !== undefined && max !== undefined) {
        if (min > max) {
          note(path, 'bounds-swapped', `${id}: floor ${min} is above ceiling ${max}; the two are swapped`);
          [min, max] = [max, min];
        } else if (min === max) {
          note(`${path}.max`, 'ceiling-dropped', `${id}: floor and ceiling are both ${min}; the ceiling is dropped`);
          max = undefined;
        }
      }
      if (initial === undefined) {
        if (max !== undefined) {
          // The midpoint of the floor and the ceiling, the floor being 0
          // when none is given; at a ceiling of 0 or under with no floor,
          // the ceiling itself. Between bounds less than a millionth apart
          // the rounded midpoint can fall outside them, so it is held
          // inside.
          if (min !== undefined) initial = Math.min(max, Math.max(min, round6((min + max) / 2)));
          else initial = max > 0 ? round6(max / 2) : max;
        } else {
          const fallback = DEFAULT_STARTS[format];
          initial = min !== undefined && min > fallback ? min : fallback;
        }
        note(`${path}.initial`, 'default-start', `${id}: no start given; it starts at ${initial}`);
      } else if (min !== undefined && initial < min) {
        note(`${path}.initial`, 'start-outside-bounds', `${id}: a start of ${initial} is under its floor and is moved to ${min}`);
        initial = min;
      } else if (max !== undefined && initial > max) {
        note(`${path}.initial`, 'start-outside-bounds', `${id}: a start of ${initial} is over its ceiling and is moved to ${max}`);
        initial = max;
      }
      // No floor given: 0 for a score that starts at 0 or more. A ceiling of
      // 0 with that floor would pin the score, so it keeps no floor there.
      if (min === undefined && initial >= 0 && (max === undefined || max > 0)) min = 0;
      fields[id] = {
        id, label, unit, type: 'number', initial,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        category: 'metric',
      };
    }

    if (metric.better === 'lower') lowerIsBetter.add(id);
    definitions.push({ id, label, source: `metrics.${id}`, format, ...(metric.better ? { better: metric.better } : {}) });
  }

  // ---- Category tables ----------------------------------------------------------
  /** The declared scores a table may name and must cover: all but the head count. */
  const scored = metrics.map(m => m.id).filter(id => id !== 'population');
  const mayName = new Set([...scored, 'morale']);
  const boundsOf = (id: string): EntryBounds => entryBounds(id, fields[id] ?? { initial: MORALE_START, min: 0, max: 1 });
  /** A twentieth of the score's scale, in its better direction. */
  const defaultEntry = (id: string): number => (lowerIsBetter.has(id) ? -boundsOf(id).standard : boundsOf(id).standard);
  /** Every declared score but the head count, each at its default entry; morale alone when there is none. */
  const defaultTable = (): Record<string, number> => {
    const table: Record<string, number> = {};
    for (const id of scored) table[id] = defaultEntry(id);
    if (scored.length === 0) table.morale = boundsOf('morale').standard;
    return table;
  };

  // 1. The draft's tables in order, by key; a second table under a key merges into the first.
  const drafted = new Map<string, Array<{ entry: { metric: string; change: number } | undefined; path: string }>>();
  (draft.effects ?? []).forEach((table, index) => {
    const path = `effects[${index}]`;
    if (!table) {
      note(path, 'table-dropped', `category table ${index + 1} is malformed and is dropped`);
      return;
    }
    let key = categoryKey(table.category) || `category-${index + 1}`;
    if (key === 'constructor') key = 'constructor-events';
    if (key !== table.category) note(`${path}.category`, 'category-renamed', `category "${table.category}" is keyed "${key}"`);
    if (drafted.has(key)) note(path, 'tables-merged', `a second table under "${key}" is merged into the first; the first entry for a metric stays`);
    const entries = drafted.get(key) ?? [];
    table.entries.forEach((entry, j) => entries.push({ entry, path: `${path}.entries[${j}]` }));
    drafted.set(key, entries);
  });

  // 2. Each entry: on a declared metric other than the head count, or on morale; not 0; one a metric; inside its bounds; four a table.
  const tables: Array<[key: string, table: Record<string, number>]> = [];
  for (const [key, entries] of drafted) {
    const table: Record<string, number> = {};
    const named = new Set<string>();
    for (const { entry, path } of entries) {
      if (!entry) {
        note(path, 'entry-dropped', `an entry of "${key}" is malformed and is dropped`);
        continue;
      }
      const metric = renamed.get(entry.metric) ?? entry.metric;
      if (!mayName.has(metric)) {
        note(path, 'entry-dropped', metric === 'population'
          ? `"${key}" names population, which no table moves; the entry is dropped`
          : `"${key}" names "${entry.metric}", which is not a declared metric; the entry is dropped`);
        continue;
      }
      if (!isNumber(entry.change) || entry.change === 0) {
        note(path, 'entry-dropped', `"${key}" changes ${metric} by 0; the entry is dropped`);
        continue;
      }
      if (named.has(metric)) {
        note(path, 'entry-dropped', `"${key}" names ${metric} twice; the second entry is dropped`);
        continue;
      }
      if (named.size >= MAX_DRAFT_ENTRIES) {
        note(path, 'entry-dropped', `"${key}" has more than ${MAX_DRAFT_ENTRIES} entries; the entry on ${metric} is dropped`);
        continue;
      }
      // The sign is the entry's as written: a conversion below can round a
      // small change to 0, and the entry still points the way the draft said.
      const sign = Math.sign(entry.change);
      let size = Math.abs(entry.change);
      if (fractions && percentIds.has(metric)) size = round6(size * 100);
      if (metric === 'morale' && size > 1 && size <= 100) {
        // The kernel holds morale from 0 to 1, and the draft is asked for a
        // percent's change in points: a change above 1 is read as points,
        // as a morale start is.
        const points = size;
        size = round6(size / 100);
        note(path, 'morale-in-points', `"${key}" changes morale by ${sign * points}, which is read as points and held as ${sign * size}`);
      }
      const { least, most } = boundsOf(metric);
      if (most !== undefined && size > most) {
        note(path, 'entry-above-most', `"${key}" changes ${metric} by ${sign * size}, more than a twelfth of its scale; it is cut to ${sign * most}`);
        size = most;
      } else if (most === undefined && size > MAX_MAGNITUDE) {
        // A count that starts empty has no scale to cut an entry to. Held
        // to the size a start is held to, its outcome stays finite.
        note(path, 'size-over-limit', `"${key}" changes ${metric} by ${sign * size}, larger than ${MAX_MAGNITUDE} in size; it is cut to ${sign * MAX_MAGNITUDE}`);
        size = MAX_MAGNITUDE;
      } else if (size < least) {
        note(path, 'entry-under-least', `"${key}" changes ${metric} by ${sign * size}, less than a hundredth of its scale; it is raised to ${sign * least}`);
        size = least;
      }
      named.add(metric);
      table[metric] = sign * size;
    }
    tables.push([key, table]);
  }

  // ---- Supplies that sustain the people ----------------------------------------
  // Only a metric the draft marks can be one, and only where the veto
  // passes the mark. The veto reads the tables as they stand here, the
  // draft's own: after this a table left with no entry takes the default
  // table, which names every score, and a mark that no table of the
  // draft's moves would then pass.
  const marked = metrics.filter(m => m.metric.sustains === true);
  if (marked.length > 0) {
    for (const { id } of marked) fields[id] = { ...fields[id], sustains: true };
    const refused = sustainsVeto({
      labels: draft.labels,
      setup: draft.setup,
      world: { metrics: fields, capacities: {} },
      metrics: definitions,
      effects: Object.fromEntries(tables),
    });
    for (const { key, rule, reason } of refused) {
      const unmarked = { ...fields[key] };
      delete unmarked.sustains;
      fields[key] = unmarked;
      const index = marked.find(m => m.id === key)?.index;
      note(`metrics[${index}].sustains`, 'mark-refused', `${key}: its mark as a supply that sustains the people is dropped (rule ${rule}): ${reason}`);
    }
  }

  // 3. A table left with no entry takes the default table; the first eight tables stay.
  for (const pair of tables) {
    if (Object.keys(pair[1]).length > 0) continue;
    pair[1] = defaultTable();
    note('effects', 'table-defaulted', `"${pair[0]}" is left with no entry and takes the default table`);
  }
  for (const [key] of tables.splice(MAX_TABLES)) {
    note('effects', 'table-dropped', `the draft lists more than ${MAX_TABLES} category tables; "${key}" is dropped`);
  }

  // 4. Three tables at least: a turn's two events can then differ from each
  // other and from the category used last turn.
  const drafts = tables.length;
  const added: string[] = [];
  for (const category of DEFAULT_CATEGORIES) {
    if (tables.length >= MIN_TABLES) break;
    if (tables.some(([key]) => key === category)) continue;
    tables.push([category, defaultTable()]);
    added.push(category);
  }
  if (added.length > 0) {
    note('effects', drafts === 0 ? 'default-tables' : 'tables-added', drafts === 0
      ? `the draft lists no category table; it gets ${added.join(', ')}, each moving every declared score a twentieth of its scale`
      : `the draft lists ${drafts} category table${drafts === 1 ? '' : 's'}; ${added.join(', ')} ${added.length === 1 ? 'is' : 'are'} added with the default table`);
  }

  // The object form, as the bundled scenarios write it. An object lists
  // keys that read as whole numbers first, so the first and the last table
  // are read from the object, which is what a run reads.
  const effects: Record<string, Record<string, number>> = {};
  for (const [key, table] of tables) effects[key] = table;
  const keys = Object.keys(effects);
  const names = (key: string, id: string) => Object.prototype.hasOwnProperty.call(effects[key], id);

  // 5. A declared score no table names goes into every table.
  for (const id of scored) {
    if (keys.some(key => names(key, id))) continue;
    for (const key of keys) effects[key][id] = defaultEntry(id);
    note('effects', 'score-added-to-every-table', `no category table names ${id}; it is added to every table at ${defaultEntry(id)}`);
  }

  // 6. A milestone takes the first table on turn 1 and the last on the
  // final turn, so in a run of two turns those are the only tables
  // applied: between them they name every declared score.
  const first = keys[0];
  const last = keys[keys.length - 1];
  for (const id of scored) {
    if (names(first, id) || names(last, id)) continue;
    effects[last][id] = defaultEntry(id);
    note('effects', 'score-added-to-last-table', `neither the first table ("${first}") nor the last ("${last}") names ${id}; it is added to "${last}" at ${defaultEntry(id)}`);
  }

  const worldMetrics: Record<string, SeedWorldField> = {};
  for (const { id } of metrics) worldMetrics[id] = fields[id];

  // A fixed key order: the hook cache hashes this JSON's text.
  const scenario: Record<string, unknown> = {
    id: draft.id,
    labels: { ...draft.labels },
    ...(draft.theme !== undefined ? { theme: draft.theme } : {}),
    // One death die for each person's whole life, on every compile: the
    // compiler's own choice, not a field the draft carries.
    setup: { ...draft.setup, mortalityDice: 'life' },
    world: { metrics: worldMetrics, capacities: {}, statuses: {}, politics: {}, environment: {} },
    departments,
    metrics: definitions,
    effects,
    ui: {
      headerMetrics: definitions
        .filter(d => d.id !== 'population' && d.id !== 'morale')
        .slice(0, HEADER_METRICS)
        .map(d => ({ id: d.id, format: d.format })),
    },
    knowledge: {
      topics: {},
      categoryMapping: Object.fromEntries(keys.map(key => [key, [] as string[]])),
    },
  };
  return { scenario, notes };
}
