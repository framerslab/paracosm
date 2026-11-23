/**
 * The runs the dashboard server holds: each visitor's own.
 *
 * A visitor is the `paracosm_visitor` cookie the dashboard's HTML gives a
 * browser (see {@link readVisitorId}). A caller that sends none is
 * {@link ANONYMOUS_VISITOR}: one visitor for every such caller (the CLI's own
 * run, curl, scripts), which behaves as the whole server did when it held
 * one run for everyone. Off the hosted demo, a visitor with no run of their
 * own watches the anonymous run, so the browser that opens the CLI's
 * dashboard sees the CLI's run; a stream that has followed a run of its
 * visitor's own keeps to that visitor's runs from then on.
 *
 * Each run has its own event buffer, viewers, disconnect watchdog, flags and
 * abort controller, and a broadcast of its own that the runners write
 * through. A visitor has at most one current run; their next run replaces
 * it. The server runs at most `maxRuns` at once, the runs of every visitor
 * together, and holds a finished run for its visitor until they replace or
 * clear it, until nobody has read or watched it for `staleMs`, or until the
 * held runs go over `maxHeldRuns` or `maxHeldRunBytes`. Each held run is
 * written to `<dir>/<key>.json`, so a restart keeps it. The frames a run's
 * buffer trims before its save is decided are appended, each once, to
 * `<dir>/recordings/<key>.jsonl`, so the server holds no more of a run in
 * memory than its buffer and its save still holds every frame.
 *
 * @module paracosm/server/live-runs
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { publicResultFrame, withoutBrief } from './services/run-record.js';
import type { BroadcastFn } from '../cli/pair-runner.js';
import type { NormalizedSimulationConfig } from '../cli/sim-config.js';
import type { LlmProvider, ScenarioPackage } from '../engine/types.js';

/** The first-party cookie that names a browser to this server. */
export const VISITOR_COOKIE = 'paracosm_visitor';
/** The visitor of every request that carries no valid `paracosm_visitor` cookie. */
export const ANONYMOUS_VISITOR = 'anonymous';
/** Thirty days, in seconds, the same term as the scenario pick. */
const VISITOR_MAX_AGE_SECONDS = 2_592_000;
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The request's visitor: the value of its first `paracosm_visitor` cookie
 * when that is a UUID, else {@link ANONYMOUS_VISITOR}.
 */
export function readVisitorId(req: IncomingMessage): string {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length === 0) return ANONYMOUS_VISITOR;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== VISITOR_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return VISITOR_ID.test(value) ? value : ANONYMOUS_VISITOR;
  }
  return ANONYMOUS_VISITOR;
}

/**
 * The Set-Cookie value that gives a browser its visitor id. `secure` adds
 * `Secure`, for the hosted demo, which browsers reach over HTTPS; a local
 * server answers plain HTTP, where a browser would refuse a `Secure` cookie.
 */
export function visitorCookie(id: string, secure = false): string {
  return `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${VISITOR_MAX_AGE_SECONDS}; SameSite=Lax; HttpOnly${secure ? '; Secure' : ''}`;
}

/** The Retry-After a visitor above the run cap is answered with, in seconds. */
export const RUN_CAPACITY_RETRY_AFTER_SECONDS = 180;

/** Thrown when a run would take the server over its run cap. */
export class RunCapacityError extends Error {
  readonly runsInFlight: number;
  readonly maxRuns: number;

  constructor(runsInFlight: number, maxRuns: number) {
    super(`The server is running ${maxRuns} simulation${maxRuns === 1 ? '' : 's'} right now, the most it runs at once. Try again in a few minutes.`);
    this.name = 'RunCapacityError';
    this.runsInFlight = runsInFlight;
    this.maxRuns = maxRuns;
  }

  /** The JSON body of the 503 answer. */
  body(): { error: string; runsInFlight: number; maxRuns: number } {
    return { error: this.message, runsInFlight: this.runsInFlight, maxRuns: this.maxRuns };
  }
}

/**
 * What started a run: a pair of leaders from /setup, a batch of three or more
 * (Quickstart), a fork of a finished run, or a Digital Twin intervention
 * (`POST /api/quickstart/simulate-intervention`), whose engine takes no
 * abort signal. The run's `active_scenario` event carries it.
 */
export type RunKind = 'pair' | 'batch' | 'fork' | 'intervention';
const RUN_KINDS: readonly RunKind[] = ['pair', 'batch', 'fork', 'intervention'];

/**
 * Why the server stopped a run, carried on its signal and read by the
 * orchestrator into its `sim_aborted` event: replaced by its visitor's next
 * run, cleared by its visitor, or left with no viewer (the watchdog, or a
 * run nobody touched for the idle time).
 */
export type AbortReason = 'another_run_started' | 'user_aborted' | 'client_disconnected';

/**
 * One run the server holds: its event buffer and flags, owned by one visitor.
 * In flight from {@link LiveRunRegistry.open} until {@link LiveRunRegistry.finish}
 * (its runner settled), then held for its visitor until it is dropped. A
 * dropped run is gone from the registry, but a runner still in flight keeps
 * writing through its broadcast, which discards every event, and holds its
 * capacity slot until it settles.
 */
