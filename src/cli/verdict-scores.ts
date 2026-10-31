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
  /** True when the score is one of the scenario's `ui.headerMetrics`. */
  header: boolean;
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
  population: string;
  actors: string;
  eventSingular: string;
  currency: string;
}

type WorldBag = Record<string, { label?: string; unit?: string; type?: string } | undefined>;

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

/**
 * Every score the scenario declares, header scores first in their
 * header order, then the rest of `scenario.metrics`. A score whose
 * world field is a fraction (unit `frac`) reads as a percentage. With
 * no declared scores, the world's metric fields stand in; with none of
 * those either, every numeric field of the runs' final metrics.
 */
export function scenarioScoreRows(scenario: ScenarioPackage, states: unknown[]): ScoreRow[] {
  const metrics = Array.isArray(scenario.metrics) ? scenario.metrics : [];
  const byId = new Map(metrics.map(m => [m.id, m]));
  const headerIds = (scenario.ui?.headerMetrics ?? []).map(h => h.id);
  const defs: Array<{ id: string; label?: string; source: string; format: ScoreFormat; better?: 'higher' | 'lower'; header: boolean }> = [];
  const seen = new Set<string>();
  for (const h of scenario.ui?.headerMetrics ?? []) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    const m = byId.get(h.id);
    const source = m?.source ?? `metrics.${h.id}`;
    defs.push({ id: h.id, label: m?.label ?? worldDef(scenario, source)?.label, source, format: m?.format ?? h.format, better: m?.better, header: true });
  }
  for (const m of metrics) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    defs.push({ id: m.id, label: m.label, source: m.source, format: m.format, better: m.better, header: headerIds.includes(m.id) });
  }
  if (defs.length === 0) {
    for (const [id, def] of Object.entries(worldBag(scenario, 'metrics'))) {
      if (def?.type && def.type !== 'number') continue;
      defs.push({ id, label: def?.label, source: `metrics.${id}`, format: 'number', header: false });
    }
  }
  if (defs.length === 0) {
    const ids = new Set<string>();
    for (const s of states) {
      const bag = readPath(s, 'metrics');
      if (bag && typeof bag === 'object') {
        for (const [k, v] of Object.entries(bag)) if (typeof v === 'number') ids.add(k);
      }
    }
    for (const id of ids) defs.push({ id, source: `metrics.${id}`, format: 'number', header: false });
  }
  return defs.map(d => ({
    id: d.id,
    label: d.label || d.id,
    format: d.format === 'percent' || worldDef(scenario, d.source)?.unit === 'frac' ? 'percent' : d.format,
    ...(d.better ? { better: d.better } : {}),
    header: d.header,
    values: states.map(s => readNumber(s, d.source)),
  }));
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
  return {
    name: l.name || 'the scenario',
    tagline: l.tagline ?? '',
    settlement: l.settlementNoun || 'settlement',
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
    return `  ${r.label}: ${values}${direction}`;
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
