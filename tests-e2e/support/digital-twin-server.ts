/**
 * The dashboard server with a stub Digital Twin engine, on a port of its own.
 *
 * The server code is the real one, over HTTP and SSE, with the
 * t2d-glp1-protocol scenario read from scenarios/. Only `world.intervene`,
 * which would call a model on every turn, is stubbed: it hands the route the
 * events the engine emits. A run here replaces this server's event buffer and
 * nobody else's, so the other specs' server is left alone.
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
});
server.listen(Number(process.env.PORT ?? 3457));
