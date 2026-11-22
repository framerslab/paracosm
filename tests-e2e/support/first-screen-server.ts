/**
 * The hosted demo's server with a stub pair runner, on a port of its own,
 * for tests-e2e/specs/sim-first-screen.spec.ts.
 *
 * The server code is the real one, over HTTP and SSE, in hosted_demo mode
 * (PARACOSM_HOSTED_DEMO=true) with one run a day for each internet address,
 * so GET /admin-config answers the host's caps and GET /rate-limit the day's
 * count as the hosted demo answers them. The spec gives each test an address
 * of its own in the x-real-ip header, so no two tests share a day's count.
 *
 * Only the pair runner, which would call a model for every department of
 * every turn, is stubbed, as in pair-run-server.ts: it writes the frames
 * `runPairSimulations` in src/cli/pair-runner.ts writes before its first
 * model call (`status` with `phase: 'starting'`, then `status` with
 * `phase: 'parallel'` and the leaders, then each leader's first
 * `turn_start`) and holds the run open until the server aborts it. The
 * Digital Twin world, which the server compiles with a model on boot, is
 * none here. Its folders are temporary ones and it keeps no run history.
 *
 * The hosted demo refuses a run on the host's keys when it holds no OpenAI
 * key (hosted-model-policy.ts), so the server holds a stand-in one. No
 * request here reaches a model: the pair runner is the stub below, and a
 * test that has Paracosm write leaders answers that request itself.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';

const root = mkdtempSync(join(tmpdir(), 'paracosm-e2e-first-screen-'));
const appDir = join(root, 'app');
const runsDir = join(root, 'output');
mkdirSync(appDir);
mkdirSync(runsDir);

const server = createMarsServer({
  env: {
    ...process.env,
    APP_DIR: appDir,
    PARACOSM_OUTPUT_DIR: runsDir,
    PARACOSM_HOSTED_DEMO: 'true',
    PARACOSM_CLIENT_IP_HEADER: 'x-real-ip',
    PARACOSM_DISABLE_RUN_HISTORY: '1',
    OPENAI_API_KEY: 'sk-first-screen-stand-in',
  },
  maxSimsPerDay: 1,
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
server.listen(Number(process.env.PORT ?? 3470));