export interface LiveRun {
  /** The run's key: the `runKey` of its `active_scenario` event. */
  readonly key: string;
  /** Its visitor; {@link ANONYMOUS_VISITOR} for a caller that sent no cookie. */
  readonly visitorId: string;
  readonly kind: RunKind;
  readonly scenarioId: string;
  readonly scenarioName: string;
  /** Null for a run read back from disk after a restart. */
  readonly scenario: ScenarioPackage | null;
  readonly seedText: string | null;
  /** Null for a Digital Twin run and for a run read back after a restart. */
  readonly config: NormalizedSimulationConfig | null;
  /** See {@link OpenRunInput.ownKeyAddress}. */
  readonly ownKeyAddress: string | null;
  /** See {@link OpenRunInput.ownKeys}. Never written with the run. */
  readonly ownKeys: RunOwnKeys | null;
  /** The run's SSE frames, with each one's wall-clock time and the actor it is tagged with. */
  readonly buffer: string[];
  readonly timestamps: number[];
  readonly actorIds: Array<string | null>;
  /** The buffer's size in UTF-16 code units, the measure the held-run byte cap reads. */
  bytes: number;
  /** The run's `active_scenario` frame, which the trim keeps first. */
  metaFrame: string | null;
  /**
   * How many frames the trim took out of the buffer while the run's save
   * was still to be decided. They are in `recordingFile`, oldest first, one
   * line each, and not in memory; in the run's recording
   * ({@link runRecording}) they go at `trimmedAt`. Zero once the save is
   * decided, when the file is removed.
   */
  spooled: number;
  /** The run's recording file: `<dir>/recordings/<key>.jsonl`, a line `[time, frame]` for each frame the trim took. */
  readonly recordingFile: string;
  /** Set when a frame the trim took could not be written to `recordingFile`: the recording is not whole, so the run is not saved. */
  recordingLost: boolean;
  /** Where in the buffer the trimmed frames were taken from: 1 when the opening frame stayed first, else 0. */
  trimmedAt: number;
  /** Set once the run broadcast `complete`, and written with the run, so a trim that takes the `complete` frame leaves the run finished. */
  ended: boolean;
  /**
   * Set once the buffer no longer holds every frame and no recording file
   * holds the rest: the trim took frames after the save was decided, or the
   * recording file went with the decision. The run's whole recording is
   * then its saved session's, if it has one.
   */
  framesLost: boolean;
  /**
   * The actor-turns the run's `turn_done` frames reported, each counted
   * once: `<actor>\u0000<turn>` (one key for each actor of that name, see
   * `actorNameCounts`), or a key of its own for a frame that names no actor
   * or turn. The buffer's trim never shortens it.
   */
  readonly completedActorTurns: Set<string>;
  /**
   * How many actor-turns the run's `turn_done` frames reported: the size
   * of `completedActorTurns` while the run broadcasts. Written with the
   * run, so a run read back after a restart, whose trimmed frames are read
   * again only by its save, keeps its count.
   */
  actorTurnsDone: number;
  /**
   * How many of the run's actors bear each name that more than one of them
   * bears. A turn_done frame names its actor by name, so two actors of one
   * name report each turn under one name, and each counts.
   */
  readonly actorNameCounts: Map<string, number>;
  /**
   * The actor-turns a finished run reports: its actors times the turns it
   * runs (a fork runs the turns after the one it forked at). Null for a
   * run with no config, such as a Digital Twin run or one read back from
   * disk before this count was written.
   */
  readonly expectedActorTurns: number | null;
  /** Each actor's final artifact cost, by the actor's place in the launch (`actor:<index>`), else the artifact's run id. */
  readonly artifactCosts: Map<string, number>;
  aborted: boolean;
  errored: boolean;
  /**
   * True once the run's save is decided: the session committed, or the run
   * will never be saved (aborted, errored, short of its turns). A restart
   * saves a finished run whose save was not decided.
   */
  saved: boolean;
  /** True while the run's save is in flight in this process. */
  saving: boolean;
  /**
   * The RunRecord ids inserted for this run, linked to its saved session.
   * Written with the run, so a save after a restart links them too.
   */
  readonly insertedRunIds: string[];
  /**
   * The saved session whose Library link (`insertedRunIds` to its id) is
   * still to be written, after a link failed once the save committed; null
   * otherwise. Written with the run, so the next start tries it again.
   */
  pendingLink: string | null;
  /** The session the run's save committed, or null. */
  savedSessionId: string | null;
  capWarned: boolean;
  /** True until the run's runner settles; the run holds a capacity slot until then. */
  inFlight: boolean;
  /**
   * Set when its visitor's Clear stopped it in flight and its runner takes
   * the signal: the visitor's next run is admitted as if it had settled,
   * once. From then it holds its slot until its runner settles.
   */
  stoppedByVisitor: boolean;
  /** Non-null while the run is in flight. */
  controller: AbortController | null;
  readonly startedAt: number;
  /** The last broadcast, stream attach or leave, and /results or /chat read. */
  lastActivity: number;
  finishedAt: number | null;
  /** Set by drop: a late event of a dropped run is discarded. */
  dropped: boolean;
  /** Whether any stream has watched the run; the watchdog arms only for one that has. */
  hadViewer: boolean;
  watchdog: ReturnType<typeof setTimeout> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
  touchTimer: ReturnType<typeof setTimeout> | null;
}

/** How a {@link LiveRunRegistry} bounds, keeps and shares its runs. */
export interface LiveRunRegistryOptions {
  /**
   * The folder held runs are written to: `${APP_DIR}/.live-runs`. Its
   * `recordings/` folder holds the frames each run's buffer trimmed before
   * the run's save was decided.
   */
  dir: string;
  /** The single buffer file of the server before runs were per visitor; removed at boot and never read. */
  legacyBufferPath?: string;
  maxRuns: number;
  maxHeldRuns: number;
  maxHeldRunBytes: number;
  /** A run nobody has read or watched for this long goes. */
  staleMs: number;
  /** How long a run in flight goes on with no viewer before the watchdog stops it. */
  disconnectGraceMs: number;
  /** A run's buffer is trimmed at this many frames, oldest first, its opening kept. */
  bufferMaxEntries: number;
  /** Called on a run's `complete` frame. */
  onComplete?: (run: LiveRun) => void;
  /** Called once a run is dropped. */
  onDrop?: (run: LiveRun) => void;
  /**
   * Whether a visitor with no run of their own watches the anonymous run.
   * True (the default) for a server run from the CLI or a clone, whose own
   * run is the anonymous one; false on the hosted demo, where an anonymous
   * run belongs to whichever caller sent no cookie.
   */
  shareAnonymousRun?: boolean;
}

/** A run to open with {@link LiveRunRegistry.open}. */
export interface OpenRunInput {
  visitorId: string;
  kind: RunKind;
  scenario: ScenarioPackage;
  seedText: string | null;
  config: NormalizedSimulationConfig | null;
  /** A fork's parent run and turn. */
  forkedFrom?: { parentRunId: string; atTurn: number } | null;
  /** The run's key; minted when absent. */
  runKey?: string;
  /**
   * The client address of a run on the caller's own key, which the day
   * limit does not count; null or absent for any other run. One address
   * holds at most all but one of the run slots with such runs.
   */
  ownKeyAddress?: string | null;
  /**
   * The provider and keys of a Digital Twin run on the caller's own key. Such
   * a run has no config to hold them, and a chat on it that brings no key
   * runs on them. Held in memory alone: a run's file holds no key, and a run
   * read back after a restart has none. Null or absent for any other run.
   */
  ownKeys?: RunOwnKeys | null;
}

/** The provider a run on the caller's own key runs on, with that key. */
export interface RunOwnKeys {
  provider: LlmProvider;
  apiKey?: string;
  anthropicKey?: string;
}

interface StreamInfo {
  visitorId: string;
  /** The run the stream named with `?run=`, else null: it follows its visitor. */
  runKey: string | null;
  actorFilter: string | null;
  /**
   * Set once the stream has followed a run of its visitor's own: from then it
   * watches only their runs, never the anonymous run, whose frames would
   * reach a page with no opening and over what it shows.
   */
  ownOnly?: boolean;
  /**
   * The stream reads none of the brief its run was compiled from: set on
   * the hosted demo for a stream that names another visitor's run by key.
   */
  hideBrief?: boolean;
}

/** How many run keys are remembered, so no request opens a run under a key another run has had. */
const USED_KEYS_MAX = 1024;
const PERSIST_DEBOUNCE_MS = 500;
const SWEEP_INTERVAL_MS = 60_000;

/** The fields of a run's config that hold the caller's model and search keys. */
const RUN_KEY_FIELDS = ['apiKey', 'anthropicKey', 'serperKey', 'firecrawlKey', 'tavilyKey', 'cohereKey'] as const;

/** Lets go of the keys a run holds in memory: its config's and a Digital Twin run's own. */
function forgetRunKeys(run: LiveRun): void {
  if (run.config) for (const field of RUN_KEY_FIELDS) delete run.config[field];
  if (run.ownKeys) {
    delete run.ownKeys.apiKey;
    delete run.ownKeys.anthropicKey;
  }
}

