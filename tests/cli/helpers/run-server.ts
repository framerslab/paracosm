/**
 * The dashboard server over HTTP for tests of several visitors.
 *
 * Every helper here goes through createMarsServer with the scenario JSON
 * under scenarios/ and a stub simulation runner, so no model is called. A
 * visitor is a cookie jar (./visitor.ts); a visitor who opened the dashboard
 * holds a `paracosm_visitor` id, which `cookied()` gives them directly.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer, type CreateMarsServerOptions, type MarsServer } from '../../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../../src/server/stores/run-history.js';
import type { NormalizedSimulationConfig } from '../../../src/cli/sim-config.js';
import type { BroadcastFn } from '../../../src/cli/pair-runner.js';
import type { ScenarioPackage } from '../../../src/engine/types.js';
import { visitor, type Visitor } from './visitor.js';

/** The cookie the server gives a browser the first time it opens the dashboard. */
export const VISITOR_COOKIE = 'paracosm_visitor';

export interface ScenarioJson {
  id: string;
  labels: { name: string };
  setup: { defaultTurns: number; defaultSeed: number };
  presets: Array<{
    leaders: Array<{ name: string; archetype: string; hexaco: Record<string, number>; instructions: string }>;
  }>;
}

export function readScenario(file: string): ScenarioJson {
  return JSON.parse(readFileSync(new URL(`../../../scenarios/${file}`, import.meta.url), 'utf-8')) as ScenarioJson;
}

export const atlasLab = readScenario('atlas-lab.json');
export const mars = readScenario('mars.json');

/** The body QuickstartView posts: the preset's leaders, turns and seed, the scenario under quickstart. */
export function quickstartBody(scenario: ScenarioJson) {
  return {
    actors: scenario.presets[0].leaders,
    turns: scenario.setup.defaultTurns,
    seed: scenario.setup.defaultSeed,
    captureSnapshots: true,
    quickstart: { scenarioId: scenario.id },
  };
}

/** The body Settings and the re-run button post: the scenario at the top level. */
export function settingsBody(scenario: ScenarioJson) {
  return { actors: scenario.presets[0].leaders, turns: 6, seed: 951, scenarioId: scenario.id };
}

export interface Launch { config: NormalizedSimulationConfig; scenario: ScenarioPackage | undefined; signal: AbortSignal | undefined }
export type Runner = (
  config: NormalizedSimulationConfig,
  broadcast: BroadcastFn,
  scenario: ScenarioPackage | undefined,
  signal: AbortSignal | undefined,
) => Promise<void>;

export interface RunServerOptions {
  runner?: Runner;
  env?: Record<string, string>;
  maxSimsPerDay?: number;
  scenarioDir?: string;
  compileScenario?: CreateMarsServerOptions['compileScenario'];
  maxRuns?: number;
  maxHeldRuns?: number;
  maxHeldRunBytes?: number;
  staleBufferMs?: number;
  disconnectGraceMs?: number;
  /** The server's APP_DIR. Given: a second server can open the same one, and the caller removes it. */
  appDir?: string;
  /** Any further createMarsServer option (a stub chat agent, a Digital Twin world). */
  extra?: Record<string, unknown>;
}

export interface RunServer {
  base: string;
  appDir: string;
  server: MarsServer;
  launches: Launch[];
  forkLaunches: Launch[];
  /** A visitor holding these cookies, or none. */
  visitor: (cookies?: Record<string, string>, headers?: Record<string, string>) => Visitor;
  /** A visitor who opened the dashboard: they hold a `paracosm_visitor` id of their own. */
  cookied: (headers?: Record<string, string>) => Visitor;
  close: () => Promise<void>;
}

