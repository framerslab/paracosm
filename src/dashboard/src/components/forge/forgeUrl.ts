/**
 * The forge view in the page's address: the tool a trace shows, its attempt
 * and its open stations, and the forged toolbox's state.
 *
 * A link names a tool by its number in the run's list, as the trace's header
 * row shows it. The list numbers tools in actor order, so a number is fixed
 * only once the run is complete: while a replay plays its frames in, an
 * earlier actor's first forge moves every later actor's numbers up by one.
 * So a number is written from the tool a trace holds by actor and name, and
 * read back into an actor and a name only once the run is complete.
 *
 * Pure functions: no DOM and no React, so they run under node:test.
 */
import type { ToolEntry, ToolRegistry } from '../../hooks/useToolRegistry';
import { buildReplayShareUrl, type ShareTargetTab } from '../../hooks/shareUrl.helpers';
import { getDashboardTabFromHref } from '../../tab-routing';
import { STATIONS, type StationId } from './forgeLine';
import type { TraceTarget } from './forgeViewContext';

/** The address's parameters the forge view reads and writes, beside the ones the dashboard already reads. */
export const FORGE_PARAMS = {
  tool: 'tool',
  attempt: 'attempt',
  open: 'open',
  toolbox: 'toolbox',
  show: 'show',
  find: 'find',
  group: 'group',
  actors: 'actors',
} as const;

type ForgeParam = (typeof FORGE_PARAMS)[keyof typeof FORGE_PARAMS];

const ALL_PARAMS: readonly ForgeParam[] = Object.values(FORGE_PARAMS);

/** The parameters that name one tool's trace. */
export const TRACE_PARAMS: readonly ForgeParam[] = [FORGE_PARAMS.tool, FORGE_PARAMS.attempt, FORGE_PARAMS.open];

/** What the address says of the forge view. */
export interface ForgeUrlState {
  /** The trace to open, held by actor and name. */
  trace: TraceTarget | null;
  toolbox: { open: boolean; show?: string; find?: string; group?: string; actors?: number[] };
}