interface PersistedRun {
  version: 1;
  key: string;
  visitorId: string;
  kind: RunKind;
  scenarioId: string;
  scenarioName: string;
  seedText: string | null;
  aborted: boolean;
  errored: boolean;
  saved: boolean;
  events: string[];
  timestamps: number[];
  actorIds: Array<string | null>;
  /** How many frames trimmed from `events` while the save was undecided are in the run's recording file; they go at `trimmedAt`. */
  spooled?: number;
  trimmedAt?: number;
  recordingLost?: boolean;
  ended?: boolean;
  framesLost?: boolean;
  savedSessionId?: string;
  actorTurnsDone?: number;
  pendingLink?: string;
  expectedActorTurns?: number | null;
  artifactCosts?: Array<[string, number]>;
  actorNameCounts?: Array<[string, number]>;
  insertedRunIds?: string[];
}

/** How many of `names` bear each name that more than one of them bears. */
function sharedNameCounts(names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const [name, n] of counts) if (n < 2) counts.delete(name);
  return counts;
}

/**
 * Every frame the run broadcast, in order, with its time: the buffer, with
 * the frames the trim took while the run's save was undecided read back
 * from the run's recording file and put back at `trimmedAt`. The run's
 * saved session is made from it. It takes the buffer as it is when called
 * and the first `spooled` lines of the file, the frames trimmed by then,
 * so frames trimmed while it reads change nothing. Null when the file
 * holds fewer whole lines, or a trimmed frame could not be written.
 */
export async function runRecording(run: LiveRun): Promise<{ frames: string[]; timestamps: number[] } | null> {
  if (run.recordingLost) return null;
  const at = run.trimmedAt;
  const count = run.spooled;
  const frames = [...run.buffer];
  const timestamps = [...run.timestamps];
  if (count === 0) return { frames, timestamps };
  const spooled = await readRecordingFile(run.recordingFile, count);
  if (!spooled) return null;
  return {
    frames: [...frames.slice(0, at), ...spooled.frames, ...frames.slice(at)],
    timestamps: [...timestamps.slice(0, at), ...spooled.timestamps, ...timestamps.slice(at)],
  };
}

/**
 * The first `count` frames of a recording file, with their times: one
 * line `[time, frame]` each, read in chunks. Null when the file is gone,
 * holds fewer whole lines, or a line is not one.
 */
async function readRecordingFile(file: string, count: number): Promise<{ frames: string[]; timestamps: number[] } | null> {
  const frames: string[] = [];
  const timestamps: number[] = [];
  const stream = createReadStream(file, { encoding: 'utf-8' });
  let rest = '';
  try {
    for await (const chunk of stream as AsyncIterable<string>) {
      const text = rest + chunk;
      let start = 0;
      for (let nl = text.indexOf('\n'); nl >= 0; nl = text.indexOf('\n', start)) {
        const entry: unknown = JSON.parse(text.slice(start, nl));
        if (!Array.isArray(entry) || typeof entry[1] !== 'string') return null;
        timestamps.push(typeof entry[0] === 'number' ? entry[0] : 0);
        frames.push(entry[1]);
        start = nl + 1;
        if (frames.length === count) return { frames, timestamps };
      }
      rest = text.slice(start);
    }
    return null;
  } catch {
    return null;
  } finally {
    stream.destroy();
  }
}

/**
 * The actor-turn a `turn_done` frame reports, or null for any other frame.
 * The orchestrator's frame is `sim` with `{type: 'turn_done', leader,
 * data: {turn}}`; an older frame is `turn_done` with the turn at its top
 * and the actor as `leader` or `actorIndex`. A frame that names no actor
 * or turn gets a key no other frame has, so it counts once. A name that
 * `shared` says n actors bear has n keys for each turn, one per actor.
 */
function completedActorTurn(
  event: string,
  data: unknown,
  actorId: string | null,
  counted: Set<string>,
  shared: ReadonlyMap<string, number>,
): string | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as { type?: unknown; leader?: unknown; actorIndex?: unknown; turn?: unknown; data?: unknown };
  if (event === 'sim' ? payload.type !== 'turn_done' : event !== 'turn_done') return null;
  const inner = event === 'sim' && payload.data && typeof payload.data === 'object'
    ? (payload.data as { turn?: unknown })
    : payload;
  const turn = typeof inner.turn === 'number' ? inner.turn : typeof payload.turn === 'number' ? payload.turn : null;
  const actor = typeof payload.leader === 'string' && payload.leader !== ''
    ? payload.leader
    : typeof payload.actorIndex === 'number' ? `#${payload.actorIndex}` : actorId;
  if (actor === null || turn === null) return `\u0001${counted.size}`;
  const key = `${actor}\u0000${turn}`;
  const actors = shared.get(actor) ?? 1;
  for (let i = 0; i < actors; i++) {
    const candidate = i === 0 ? key : `${key}\u0000${i}`;
    if (!counted.has(candidate)) return candidate;
  }
  return key;
}

/** Parses an SSE frame written by {@link sseFrame} back into its event and data. */
function parseFrame(msg: string): { event: string; data: unknown } | null {
  const nl = msg.indexOf('\n');
  if (!msg.startsWith('event: ') || nl < 0) return null;
  const dataLine = msg.slice(nl + 1).split('\n', 1)[0];
  if (!dataLine.startsWith('data: ')) return null;
  try {
    return { event: msg.slice('event: '.length, nl), data: JSON.parse(dataLine.slice('data: '.length)) };
  } catch {
    return null;
  }
}

const sseFrame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * Every run the server holds, by key and by visitor, with the event streams
 * that watch them. It admits runs under the server's cap, gives each run the
 * broadcast its runner writes through, arms each run's disconnect watchdog,
 * lets go of finished runs by the idle time and the held caps, and writes
 * each run to `<dir>/<key>.json` so a restart reads it back.
 */
export class LiveRunRegistry {
  private readonly options: LiveRunRegistryOptions;
  private readonly runs = new Map<string, LiveRun>();
  private readonly currentByVisitor = new Map<string, string>();
  private readonly streams = new Map<ServerResponse, StreamInfo>();
  /** Runs whose runner has not settled, dropped ones included. */
  private readonly unsettled = new Set<LiveRun>();
  private readonly usedKeys = new Set<string>();
  private readonly broadcasts = new WeakMap<LiveRun, BroadcastFn>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  private dirReady = false;
  private persistFailureLogged = false;
  private closed = false;

