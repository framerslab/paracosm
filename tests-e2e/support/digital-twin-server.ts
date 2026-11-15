/**
 * The dashboard server with a stub Digital Twin engine, on a port of its own.
 *
 * The server code is the real one, over HTTP and SSE, with the
 * t2d-glp1-protocol scenario read from scenarios/. Only `world.intervene`,
 * which would call a model on every turn, is stubbed: it hands the route the
 * events the engine emits. The pair runner, which would call a model for every
 * department of every turn, is stubbed too, so a run started from the page's
 * Run controls opens on the stream and holds until the server aborts it, as a
 * new run does. A run here replaces this server's event buffer and nobody
 * else's, so the other specs' server is left alone.
 *
 * Admin writes are on (ADMIN_WRITE=true and an ADMIN_TOKEN), for the test
 * that deletes the server's data while a finished twin's result is on the
 * page. The token guards nothing but this server's temporary folders: its
 * saved sessions and its runs folder are temporary ones, so a wipe sent with
 * the token removes nothing from output/.
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { WorldModel } from '../../src/runtime/world-model/index.js';
import { TWIN_ENGINE_ERROR, TWIN_ENGINE_FAILS, TWIN_ENGINE_SLOW, twinArtifact, twinEvents, type TwinEvent } from './digital-twin-run.js';

const scenario = JSON.parse(readFileSync(new URL('../../scenarios/t2d-glp1-protocol.json', import.meta.url), 'utf-8')) as unknown;

/** The same value tests-e2e/specs/digital-twin-events.spec.ts saves in its page. */
const ADMIN_TOKEN = 'e2e-twin-admin-token';

const root = mkdtempSync(join(tmpdir(), 'paracosm-e2e-digital-twin-'));
const appDir = join(root, 'app');
const runsDir = join(root, 'output');
mkdirSync(appDir);
mkdirSync(runsDir);

interface StubInterveneOptions {
  subject: { id: string };
  intervention: unknown;
  actor: { name: string };
  maxTurns?: number;
  onEvent?: (event: TwinEvent) => void;
}

const world = {
  scenario,
  intervene: async ({ subject, intervention, actor, maxTurns, onEvent }: StubInterveneOptions) => {
    const events = twinEvents(actor.name, maxTurns);
    if (subject.id === TWIN_ENGINE_FAILS) {
      onEvent?.(events[0]);
      throw new Error(TWIN_ENGINE_ERROR);
    }
    const gapMs = subject.id === TWIN_ENGINE_SLOW ? 150 : 5;
    for (const event of events) {
      onEvent?.(event);
      await new Promise(resolve => setTimeout(resolve, gapMs));
    }
    return twinArtifact(subject, intervention);
  },
} as unknown as WorldModel;

const server = createMarsServer({
  env: {
    ...process.env,
    APP_DIR: appDir,
    PARACOSM_OUTPUT_DIR: runsDir,
    PARACOSM_HOSTED_DEMO: '',
    ADMIN_WRITE: 'true',
    ADMIN_TOKEN,
  },
  runHistoryStore: createNoopRunHistoryStore(),
  getDigitalTwinWorld: async () => world,
  maxSimsPerDay: 0,
  // Each test is a visitor of its own, and a pair run here holds until it is
  // stopped: nothing stops it when the test's page closes, before the
  // watchdog's grace. Under the default cap of 3 runs in flight, the tests
  // that start a pair run filled the server and the later tests' twins were
  // refused with a 503.
  maxRuns: 64,
  // One status frame names the turn count and the leaders, which is what
  // marks a run running on the page, then each leader's first turn.
  runPairSimulations: async (config, broadcast, signal) => {
    const { actors, turns, startTime } = config;
    broadcast('status', {
      phase: 'parallel',
      maxTurns: turns,
      actors: actors.map(leader => ({ name: leader.name, archetype: leader.archetype, unit: leader.unit, hexaco: leader.hexaco })),
    });
    for (const leader of actors) {
      broadcast('sim', { type: 'turn_start', leader: leader.name, data: { turn: 1, time: startTime, title: 'Director generating...', crisis: '', births: 0, deaths: 0, metrics: {} } }, leader.name);
    }
    await new Promise<void>(resolve => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  },
});
server.listen(Number(process.env.PORT ?? 3457));