export async function startServer(options: RunServerOptions = {}): Promise<RunServer> {
  const appDir = options.appDir ?? mkdtempSync(join(tmpdir(), 'paracosm-run-per-visitor-'));
  const launches: Launch[] = [];
  const forkLaunches: Launch[] = [];
  const serverOptions = {
    env: { ...process.env, APP_DIR: appDir, PARACOSM_HOSTED_DEMO: '', ...options.env },
    maxSimsPerDay: options.maxSimsPerDay ?? 0,
    runHistoryStore: createNoopRunHistoryStore(),
    runPairSimulations: async (config: NormalizedSimulationConfig, broadcast: BroadcastFn, signal?: AbortSignal, scenario?: ScenarioPackage) => {
      launches.push({ config, scenario, signal });
      await options.runner?.(config, broadcast, scenario, signal);
    },
    // A fork is recorded and never run, so no fork reaches a model.
    runForkSimulation: async (config: NormalizedSimulationConfig, _broadcast: BroadcastFn, signal?: AbortSignal, scenario?: ScenarioPackage) => {
      forkLaunches.push({ config, scenario, signal });
    },
    ...(options.scenarioDir ? { scenarioDir: options.scenarioDir } : {}),
    ...(options.compileScenario ? { compileScenario: options.compileScenario } : {}),
    ...(options.maxRuns !== undefined ? { maxRuns: options.maxRuns } : {}),
    ...(options.maxHeldRuns !== undefined ? { maxHeldRuns: options.maxHeldRuns } : {}),
    ...(options.maxHeldRunBytes !== undefined ? { maxHeldRunBytes: options.maxHeldRunBytes } : {}),
    ...(options.staleBufferMs !== undefined ? { staleBufferMs: options.staleBufferMs } : {}),
    ...(options.disconnectGraceMs !== undefined ? { disconnectGraceMs: options.disconnectGraceMs } : {}),
    ...options.extra,
  } as CreateMarsServerOptions;
  const server = createMarsServer(serverOptions);
  server.listen(0);
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;
  let closed = false;
  return {
    base,
    appDir,
    server,
    launches,
    forkLaunches,
    visitor: (cookies, headers) => visitor(base, cookies, headers),
    cookied: headers => visitor(base, { [VISITOR_COOKIE]: randomUUID() }, headers),
    close: async () => {
      if (closed) return;
      closed = true;
      server.closeAllConnections?.();
      server.close();
      await once(server, 'close');
    },
  };
}

/** Runs `body` against a fresh server and removes its APP_DIR afterwards, unless the caller gave one. */
export async function withVisitors(
  body: (api: RunServer) => Promise<void>,
  options: RunServerOptions = {},
): Promise<void> {
  const api = await startServer(options);
  try {
    await body(api);
  } finally {
    await api.close();
    if (!options.appDir) rmSync(api.appDir, { recursive: true, force: true });
  }
}