  /**
   * Reads back the runs written under `options.dir` within the idle time,
   * removes the older ones and the legacy single buffer, and starts the
   * sweep timer (unref'd, so it never keeps the process alive).
   */
  constructor(options: LiveRunRegistryOptions) {
    this.options = options;
    this.loadPersisted();
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  /** The most runs the server has in flight at once. */
  get maxRuns(): number {
    return this.options.maxRuns;
  }

  /** Runs whose runner has not settled, across every visitor. */
  inFlightCount(): number {
    return this.unsettled.size;
  }

  /** Finished runs held for their visitors. */
  heldCount(): number {
    let n = 0;
    for (const run of this.runs.values()) if (!run.inFlight) n++;
    return n;
  }

  /** Scenario ids named by every run held here, including restored and finished runs. */
  scenarioIdsInRuns(): Set<string> {
    return new Set([...this.runs.values()].map(run => run.scenarioId));
  }

  heldBytes(): number {
    let n = 0;
    for (const run of this.runs.values()) if (!run.inFlight) n += run.bytes;
    return n;
  }

  /**
   * The visitor's own current run. On a server that shares no anonymous
   * run (the hosted demo) the anonymous visitor is every caller that sent no
   * cookie, so it holds no run there: such a caller's run opens under a
   * visitor id of its own.
   */
  current(visitorId: string): LiveRun | undefined {
    if (visitorId === ANONYMOUS_VISITOR && this.options.shareAnonymousRun === false) return undefined;
    const key = this.currentByVisitor.get(visitorId);
    return key === undefined ? undefined : this.runs.get(key);
  }

  /**
   * The run a visitor's page shows: their own current run, else, while they
   * have none, the anonymous visitor's (the CLI's own run, watched from the
   * browser that opened its dashboard), unless the server shares no
   * anonymous run (the hosted demo).
   */
  watched(visitorId: string): LiveRun | undefined {
    const own = this.current(visitorId);
    if (own || visitorId === ANONYMOUS_VISITOR || this.options.shareAnonymousRun === false) return own;
    return this.current(ANONYMOUS_VISITOR);
  }

  get(key: string): LiveRun | undefined {
    return this.runs.get(key);
  }

  /**
   * True when a run has opened under this key: one of the last 1024 keys, or
   * the key of a run the server still holds, however many runs opened since.
   */
  isKeyUsed(key: string): boolean {
    return this.usedKeys.has(key) || this.runs.has(key);
  }

  /**
   * Throws {@link RunCapacityError} when a run for this visitor would take
   * the server over its cap. Every run whose runner has not settled counts,
   * a run its visitor stopped included, except two of the visitor's own:
   * their current run, which their next run replaces and stops as it opens,
   * and a run their Clear stopped whose runner is still settling, which their
   * next run alone counts as settled (the dashboard's Run while a run is in
   * flight clears it first). A Digital Twin run counts until its engine
   * returns: the engine takes no signal, so replacing it stops nothing.
   */
  checkCapacity(visitorId: string, ownKeyAddress: string | null = null): void {
    const current = this.current(visitorId);
    let count = 0;
    let fromAddress = 0;
    for (const run of this.unsettled) {
      const stops = run.visitorId === visitorId && run.kind !== 'intervention';
      if (stops && (run === current || run.stoppedByVisitor)) continue;
      count++;
      if (ownKeyAddress !== null && run.ownKeyAddress === ownKeyAddress) fromAddress++;
    }
    if (count >= this.options.maxRuns) throw new RunCapacityError(count, this.options.maxRuns);
    // Runs on a caller's own key skip the day limit, so one address could
    // otherwise hold every slot: it holds all but one of them.
    const perAddress = Math.max(1, this.options.maxRuns - 1);
    if (fromAddress >= perAddress) throw new RunCapacityError(fromAddress, perAddress);
  }

  /**
   * Opens a run for its visitor, replacing their current run, and writes the
   * run's `active_scenario` frame. Throws {@link RunCapacityError}, before
   * anything changes, when the server is at its cap.
   */
  open(input: OpenRunInput): LiveRun {
    if (this.closed) throw new Error('The server is closed.');
    this.checkCapacity(input.visitorId, input.ownKeyAddress ?? null);
    const key = input.runKey ?? randomUUID();
    const watchedBefore = this.watched(input.visitorId);
    // This admission counted the runs the visitor stopped as settled; from
    // here they hold their slots until their runners settle.
    for (const run of this.unsettled) if (run.visitorId === input.visitorId) run.stoppedByVisitor = false;
    const previous = this.current(input.visitorId);
    if (previous) {
      const wasInFlight = previous.inFlight;
      this.drop(previous, 'another_run_started');
      if (wasInFlight) this.abort(previous, 'another_run_started');
    }

    const now = Date.now();
    const run: LiveRun = {
      key,
      visitorId: input.visitorId,
      kind: input.kind,
      scenarioId: input.scenario.id,
      scenarioName: input.scenario.labels?.name ?? input.scenario.id,
      scenario: input.scenario,
      seedText: input.seedText,
      config: input.config,
      ownKeyAddress: input.ownKeyAddress ?? null,
      ownKeys: input.ownKeys ?? null,
      buffer: [],
      timestamps: [],
      actorIds: [],
      bytes: 0,
      metaFrame: null,
      spooled: 0,
      recordingFile: this.recordingFileOf(key),
      recordingLost: false,
      trimmedAt: 0,
      ended: false,
      framesLost: false,
      completedActorTurns: new Set(),
      actorTurnsDone: 0,
      actorNameCounts: sharedNameCounts(input.config?.actors.map(actor => actor.name) ?? []),
      expectedActorTurns: input.config
        ? input.config.actors.length * Math.max(0, input.config.turns - (input.forkedFrom?.atTurn ?? 0))
        : null,
      artifactCosts: new Map(),
      aborted: false,
      errored: false,
      saved: false,
      saving: false,
      insertedRunIds: [],
      pendingLink: null,
      savedSessionId: null,
      capWarned: false,
      inFlight: true,
      stoppedByVisitor: false,
      controller: new AbortController(),
      startedAt: now,
      lastActivity: now,
      finishedAt: null,
      dropped: false,
      hadViewer: false,
      watchdog: null,
      persistTimer: null,
      touchTimer: null,
    };
    this.runs.set(key, run);
    this.currentByVisitor.set(run.visitorId, key);
    this.unsettled.add(run);
    // The visitor's streams keep to their own runs from here.
    for (const info of this.streams.values()) {
      if (info.runKey === null && info.visitorId === run.visitorId) info.ownOnly = true;
    }
    this.rememberKey(key);
    console.log(`  [runs] ${key} opened for ${run.visitorId.slice(0, 8)} (${this.unsettled.size} in flight)`);

    // The run's first frame names its scenario. A page tells a new run from
    // a replay of the one it holds by `runKey`, an intervention run from a
    // pair run by `kind`, and a fork shows as a branch of its parent.
    this.broadcastFor(run)('active_scenario', {
      id: input.scenario.id,
      name: run.scenarioName,
      settlementNoun: input.scenario.labels?.settlementNoun,
      populationNoun: input.scenario.labels?.populationNoun,
      departments: input.scenario.departments?.length ?? 0,
      seedText: input.seedText,
      runKey: key,
      forkedFrom: input.forkedFrom ?? null,
      kind: input.kind,
    });
    run.metaFrame = run.buffer[0] ?? null;
    if (this.viewerCount(run) > 0) run.hadViewer = true;
    // A visitor's pages that watched the anonymous run watch their own now,
    // so the anonymous run may have lost its last viewer.
    if (watchedBefore && watchedBefore !== previous) this.armIfUnwatched(watchedBefore);
    return run;
  }

  /** The broadcast a run's runner writes through. A dropped run's events go nowhere. */
  broadcastFor(run: LiveRun): BroadcastFn {
    const cached = this.broadcasts.get(run);
    if (cached) return cached;
    const broadcast: BroadcastFn = (event, data, actorId) => {
      if (run.dropped || this.closed) return;
      const msg = sseFrame(event, data);
      const tag = actorId ?? null;
      const now = Date.now();
      run.buffer.push(msg);
      run.timestamps.push(now);
      run.actorIds.push(tag);
      run.bytes += msg.length;
      const done = completedActorTurn(event, data, tag, run.completedActorTurns, run.actorNameCounts);
      if (done !== null && !run.completedActorTurns.has(done)) {
        run.completedActorTurns.add(done);
        run.actorTurnsDone += 1;
      }
      this.trim(run);
      run.lastActivity = now;
      this.persistSoon(run);
      for (const [res, info] of this.streams) {
        if (this.watchedBy(info) !== run) continue;
        // A stream subscribed to one actor gets the run's global frames
        // (untagged) and that actor's.
        if (info.actorFilter !== null && tag !== null && tag !== info.actorFilter) continue;
        try {
          res.write(info.hideBrief ? withoutBrief(msg) : msg);
        } catch {
          this.streams.delete(res);
        }
      }
      // A run whose runner reported an abort or a provider error is not a
      // finished run: the orchestrator sends both inside `sim` frames, and
      // the pair runner ends such a run with `complete {aborted: true}`.
      const simType = event === 'sim' && data && typeof data === 'object' ? (data as { type?: unknown }).type : undefined;
      if (event === 'sim_aborted' || simType === 'sim_aborted') run.aborted = true;
      if (event === 'complete' && data && typeof data === 'object' && (data as { aborted?: unknown }).aborted === true) run.aborted = true;
      if (event === 'sim_error' || simType === 'provider_error') run.errored = true;
      if (event === 'complete') {
        run.ended = true;
        // The run's end goes to disk now, before its save starts: a server
        // stopped before the save commits reads the run back finished and
        // saves it after its restart.
        this.persistNow(run);
        this.options.onComplete?.(run);
      }
    };
    this.broadcasts.set(run, broadcast);
    return broadcast;
  }

  /**
   * Marks a run's save decided: its session committed, or it will never be
   * saved. The decision is written with the run now, so a restart does not
   * save it again, and then its recording file goes. A committed save's
   * session is written with the run, and so is its Library link when the
   * run's records are still to be linked to it, in the same write, so a
   * server stopped before the link answers links them at its next start.
   * A server already closed cannot write the decision: the file stays, and
   * the restart saves the run again under its key, which the store holds
   * once.
   */
  settleSave(run: LiveRun, committed: { sessionId: string; linkPending: boolean } | null = null): void {
    run.saved = true;
    run.saving = false;
    if (committed !== null) {
      run.savedSessionId = committed.sessionId;
      if (committed.linkPending) run.pendingLink = committed.sessionId;
    }
    if (this.closed && !run.dropped) return;
    if (run.spooled > 0) run.framesLost = true;
    run.spooled = 0;
    this.persistNow(run);
    this.removeRecording(run);
  }

  /**
   * A run's save failed and stays undecided: a restart saves it from its
   * file. A run dropped while it was saving has no restart to come, so its
   * recording file goes now.
   */
  abandonSave(run: LiveRun): void {
    run.saving = false;
    if (run.dropped) this.removeRecording(run);
  }

  /**
   * Records the saved session whose Library link is still to be written,
   * or null once it is, and writes it with the run, so the next start
   * tries the link again.
   */
  setPendingLink(run: LiveRun, sessionId: string | null): void {
    if (run.pendingLink === sessionId) return;
    run.pendingLink = sessionId;
    this.persistNow(run);
  }

  /** The runs read back at boot whose saved session's Library link is still to be written. */
  pendingLinks(): LiveRun[] {
    return [...this.runs.values()].filter(run => run.saved && run.pendingLink !== null && run.insertedRunIds.length > 0);
  }

  /**
   * The runs read back at boot that finished (their buffer holds a
   * `complete`, and no abort or error) and whose save was not decided
   * before the server stopped. A run written with no expected actor-turn
   * count is left out: its save cannot be checked for a full run.
   */
  finishedUnsaved(): LiveRun[] {
    return [...this.runs.values()].filter(run => !run.inFlight && !run.saved && !run.saving && !run.aborted && !run.errored
      && run.expectedActorTurns !== null
      && run.ended);
  }

  /**
   * Writes a run's buffer to a stream, the frames of other actors left out
   * for a stream subscribed to one, and the brief left out with `hideBrief`.
   */
  replay(res: ServerResponse, run: LiveRun, actorFilter: string | null, hideBrief = false): void {
    for (let i = 0; i < run.buffer.length; i++) {
      const tag = run.actorIds[i] ?? null;
      if (actorFilter !== null && tag !== null && tag !== actorFilter) continue;
      try {
        const frame = publicResultFrame(run.buffer[i]);
        res.write(hideBrief ? withoutBrief(frame) : frame);
      } catch {
        break;
      }
    }
  }

  /** Adds a stream; returns the run it watches, whose watchdog it disarms. */
  attach(res: ServerResponse, info: StreamInfo): LiveRun | undefined {
    this.streams.set(res, {
      ...info,
      ownOnly: info.runKey === null && this.current(info.visitorId) !== undefined,
    });
    const run = this.watchedBy(this.streams.get(res)!);
    if (run) {
      run.hadViewer = true;
      this.disarm(run);
      run.lastActivity = Date.now();
      this.touchSoon(run);
    }
    return run;
  }

  /** Removes a stream; a run in flight it was the last viewer of arms its watchdog. */
  detach(res: ServerResponse): void {
    const info = this.streams.get(res);
    if (!info) return;
    this.streams.delete(res);
    if (this.closed) return;
    const run = this.watchedBy(info);
    if (!run) return;
    run.lastActivity = Date.now();
    this.armIfUnwatched(run);
  }

  /** Marks a read of a run (/results, /chat), which keeps it held. */
  touch(run: LiveRun): void {
    run.lastActivity = Date.now();
    this.touchSoon(run);
  }

  /** Stops a run in flight with a reason its runner reads off the signal. */
  abort(run: LiveRun, reason: AbortReason): void {
    if (run.controller && !run.controller.signal.aborted) run.controller.abort(reason);
  }

  /** Called once a run's runner has settled: the run's capacity slot is free. */
  finish(run: LiveRun): void {
    if (!run.inFlight) return;
    run.inFlight = false;
    run.controller = null;
    run.finishedAt = Date.now();
    this.unsettled.delete(run);
    this.disarm(run);
    if (!run.dropped && !this.closed) this.enforceCaps();
  }

  /**
   * A visitor's Clear (or anything else that lets their run go): the run's
   * viewers are told (`run_cleared`), so a second tab of the visitor empties
   * its view, then the run is dropped and, in flight, stopped.
   */
  clear(run: LiveRun, reason = 'cleared'): void {
    if (run.dropped) return;
    const wasInFlight = run.inFlight;
    this.evict(run, reason, null);
    if (wasInFlight) this.stopForVisitor(run, 'user_aborted');
  }

  /** Drops every finished run, files included, naming each to `onDrop`; returns how many runs in flight were kept. */
  dropFinished(onDrop?: (run: LiveRun) => void): number {
    for (const run of [...this.runs.values()]) {
      if (run.inFlight) continue;
      onDrop?.(run);
      this.evict(run, 'wiped', 'client_disconnected');
    }
    return this.unsettled.size;
  }

  /**
   * Removes a run: its timers, its file, its place as its visitor's current
   * run. Its later events are discarded. A run in flight keeps its capacity
   * slot until its runner settles.
   */
  drop(run: LiveRun, reason: string): void {
    if (run.dropped) return;
    run.dropped = true;
    this.disarm(run);
    if (run.persistTimer) clearTimeout(run.persistTimer);
    if (run.touchTimer) clearTimeout(run.touchTimer);
    run.persistTimer = null;
    run.touchTimer = null;
    this.runs.delete(run.key);
    if (this.currentByVisitor.get(run.visitorId) === run.key) this.currentByVisitor.delete(run.visitorId);
    try {
      unlinkSync(this.fileOf(run));
    } catch { /* never written, or already gone */ }
    // A save in flight still reads the recording; it lets the file go once it settles.
    if (!run.saving) this.removeRecording(run);
    console.log(`  [runs] ${run.key} dropped (${reason})`);
    this.options.onDrop?.(run);
  }

  /**
   * Lets go of what nobody needs: a finished run nobody has read or watched
   * for the idle time, and the keys of a finished one that is watched but
   * not read for it, then the oldest finished runs while the held runs are
   * over their count or byte cap. A run in flight is the watchdog's.
   */
  sweep(now = Date.now()): void {
    if (this.closed) return;
    for (const run of [...this.runs.values()]) {
      if (run.inFlight) continue;
      if (now - run.lastActivity <= this.options.staleMs) continue;
      if (this.viewerCount(run) > 0) {
        // An open page keeps the run, not the keys it ran on: they go after
        // the idle time, as a chat agent built on them does.
        forgetRunKeys(run);
        continue;
      }
      this.evict(run, 'idle', 'client_disconnected');
    }
    this.enforceCaps();
  }

  /** Writes what is pending to disk and stops every timer; nothing is written after. */
  close(): void {
    if (this.closed) return;
    for (const run of this.runs.values()) {
      if (run.persistTimer) {
        clearTimeout(run.persistTimer);
        run.persistTimer = null;
        this.writeRun(run);
      }
      if (run.touchTimer) {
        clearTimeout(run.touchTimer);
        run.touchTimer = null;
        this.touchFile(run);
      }
      this.disarm(run);
    }
    for (const run of this.unsettled) this.disarm(run);
    clearInterval(this.sweepTimer);
    this.streams.clear();
    this.closed = true;
  }

  private watchedBy(info: StreamInfo): LiveRun | undefined {
    if (info.runKey !== null) return this.runs.get(info.runKey);
    return info.ownOnly ? this.current(info.visitorId) : this.watched(info.visitorId);
  }

  private viewerCount(run: LiveRun): number {
    let n = 0;
    for (const info of this.streams.values()) if (this.watchedBy(info) === run) n++;
    return n;
  }

  private writeToViewers(run: LiveRun, msg: string): void {
    for (const [res, info] of this.streams) {
      if (this.watchedBy(info) !== run) continue;
      try {
        res.write(msg);
      } catch {
        this.streams.delete(res);
      }
    }
  }

  /**
   * Tells a run's viewers it is gone, drops it, and stops it when in flight
   * with `abortReason` (null: the caller stops it).
   */
  private evict(run: LiveRun, reason: string, abortReason: AbortReason | null): void {
    if (run.dropped) return;
    this.writeToViewers(run, sseFrame('run_cleared', { runKey: run.key }));
    const wasInFlight = run.inFlight;
    this.drop(run, reason);
    if (wasInFlight && abortReason !== null) this.abort(run, abortReason);
  }

  /** Stops a run its visitor cleared; their next run counts it as settled, once. */
  private stopForVisitor(run: LiveRun, reason: AbortReason): void {
    if (run.inFlight && run.kind !== 'intervention') run.stoppedByVisitor = true;
    this.abort(run, reason);
  }

  /** The held caps: runs with no viewer go before runs with one, the oldest first. */
  private enforceCaps(): void {
    const held = [...this.runs.values()].filter(run => !run.inFlight);
    let count = held.length;
    let bytes = held.reduce((n, run) => n + run.bytes, 0);
    if (count <= this.options.maxHeldRuns && bytes <= this.options.maxHeldRunBytes) return;
    const watched = new Set(held.filter(run => this.viewerCount(run) > 0));
    held.sort((a, b) => Number(watched.has(a)) - Number(watched.has(b)) || a.lastActivity - b.lastActivity);
    for (const run of held) {
      if (count <= this.options.maxHeldRuns && bytes <= this.options.maxHeldRunBytes) break;
      const reason = count > this.options.maxHeldRuns ? 'held runs over PARACOSM_MAX_HELD_RUNS' : 'held runs over PARACOSM_MAX_HELD_RUN_BYTES';
      this.evict(run, reason, 'client_disconnected');
      count -= 1;
      bytes -= run.bytes;
    }
  }

  private armIfUnwatched(run: LiveRun): void {
    if (!run.inFlight || run.dropped || !run.hadViewer || run.watchdog || this.closed) return;
    if (this.viewerCount(run) > 0) return;
    const graceMs = this.options.disconnectGraceMs;
    run.watchdog = setTimeout(() => {
      run.watchdog = null;
      if (!run.inFlight || run.dropped || this.viewerCount(run) > 0) return;
      console.log(`  [watchdog] No viewer of run ${run.key} for ${graceMs}ms: aborting it.`);
      this.abort(run, 'client_disconnected');
    }, graceMs);
    // The timer alone never keeps the process alive: a listening server or
    // a run still at work does that.
    run.watchdog.unref?.();
  }

  private disarm(run: LiveRun): void {
    if (run.watchdog) {
      clearTimeout(run.watchdog);
      run.watchdog = null;
    }
  }

  private trim(run: LiveRun): void {
    const max = this.options.bufferMaxEntries;
    if (run.buffer.length <= Math.ceil(max * 1.1)) return;
    // Hysteresis: trim 10% above the cap so the splice runs once per tenth
    // of the cap, not per event. The opening frame stays first: without it
    // a late replay and the saved session lose which scenario the run is.
    const keep = run.metaFrame !== null && run.buffer[0] === run.metaFrame ? 1 : 0;
    const drop = run.buffer.length - max - keep;
    const removed = run.buffer.splice(keep, drop);
    const removedTimestamps = run.timestamps.splice(keep, drop);
    run.actorIds.splice(keep, drop);
    for (const msg of removed) run.bytes -= msg.length;
    // Until the run's save is decided its recording keeps every frame, so
    // the saved session is the whole run, not what the buffer kept: in the
    // run's recording file, not in memory.
    if (!run.saved) this.spool(run, removed, removedTimestamps, keep);
    else run.framesLost = true;
    if (!run.capWarned) {
      console.warn(
        `[event-buffer] Run ${run.key} capped at ${max} events; dropped oldest ${drop}. ` +
        'Late reconnects on this run will miss the dropped prefix. Bump PARACOSM_EVENT_BUFFER_MAX to widen.',
      );
      run.capWarned = true;
    }
  }

  private rememberKey(key: string): void {
    this.usedKeys.add(key);
    if (this.usedKeys.size > USED_KEYS_MAX) {
      this.usedKeys.delete(this.usedKeys.values().next().value as string);
    }
  }

  private fileOf(run: { key: string }): string {
    return join(this.options.dir, `${encodeURIComponent(run.key)}.json`);
  }

  private recordingsDir(): string {
    return join(this.options.dir, 'recordings');
  }

  private recordingFileOf(key: string): string {
    return join(this.recordingsDir(), `${encodeURIComponent(key)}.jsonl`);
  }

  /**
   * Appends the frames the trim took to the run's recording file, a line
   * `[time, frame]` each, so its save can hold them while the server does
   * not. Each frame is written once, as it is trimmed. A write that fails
   * marks the recording lost: the run is not saved, and nothing more is
   * written for it.
   */
  private spool(run: LiveRun, frames: readonly string[], timestamps: readonly number[], at: number): void {
    if (run.recordingLost || frames.length === 0) return;
    if (run.spooled === 0) run.trimmedAt = at;
    let lines = '';
    for (let i = 0; i < frames.length; i++) lines += `${JSON.stringify([timestamps[i] ?? 0, frames[i]])}\n`;
    try {
      if (run.spooled === 0) mkdirSync(this.recordingsDir(), { recursive: true });
      appendFileSync(run.recordingFile, lines);
      run.spooled += frames.length;
    } catch (err) {
      run.recordingLost = true;
      console.log(`  [runs] Writing the recording of run ${run.key} failed, so the run will not be saved: ${err}`);
    }
  }

  /** Removes a run's recording file, if it has one. */
  private removeRecording(run: LiveRun): void {
    if (run.spooled > 0) run.framesLost = true;
    run.spooled = 0;
    try {
      unlinkSync(run.recordingFile);
    } catch { /* never written, or already gone */ }
  }

  /** Coalesces a burst of events into one write, at most half a second late. */
  /** Writes a run now, in place of its pending delayed write. */
  private persistNow(run: LiveRun): void {
    if (this.closed || run.dropped) return;
    if (run.persistTimer) {
      clearTimeout(run.persistTimer);
      run.persistTimer = null;
    }
    this.writeRun(run);
  }

  private persistSoon(run: LiveRun): void {
    if (this.closed || run.dropped || run.persistTimer) return;
    run.persistTimer = setTimeout(() => {
      run.persistTimer = null;
      this.writeRun(run);
    }, PERSIST_DEBOUNCE_MS);
    run.persistTimer.unref?.();
  }

  private writeRun(run: LiveRun): void {
    if (run.dropped) return;
    if (run.touchTimer) {
      clearTimeout(run.touchTimer);
      run.touchTimer = null;
    }
    const persisted: PersistedRun = {
      version: 1,
      key: run.key,
      visitorId: run.visitorId,
      kind: run.kind,
      scenarioId: run.scenarioId,
      scenarioName: run.scenarioName,
      seedText: run.seedText,
      aborted: run.aborted,
      errored: run.errored,
      saved: run.saved,
      events: run.buffer,
      timestamps: run.timestamps,
      actorIds: run.actorIds,
      expectedActorTurns: run.expectedActorTurns,
      ...(run.artifactCosts.size > 0 ? { artifactCosts: [...run.artifactCosts] } : {}),
      ...(run.actorNameCounts.size > 0 ? { actorNameCounts: [...run.actorNameCounts] } : {}),
      ...(run.insertedRunIds.length > 0 ? { insertedRunIds: run.insertedRunIds } : {}),
      actorTurnsDone: run.actorTurnsDone,
      // The trimmed frames are in the run's recording file: the run's file
      // says how many, so no write serializes them again.
      ...(run.spooled > 0 ? { spooled: run.spooled, trimmedAt: run.trimmedAt } : {}),
      ...(run.recordingLost ? { recordingLost: true } : {}),
      ...(run.ended ? { ended: true } : {}),
      ...(run.framesLost ? { framesLost: true } : {}),
      ...(run.savedSessionId !== null ? { savedSessionId: run.savedSessionId } : {}),
      ...(run.pendingLink !== null ? { pendingLink: run.pendingLink } : {}),
    };
    try {
      if (!this.dirReady) {
        mkdirSync(this.options.dir, { recursive: true });
        this.dirReady = true;
      }
      writeFileSync(this.fileOf(run), JSON.stringify(persisted));
    } catch (err) {
      if (!this.persistFailureLogged) {
        console.log(`  [runs] Persisting run ${run.key} failed: ${err}`);
        this.persistFailureLogged = true;
      }
    }
  }

  /**
   * A read moves the file's mtime, which a restart reads as the run's last
   * activity, so a run someone keeps reading survives the restart.
   */
  private touchSoon(run: LiveRun): void {
    if (this.closed || run.dropped || run.persistTimer || run.touchTimer) return;
    run.touchTimer = setTimeout(() => {
      run.touchTimer = null;
      this.touchFile(run);
    }, PERSIST_DEBOUNCE_MS);
    run.touchTimer.unref?.();
  }

  private touchFile(run: LiveRun): void {
    if (run.dropped) return;
    try {
      const now = new Date();
      utimesSync(this.fileOf(run), now, now);
    } catch { /* not written yet: its first write sets the time */ }
  }

  /**
   * Boot: reads back the runs written within the idle time, each as a
   * finished run, the newest per visitor becoming their current run. A run
   * whose buffer holds no `complete` was cut by the restart: it gets a
   * `sim_aborted` (reason `server_restarted`) and an aborted `complete`, so a
   * page that reconnects shows it as interrupted, not live for good.
   */
  private loadPersisted(): void {
    const { legacyBufferPath, dir, staleMs } = this.options;
    if (legacyBufferPath && existsSync(legacyBufferPath)) {
      // The single buffer of every visitor names no visitor, so it is never replayed.
      try {
        unlinkSync(legacyBufferPath);
        console.log(`  [runs] Removed ${legacyBufferPath}: a buffer from before runs were per visitor`);
      } catch { /* best effort */ }
    }
    if (!existsSync(dir)) return;
    const now = Date.now();
    const loaded: Array<{ run: LiveRun; mtimeMs: number }> = [];
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch (err) {
      console.log(`  [runs] Reading ${dir} failed: ${err}`);
      return;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = join(dir, name);
      try {
        const { mtimeMs } = statSync(file);
        if (now - mtimeMs > staleMs) {
          unlinkSync(file);
          continue;
        }
        const run = this.readRun(JSON.parse(readFileSync(file, 'utf-8')), mtimeMs);
        if (!run || name !== `${encodeURIComponent(run.key)}.json`) {
          unlinkSync(file);
          continue;
        }
        loaded.push({ run, mtimeMs });
      } catch {
        try { unlinkSync(file); } catch { /* best effort */ }
      }
    }
    loaded.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const { run, mtimeMs } of loaded) {
      if (this.currentByVisitor.has(run.visitorId)) {
        try { unlinkSync(this.fileOf(run)); } catch { /* best effort */ }
        continue;
      }
      // Finished when its `complete` was broadcast, which the trim may have
      // taken from the buffer into its recording file.
      const ended = run.ended;
      // Only a finished run whose save is still to be decided is saved from
      // its recording file; any other run's file goes.
      if (!ended || run.saved || run.aborted || run.errored || run.expectedActorTurns === null) this.removeRecording(run);
      if (!ended) {
        for (const msg of [
          sseFrame('sim', { type: 'sim_aborted', leader: '', data: { reason: 'server_restarted' } }),
          sseFrame('complete', { aborted: true }),
        ]) {
          run.buffer.push(msg);
          run.timestamps.push(now);
          run.actorIds.push(null);
          run.bytes += msg.length;
        }
        run.aborted = true;
        run.ended = true;
        this.writeRun(run);
        try {
          const at = new Date(mtimeMs);
          utimesSync(this.fileOf(run), at, at);
        } catch { /* best effort */ }
      }
      // The idle time starts again at boot: the file was read within it,
      // and the visitor had no server to read the run from while it was down.
      run.lastActivity = now;
      this.runs.set(run.key, run);
      this.currentByVisitor.set(run.visitorId, run.key);
      this.rememberKey(run.key);
    }
    if (loaded.length > 0) console.log(`  [runs] Read back ${this.runs.size} held run(s) from ${dir}`);
    // A recording file no held run reads (its run's file was stale, or
    // removed, or its save was decided as the server stopped) goes.
    const recorded = new Set([...this.runs.values()].filter(run => run.spooled > 0).map(run => basename(run.recordingFile)));
    try {
      for (const name of readdirSync(this.recordingsDir())) {
        if (recorded.has(name)) continue;
        try { unlinkSync(join(this.recordingsDir(), name)); } catch { /* best effort */ }
      }
    } catch { /* no recordings folder */ }
    this.enforceCaps();
  }

