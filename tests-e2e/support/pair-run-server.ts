/**
 * The dashboard server with a stub pair runner, on a port of its own.
 *
 * The server code is the real one, over HTTP and SSE. Only the pair runner,
 * which would call a model for every department of every turn, is stubbed: it
 * writes the frames `runPairSimulations` in src/cli/pair-runner.ts writes
 * before its first model call (`status` with `phase: 'starting'`, then `status`
 * with `phase: 'parallel'` and the leaders, then each leader's first
 * `turn_start`) and holds the run open until the server aborts it, as a new
 * run does. The Digital Twin world, which the server compiles with a model on
 * boot, is none here: no test of this server runs a twin. A run here replaces
 * this server's event buffer and nobody else's.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';

const server = createMarsServer({
  env: { ...process.env, APP_DIR: mkdtempSync(join(tmpdir(), 'paracosm-e2e-pair-run-')), PARACOSM_HOSTED_DEMO: '' },
  maxSimsPerDay: 0,
  runHistoryStore: createNoopRunHistoryStore(),
  getDigitalTwinWorld: async () => null,
  runPairSimulations: async (config, broadcast, signal) => {
    const { actors, turns, startTime, customEvents } = config;
    broadcast('status', { phase: 'starting', maxTurns: turns, customEvents });
    broadcast('status', {
      phase: 'parallel',
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
server.listen(Number(process.env.PORT ?? 3458));