export async function waitFor<T>(read: () => T | null | undefined | false | Promise<T | null | undefined | false>, what: string, ms = 2000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export interface Frame { event: string; data: Record<string, unknown> }
/** The frames a stream replays before replay_done, and its `connected` frame's data. */
export type Replay = Frame[] & { connected: Record<string, unknown> };

function parseFrames(text: string): Frame[] {
  return text.split('\n\n').filter(frame => frame.startsWith('event: ')).map(frame => {
    const [eventLine, dataLine = 'data: {}'] = frame.split('\n');
    return { event: eventLine.slice('event: '.length), data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown> };
  });
}

function openEvents(target: string | Visitor, query: string, signal: AbortSignal): Promise<Response> {
  return typeof target === 'string'
    ? fetch(`${target}/events${query}`, { signal })
    : target.get(`/events${query}`, { signal });
}

/**
 * Connects to /events as `target` (a visitor's jar, or a base URL for a
 * caller that sends no cookie) and returns what it replays before
 * replay_done.
 */
export async function readReplay(target: string | Visitor, query = ''): Promise<Replay> {
  const ac = new AbortController();
  const res = await openEvents(target, query, ac.signal);
  assert.equal(res.status, 200, `GET /events${query}: ${res.status}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (!text.includes('event: replay_done')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    ac.abort();
  }
  assert.ok(text.includes('event: replay_done'), `no replay_done: ${text}`);
  const frames = parseFrames(text);
  const done = frames.findIndex(f => f.event === 'replay_done');
  const connected = frames.find(f => f.event === 'connected')?.data ?? {};
  return Object.assign(frames.slice(1, done), { connected });
}

/** An open /events stream: every frame it has received so far, live ones included. */
export interface Stream {
  frames: Frame[];
  /** Resolves with the first frame from here on (or already received after replay_done) that matches. */
  next: (match: (frame: Frame) => boolean, what: string, ms?: number) => Promise<Frame>;
  /** Frames received after replay_done. */
  live: () => Frame[];
  close: () => void;
}

export async function openStream(target: string | Visitor, query = ''): Promise<Stream> {
  const ac = new AbortController();
  const res = await openEvents(target, query, ac.signal);
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let text = '';
  let ended = false;
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        const end = text.lastIndexOf('\n\n');
        if (end < 0) continue;
        frames.push(...parseFrames(text.slice(0, end + 2)));
        text = text.slice(end + 2);
      }
    } catch { /* closed */ }
    ended = true;
  })();
  void pump;
  await waitFor(() => frames.some(f => f.event === 'replay_done'), 'the replay to end');
  const live = () => frames.slice(frames.findIndex(f => f.event === 'replay_done') + 1);
  return {
    frames,
    live,
    next: (match, what, ms = 2000) => waitFor(() => {
      const found = live().find(match);
      if (found) return found;
      if (ended) throw new Error(`the stream ended before ${what}`);
      return null;
    }, what, ms),
    close: () => ac.abort(),
  };
}

export interface HeldLaunch {
  config: NormalizedSimulationConfig;
  signal: AbortSignal | undefined;
  release: () => void;
  settled: boolean;
}

/**
 * A runner that opens each run and holds it: it writes `status` and one
 * `turn_start` per actor, then waits for `release()` or for its signal. An
 * aborted run writes `sim_aborted` with the signal's reason and an aborted
 * `complete`; a released one writes a `turn_done` and a `result` per actor
 * and `complete`. With `untilReleased`, an aborted run still waits for
 * `release()` before it settles, as the orchestrator does while a model call
 * it made before the abort is still out.
 */
export function heldRun(options: { untilReleased?: boolean } = {}): { runner: Runner; runs: HeldLaunch[] } {
  const runs: HeldLaunch[] = [];
  const runner: Runner = async (config, broadcast, _scenario, signal) => {
    let release = () => {};
    const released = new Promise<void>(resolve => { release = resolve; });
    const entry: HeldLaunch = { config, signal, release, settled: false };
    runs.push(entry);
    broadcast('status', { phase: 'parallel', maxTurns: 1, actors: config.actors.map(a => ({ name: a.name, archetype: a.archetype })) });
    for (const actor of config.actors) {
      broadcast('sim', { type: 'turn_start', leader: actor.name, data: { turn: 1, time: 1, title: `${actor.name} turn 1` } }, actor.name);
    }
    const aborted = new Promise<void>(resolve => {
      if (signal?.aborted) resolve();
      else signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    await (options.untilReleased ? released : Promise.race([released, aborted]));
    if (signal?.aborted) {
      broadcast('sim', { type: 'sim_aborted', leader: '', data: { reason: signal.reason } });
      broadcast('complete', { aborted: true });
    } else {
      for (const actor of config.actors) {
        broadcast('sim', { type: 'turn_done', leader: actor.name, data: { turn: 1, time: 1 } }, actor.name);
      }
      for (const actor of config.actors) {
        broadcast('result', { leader: actor.name, summary: { population: 10 } }, actor.name);
      }
      broadcast('complete', {});
    }
    entry.settled = true;
  };
  return { runner, runs };
}
