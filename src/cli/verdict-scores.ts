/**
 * Scenario-driven inputs for the verdict calls in `pair-runner.ts`.
 *
 * The judge compares finished runs on the scores the scenario declares
 * (`scenario.metrics`, header scores first) in the scenario's own words
 * (`scenario.labels`), so a lab is judged on its benchmarks and a
 * colony on its population, morale, food and power.
 *
 * @module paracosm/cli/verdict-scores
 */
import type { MetricDefinition, ScenarioPackage } from '../engine/types.js';

/** Display format of a score row after the scenario's units are read. */
export type ScoreFormat = MetricDefinition['format'];

/** One declared score with each judged run's final value, in run order. */
export interface ScoreRow {
  id: string;
  label: string;
  format: ScoreFormat;
  /** Which way is better, when the scenario declares it. */
  better?: 'higher' | 'lower';
  /** The world field's unit, where it adds to the label (`kW`, `months`). */
  unit?: string;
  /** True when the score is one of the scenario's `ui.headerMetrics`. */
  header: boolean;
  /** Final values in run order; a `percent` score is a fraction (0.82 reads 82%). */
  values: Array<number | undefined>;
}

/** A status or politics field whose final value differs between runs. */
export interface StateRow {
  label: string;
  unit: string;
  values: unknown[];
}

/** The scenario's words for the verdict prompt. */
export interface VerdictWords {
  name: string;
  tagline: string;
  settlement: string;
  /** The settlement word with its article: "a lab", "an outpost". */
  aSettlement: string;
  population: string;
  actors: string;
  eventSingular: string;
  currency: string;
}

type WorldBag = Record<string, { label?: string; unit?: string; type?: string; initial?: unknown; max?: unknown } | undefined>;

function worldBag(scenario: ScenarioPackage, bag: string): WorldBag {
  const world = (scenario.world ?? {}) as unknown as Record<string, WorldBag | undefined>;
  return world[bag] ?? {};
}

function readPath(state: unknown, source: string): unknown {
  let cur: unknown = state;
  for (const part of source.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function readNumber(state: unknown, source: string): number | undefined {
  const v = readPath(state, source);
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** The world field a `source` path such as `metrics.specGamingRate` points at. */
function worldDef(scenario: ScenarioPackage, source: string) {
  const [bag, key] = source.split('.');
  return key ? worldBag(scenario, bag)[key] : undefined;
}

/** Units the label or the format already says, so the row does not repeat them. */
const SILENT_UNITS = new Set(['', '%', 'frac', 'score', 'people']);

type ScoreDef = { id: string; label?: string; source: string; format: ScoreFormat; better?: 'higher' | 'lower'; header: boolean };

function declaredDirection(better: unknown): 'higher' | 'lower' | undefined {
  return better === 'higher' || better === 'lower' ? better : undefined;
}

function isMetricDefinition(m: unknown): m is MetricDefinition {
  return typeof m === 'object' && m !== null && typeof (m as MetricDefinition).id === 'string';
}

/**
 * Whether a percent score holds 0 to 100 rather than a 0 to 1 fraction:
 * the world field's declared ceiling says so (Hull Integrity declares
 * max 100), then its starting value, then the values themselves.
 */
function holdsHundreds(def: ReturnType<typeof worldDef>, values: Array<number | undefined>): boolean {
  const declared = [def?.max, def?.initial].find(v => typeof v === 'number') as number | undefined;
  if (declared !== undefined) return declared > 1;
  return values.some(v => v !== undefined && Math.abs(v) > 1);
}

function scoreRow(scenario: ScenarioPackage, d: ScoreDef, states: unknown[]): ScoreRow {
  const def = worldDef(scenario, d.source);
  const format: ScoreFormat = d.format === 'percent' || def?.unit === 'frac' ? 'percent' : d.format;
  const raw = states.map(s => readNumber(s, d.source));
  const values = format === 'percent' && holdsHundreds(def, raw)
    ? raw.map(v => (v === undefined ? v : v / 100))
    : raw;
  const unit = format === 'number' && def?.unit && !SILENT_UNITS.has(def.unit) ? def.unit : undefined;
  return {
    id: d.id,
    label: d.label || d.id,
    format,
    ...(d.better ? { better: d.better } : {}),
    ...(unit ? { unit } : {}),
    header: d.header,
    values,
  };
}

/** Rows some run holds a value for; a score no run reached tells the judge nothing. */
function rowsWithValues(scenario: ScenarioPackage, defs: ScoreDef[], states: unknown[]): ScoreRow[] {
  return defs
    .map(d => scoreRow(scenario, d, states))
    .filter(r => r.values.some(v => v !== undefined));
}

/**
 * Every score the scenario declares, header scores first in their
 * header order, then the rest of `scenario.metrics`. A metric with no
 * `source` (a seed-compiled draft declares only id and format) reads
 * `metrics.<id>`. A fraction (unit `frac`) reads as a percentage, and
 * a percent score on a 0 to 100 scale is brought down to a fraction, so
 * every percent value in a row is on one scale. Scores no run holds a
 * value for are left out. Where that leaves none, the world's metric
 * fields stand in, then every numeric field of the runs' final metrics.
 */
export function scenarioScoreRows(scenario: ScenarioPackage, states: unknown[]): ScoreRow[] {
  const metrics = (Array.isArray(scenario.metrics) ? scenario.metrics : []).filter(isMetricDefinition);
  const byId = new Map(metrics.map(m => [m.id, m]));
  const headerMetrics = (Array.isArray(scenario.ui?.headerMetrics) ? scenario.ui.headerMetrics : []).filter(h => typeof h?.id === 'string');
  const defs: ScoreDef[] = [];
  const seen = new Set<string>();
  for (const h of headerMetrics) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const m = byId.get(h.id);
    const source = m?.source || `metrics.${h.id}`;
    defs.push({ id: h.id, label: m?.label ?? worldDef(scenario, source)?.label, source, format: m?.format ?? h.format, better: declaredDirection(m?.better), header: true });
  }
  for (const m of metrics) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const source = m.source || `metrics.${m.id}`;
    defs.push({ id: m.id, label: m.label ?? worldDef(scenario, source)?.label, source, format: m.format, better: declaredDirection(m.better), header: false });
  }
  const declared = rowsWithValues(scenario, defs, states);
  if (declared.length > 0) return declared;

  const worldDefs: ScoreDef[] = [];
  for (const [id, def] of Object.entries(worldBag(scenario, 'metrics'))) {
    if (def?.type && def.type !== 'number') continue;
    worldDefs.push({ id, label: def?.label, source: `metrics.${id}`, format: 'number', header: false });
  }
  const fromWorld = rowsWithValues(scenario, worldDefs, states);
  if (fromWorld.length > 0) return fromWorld;

  const ids = new Set<string>();
  for (const s of states) {
    const bag = readPath(s, 'metrics');
    if (bag && typeof bag === 'object') {
      for (const [k, v] of Object.entries(bag)) if (typeof v === 'number') ids.add(k);
    }
  }
  return rowsWithValues(scenario, [...ids].map(id => ({ id, source: `metrics.${id}`, format: 'number' as const, header: false })), states);
}

/** Status and politics fields the scenario declares whose final values differ between runs. */
export function differingStateRows(scenario: ScenarioPackage, states: unknown[]): StateRow[] {
  const rows: StateRow[] = [];
  for (const bag of ['statuses', 'politics']) {
    for (const [key, def] of Object.entries(worldBag(scenario, bag))) {
      const values = states.map(s => readPath(s, `${bag}.${key}`));
      if (values.every(v => v === undefined)) continue;
      const first = JSON.stringify(values[0]);
      if (values.every(v => JSON.stringify(v) === first)) continue;
      rows.push({ label: def?.label || key, unit: def?.unit ?? '', values });
    }
  }
  return rows;
}

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 100) return String(Math.round(v));
  if (abs >= 10) return v.toFixed(1);
  if (abs >= 0.1) return v.toFixed(2);
  return v.toFixed(3);
}