  private readRun(raw: unknown, mtimeMs: number): LiveRun | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Partial<PersistedRun>;
    if (p.version !== 1 || typeof p.key !== 'string' || p.key.length === 0) return null;
    if (typeof p.visitorId !== 'string' || (p.visitorId !== ANONYMOUS_VISITOR && !VISITOR_ID.test(p.visitorId))) return null;
    if (!Array.isArray(p.events) || !p.events.every(e => typeof e === 'string')) return null;
    const events = p.events as string[];
    const timestamps = Array.isArray(p.timestamps) && p.timestamps.length === events.length
      ? p.timestamps.map(t => (typeof t === 'number' ? t : 0))
      : new Array<number>(events.length).fill(0);
    const actorIds = Array.isArray(p.actorIds) && p.actorIds.length === events.length
      ? p.actorIds.map(a => (typeof a === 'string' ? a : null))
      : new Array<string | null>(events.length).fill(null);
    const first = events[0];
    const spooled = typeof p.spooled === 'number' && Number.isInteger(p.spooled) && p.spooled > 0 ? p.spooled : 0;
    const trimmedAt = spooled > 0 && p.trimmedAt === 1 && events.length > 0 ? 1 : 0;
    const artifactCosts = new Map<string, number>();
    if (Array.isArray(p.artifactCosts)) {
      for (const entry of p.artifactCosts) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number') artifactCosts.set(entry[0], entry[1]);
      }
    }
    const actorNameCounts = new Map<string, number>();
    if (Array.isArray(p.actorNameCounts)) {
      for (const entry of p.actorNameCounts) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isInteger(entry[1]) && entry[1] > 1) actorNameCounts.set(entry[0], entry[1]);
      }
    }
    // The buffer's actor-turns, under the actor tags they were broadcast
    // with. The count is the one written with the run, which the run kept
    // as it broadcast every frame, those in its recording file included;
    // a run written without it counts its buffer.
    const completedActorTurns = new Set<string>();
    for (let i = 0; i < events.length; i++) {
      const frame = parseFrame(events[i]);
      if (!frame) continue;
      const done = completedActorTurn(frame.event, frame.data, actorIds[i] ?? null, completedActorTurns, actorNameCounts);
      if (done !== null) completedActorTurns.add(done);
    }
    const writtenTurnsDone = typeof p.actorTurnsDone === 'number' && Number.isInteger(p.actorTurnsDone) && p.actorTurnsDone >= 0 ? p.actorTurnsDone : null;
    return {
      key: p.key,
      visitorId: p.visitorId,
      kind: RUN_KINDS.includes(p.kind as RunKind) ? (p.kind as RunKind) : 'pair',
      scenarioId: typeof p.scenarioId === 'string' ? p.scenarioId : '',
      scenarioName: typeof p.scenarioName === 'string' ? p.scenarioName : '',
      scenario: null,
      seedText: typeof p.seedText === 'string' ? p.seedText : null,
      config: null,
      ownKeyAddress: null,
      ownKeys: null,
      buffer: events,
      timestamps,
      actorIds,
      bytes: events.reduce((n, msg) => n + msg.length, 0),
      metaFrame: first !== undefined && first.startsWith('event: active_scenario\n') ? first : null,
      spooled,
      recordingFile: this.recordingFileOf(p.key),
      recordingLost: p.recordingLost === true,
      trimmedAt,
      ended: p.ended === true || events.some(msg => msg.startsWith('event: complete\n')),
      framesLost: p.framesLost === true,
      completedActorTurns,
      actorTurnsDone: writtenTurnsDone ?? completedActorTurns.size,
      actorNameCounts,
      expectedActorTurns: typeof p.expectedActorTurns === 'number' && p.expectedActorTurns >= 0 ? p.expectedActorTurns : null,
      artifactCosts,
      aborted: p.aborted === true,
      errored: p.errored === true,
      saved: p.saved === true,
      saving: false,
      insertedRunIds: Array.isArray(p.insertedRunIds) ? p.insertedRunIds.filter((id): id is string => typeof id === 'string') : [],
      pendingLink: typeof p.pendingLink === 'string' && p.pendingLink.length > 0 ? p.pendingLink : null,
      savedSessionId: typeof p.savedSessionId === 'string' && p.savedSessionId.length > 0 ? p.savedSessionId : null,
      capWarned: false,
      inFlight: false,
      stoppedByVisitor: false,
      controller: null,
      startedAt: timestamps.find(t => t > 0) ?? mtimeMs,
      lastActivity: mtimeMs,
      finishedAt: mtimeMs,
      dropped: false,
      hadViewer: false,
      watchdog: null,
      persistTimer: null,
      touchTimer: null,
    };
  }
}
