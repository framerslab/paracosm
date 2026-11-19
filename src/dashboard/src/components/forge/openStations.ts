/**
 * Which stations of a trace are open, and the set a visitor opened, kept on
 * this device for each run.
 *
 * A trace opens with the station that decided its outcome open. Each station
 * the visitor opened on an earlier tool of the same run opens beside it, when
 * this tool's station holds evidence; one with nothing to show on this tool
 * stays closed. The sets are kept in one entry of the device's storage, one
 * set a run, for the 20 runs written last.
 */
import { STATIONS, type LineModel, type StationId } from './forgeLine';

/** The storage entry: `{ [runKey: string]: StationId[] }`, at most 20 runs, the oldest dropped. */
export const OPEN_STATIONS_KEY = 'paracosm:forgeOpenStations';

/** How many runs' sets the device keeps. */
const KEPT_RUNS = 20;

const isStation = (value: unknown): value is StationId =>
  typeof value === 'string' && (STATIONS as readonly string[]).includes(value);

/** Every run's kept set, in the order they were written. A value that cannot be read is no set at all. */
function readAll(storage: Storage): Map<string, StationId[]> {
  const sets = new Map<string, StationId[]>();
  let raw: string | null;
  try {
    raw = storage.getItem(OPEN_STATIONS_KEY);
  } catch {
    return sets;
  }
  if (!raw) return sets;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return sets;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return sets;
  for (const [runKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (Array.isArray(value)) sets.set(runKey, STATIONS.filter((s) => value.some((v) => isStation(v) && v === s)));
  }
  return sets;
}

/** The stations the visitor left open on this run's tools, in the line's order. */
export function readKeptStations(storage: Storage, runKey: string): StationId[] {
  return readAll(storage).get(runKey) ?? [];
}

/**
 * Keeps a run's open stations, in place of what the run kept before. The run
 * becomes the newest; past 20 runs the oldest are dropped. A storage that
 * refuses the write keeps nothing, and the trace keeps its set while it is open.
 */
export function keepStations(storage: Storage, runKey: string, open: StationId[]): void {
  const sets = readAll(storage);
  sets.delete(runKey);
  sets.set(runKey, STATIONS.filter((s) => open.includes(s)));
  const runs = [...sets.keys()];
  for (const old of runs.slice(0, Math.max(0, runs.length - KEPT_RUNS))) sets.delete(old);
  try {
    storage.setItem(OPEN_STATIONS_KEY, JSON.stringify(Object.fromEntries(sets)));
  } catch {
    // Storage full or refused: the set is not kept past this trace.
  }
}

/** The stations open when a trace opens: the one that decided the outcome, and each kept one that holds evidence. */
export function initialOpen(model: LineModel, kept: StationId[], hasEvidence: (s: StationId) => boolean): Set<StationId> {
  const open = new Set<StationId>([model.deciding]);
  for (const station of kept) if (hasEvidence(station)) open.add(station);
  return open;
}

/**
 * The stations that hold evidence on the run's record. Request holds the
 * actor's line, what the tool does and its fields on every forge; Judge holds
 * the verdict and Added the uses of a passed forge; the record holds no code
 * and no tests, so Code and Tests hold nothing.
 */
export function recordEvidence(passed: boolean): (station: StationId) => boolean {
  return (station) => station === 'request' || (passed && (station === 'judge' || station === 'added'));
}

/** The run a set is kept for: the replayed session's id, else the run's key, else 'live'. */
export function runKeyOf(href: string, runKey: string | null): string {
  let replay: string | null = null;
  try {
    replay = new URL(href).searchParams.get('replay');
  } catch {
    // Not an address: the run's own key names it.
  }
  return replay || runKey || 'live';
}