/** One final value in the score's format; a fraction in percent format reads as a percentage. */
export function formatScoreValue(v: unknown, format: ScoreFormat, currency = ''): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return typeof v === 'string' ? v : 'n/a';
  if (format === 'percent') return `${Math.round(v * 1000) / 10}%`;
  if (format === 'currency') return currency ? `${formatNumber(v)} ${currency}` : formatNumber(v);
  return formatNumber(v);
}

/** The scenario's own nouns, with neutral words where a label is missing. */
export function verdictWords(scenario: ScenarioPackage): VerdictWords {
  const l = scenario.labels ?? ({} as ScenarioPackage['labels']);
  const settlement = l.settlementNoun || 'settlement';
  return {
    name: l.name || 'the scenario',
    tagline: l.tagline ?? '',
    settlement,
    aSettlement: `${/^[aeiou]/i.test(settlement) ? 'an' : 'a'} ${settlement}`,
    population: l.populationNoun || 'members',
    actors: l.actorNounPlural || (l.actorNoun ? `${l.actorNoun}s` : 'leaders'),
    eventSingular: l.eventNounSingular || 'event',
    currency: l.currency ?? '',
  };
}

/**
 * The side-by-side score block of a verdict prompt: one line per score
 * with every run's final value after its tag (`A`, `B`, `#3`), and
 * which way is better where the scenario says.
 */
export function formatScoreTable(rows: ScoreRow[], tags: string[], words: VerdictWords): string {
  return rows.map(r => {
    const values = r.values.map((v, i) => `${tags[i]} ${formatScoreValue(v, r.format, words.currency)}`).join(' | ');
    const direction = r.better ? ` (${r.better} is better)` : '';
    const unit = r.unit ? ` (${r.unit})` : '';
    return `  ${r.label}${unit}: ${values}${direction}`;
  }).join('\n');
}

/** The block of status and politics fields that differ, or '' when none do. */
export function formatStateTable(rows: StateRow[], tags: string[]): string {
  return rows.map(r => {
    const unit = r.unit && r.unit !== '' ? ` (${r.unit})` : '';
    const values = r.values.map((v, i) => `${tags[i]} ${typeof v === 'number' ? formatNumber(v) : String(v ?? 'n/a')}`).join(' | ');
    return `  ${r.label}${unit}: ${values}`;
  }).join('\n');
}

/** The rows a verdict card shows: the header scores, or every score when the scenario names no header. */
export function cardRows(rows: ScoreRow[]): ScoreRow[] {
  const header = rows.filter(r => r.header);
  return header.length > 0 ? header : rows;
}
