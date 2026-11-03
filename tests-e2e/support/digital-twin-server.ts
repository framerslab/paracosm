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
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { WorldModel } from '../../src/runtime/world-model/index.js';
import { TWIN_ENGINE_ERROR, TWIN_ENGINE_FAILS, twinArtifact, twinEvents, type TwinEvent } from './digital-twin-run.js';

const scenario = JSON.parse(readFileSync(new URL('../../scenarios/t2d-glp1-protocol.json', import.meta.url), 'utf-8')) as unknown;

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
    for (const event of events) {
      onEvent?.(event);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return twinArtifact(subject, intervention);
  },
} as unknown as WorldModel;

const server = createMarsServer({
  env: { ...process.env, APP_DIR: mkdtempSync(join(tmpdir(), 'paracosm-e2e-digital-twin-')), PARACOSM_HOSTED_DEMO: '' },
  runHistoryStore: createNoopRunHistoryStore(),
  getDigitalTwinWorld: async () => world,
  maxSimsPerDay: 0,
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