/** A whole number of 1 or more written as digits alone, or null. */
function count(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** The stations a comma list names, in the line's order, each once; names that are not stations are dropped. */
function stationsOf(raw: string): StationId[] {
  const named = raw.split(',').map((part) => part.trim().toLowerCase());
  return STATIONS.filter((station) => named.includes(station));
}

/** A comma list of actor slots, 1-based, each once, in the order given; anything else is dropped. */
function slotsOf(raw: string): number[] {
  const slots: number[] = [];
  for (const part of raw.split(',')) {
    const slot = count(part);
    if (slot !== null && !slots.includes(slot)) slots.push(slot);
  }
  return slots;
}

/**
 * Reads the forge view from an address.
 *
 * With `complete` false (a run still playing in), no trace is resolved and
 * no trace parameter is called dangling, since a number cannot be trusted
 * yet. Once the run is complete, `dangling` names each parameter that points
 * at nothing in this run: a tool number the run lacks, an attempt the tool
 * lacks (either way the link names no trace, so every trace parameter it
 * holds is dangling), an `open` that names no station, an `attempt` or
 * `open` with no tool, and an `actors` list that names no actor of the run.
 */
export function parseForgeUrl(
  href: string,
  registry: Pick<ToolRegistry, 'getEntryByNumber' | 'actors'>,
  complete: boolean,
): { state: ForgeUrlState; dangling: string[] } {
  const state: ForgeUrlState = { trace: null, toolbox: { open: false } };
  const dangling: string[] = [];
  let params: URLSearchParams;
  try {
    params = new URL(href).searchParams;
  } catch {
    return { state, dangling };
  }

  // The toolbox.
  state.toolbox.open = params.get(FORGE_PARAMS.toolbox) === '1';
  for (const key of [FORGE_PARAMS.show, FORGE_PARAMS.find, FORGE_PARAMS.group] as const) {
    const value = params.get(key);
    if (value !== null && value !== '') state.toolbox[key] = value;
  }
  const actorsRaw = params.get(FORGE_PARAMS.actors);
  if (actorsRaw !== null) {
    const slots = slotsOf(actorsRaw);
    const known = complete ? slots.filter((slot) => slot <= registry.actors.length) : slots;
    if (known.length > 0) state.toolbox.actors = known;
    else if (complete) dangling.push(FORGE_PARAMS.actors);
  }

  // The trace: read only once the run is complete.
  if (!complete) return { state, dangling };
  const present = TRACE_PARAMS.filter((key) => params.has(key));
  if (present.length === 0) return { state, dangling };

  const toolRaw = params.get(FORGE_PARAMS.tool);
  const n = count(toolRaw);
  const entry: ToolEntry | undefined = n === null ? undefined : registry.getEntryByNumber(n);
  if (!entry) {
    dangling.push(...present);
    return { state, dangling };
  }

  let attempt: number | undefined;
  if (params.has(FORGE_PARAMS.attempt)) {
    const asked = count(params.get(FORGE_PARAMS.attempt));
    if (asked === null || asked > entry.attempts.length) {
      dangling.push(...present);
      return { state, dangling };
    }
    attempt = asked;
  }

  let open: StationId[] | undefined;
  if (params.has(FORGE_PARAMS.open)) {
    const stations = stationsOf(params.get(FORGE_PARAMS.open) ?? '');
    if (stations.length > 0) open = stations;
    else dangling.push(FORGE_PARAMS.open);
  }

  state.trace = {
    actorIndex: entry.actorIndex,
    toolName: entry.name,
    ...(attempt !== undefined ? { attempt } : {}),
    ...(open ? { open } : {}),
  };
  return { state, dangling };
}

/**
 * Writes the forge view into an address and keeps every other parameter.
 * The trace's tool is written as its number in the registry given, read
 * from the tool it holds by actor and name; its attempt only when it is not
 * the latest; its open stations in the line's order. A trace whose tool the
 * registry lacks writes nothing of it.
 */
export function withForgeState(
  href: string,
  state: ForgeUrlState,
  registry: Pick<ToolRegistry, 'getEntryFor'>,
): string {
  const url = new URL(href);
  for (const key of ALL_PARAMS) url.searchParams.delete(key);

  const trace = state.trace;
  const entry = trace ? registry.getEntryFor(trace.actorIndex, trace.toolName) : undefined;
  if (trace && entry) {
    url.searchParams.set(FORGE_PARAMS.tool, String(entry.n));
    if (trace.attempt !== undefined && trace.attempt >= 1 && trace.attempt < entry.attempts.length) {
      url.searchParams.set(FORGE_PARAMS.attempt, String(Math.trunc(trace.attempt)));
    }
    const open = STATIONS.filter((station) => trace.open?.includes(station));
    if (open.length > 0) url.searchParams.set(FORGE_PARAMS.open, open.join(','));
  }

  const toolbox = state.toolbox;
  if (toolbox.open) url.searchParams.set(FORGE_PARAMS.toolbox, '1');
  if (toolbox.show) url.searchParams.set(FORGE_PARAMS.show, toolbox.show);
  if (toolbox.find) url.searchParams.set(FORGE_PARAMS.find, toolbox.find);
  if (toolbox.group) url.searchParams.set(FORGE_PARAMS.group, toolbox.group);
  if (toolbox.actors && toolbox.actors.length > 0) url.searchParams.set(FORGE_PARAMS.actors, toolbox.actors.join(','));
  return url.toString();
}

/**
 * The address with the toolbox written into it and every other parameter
 * kept, the trace's included: the filter when it is not every row, the
 * search when it holds text, the grouping a visitor chose, the chosen actors
 * as their 1-based slots in launch order, and `toolbox=1` while its dialog is
 * open. With `open`, `group` or `actors` not given, that parameter stays as
 * the address has it; a `group` of null leaves the run's own default, and no
 * actor chosen leaves every actor. An address that already says so comes
 * back as it was.
 */
export function withToolbox(
  href: string,
  toolbox: { open?: boolean; show: string; find: string; group?: string | null; actors?: readonly number[] },
): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const want: Array<[string, string | null]> = [
    [FORGE_PARAMS.show, toolbox.show && toolbox.show !== 'all' ? toolbox.show : null],
    [FORGE_PARAMS.find, toolbox.find ? toolbox.find : null],
  ];
  if (toolbox.open !== undefined) want.push([FORGE_PARAMS.toolbox, toolbox.open ? '1' : null]);
  if (toolbox.group !== undefined) want.push([FORGE_PARAMS.group, toolbox.group ? toolbox.group : null]);
  if (toolbox.actors !== undefined) {
    const slots = [...new Set(toolbox.actors)].filter((i) => Number.isInteger(i) && i >= 0).sort((a, b) => a - b).map((i) => i + 1);
    want.push([FORGE_PARAMS.actors, slots.length > 0 ? slots.join(',') : null]);
  }
  let changed = false;
  for (const [key, value] of want) {
    if (url.searchParams.get(key) === value && url.searchParams.getAll(key).length <= 1) continue;
    changed = true;
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return changed ? url.toString() : href;
}

/**
 * The address without the forge view's parameters named (all of them when
 * none are named). An address that holds none of them comes back as it was.
 */
export function withoutForgeParams(href: string, names?: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const drop = (names ?? ALL_PARAMS).filter((key) => url.searchParams.has(key));
  if (drop.length === 0) return href;
  for (const key of drop) url.searchParams.delete(key);
  return url.toString();
}

/**
 * The link Copy link to this tool copies: the run's replay link on a tab,
 * with the tool's number, its attempt when it is not the latest, and its
 * open stations.
 */
export function toolLink(
  origin: string,
  sessionId: string,
  tab: ShareTargetTab,
  target: TraceTarget,
  registry: Pick<ToolRegistry, 'getEntryFor'>,
): string {
  return withForgeState(buildReplayShareUrl(origin, sessionId, tab), { trace: target, toolbox: { open: false } }, registry);
}

/**
 * The tab a tool's link opens the replay on: the tab the page shows, or the
 * Sim tab where the page shows none of the run's tabs (Quickstart, About).
 */
export function linkTab(href: string): ShareTargetTab {
  let tab: string;
  try {
    tab = getDashboardTabFromHref(href);
  } catch {
    return 'sim';
  }
  return tab === 'about' || tab === 'quickstart' ? 'sim' : (tab as ShareTargetTab);
}
