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
 * `turn_start`), then one `systems_snapshot` for each leader at turn 1, and
 * holds the run open until the server aborts it. The Atlas Lab pair instead
 * finishes with a verdict so the run view can be checked through /setup
 * and the live stream. The Digital Twin world,
 * which the server compiles with a model on boot, is none here. Its folders
 * are temporary ones and it keeps no run history.
 *
 * Each snapshot is the engine's own: the run's kernel, built from the run's
 * seed, key people, start time and population as the orchestrator builds
 * it, advanced one turn and read as the turn loop reads it
 * (tests-e2e/support/kernel-turn.ts). So the Sim tab's grid panels draw the
 * people the run starts with. A second port answers GET /roster with the
 * names each leader's snapshot held, one record a run, so a test can read
 * what the server sent.
 *
 * The hosted demo refuses a run on the host's keys when it holds no OpenAI
 * key (hosted-model-policy.ts), so the server holds a stand-in one. No
 * request here reaches a model: the pair runner is the stub below, and a
 * test that has Paracosm write leaders answers that request itself.
 */
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { judgePair, type VerdictCallOptions } from '../../src/cli/pair-runner.js';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import { VerdictSchema } from '../../src/runtime/validators/verdict.js';
import { withProviderWire } from '../../tests/cli/helpers/provider-wire.js';
import { advanceKernelTurn, snapshotData } from './kernel-turn.js';

const PORT = Number(process.env.PORT ?? 3470);
const ROSTER_PORT = Number(process.env.FIRST_SCREEN_ROSTER_PORT ?? 3472);

// Use the recorded pair's artifacts to build the verdict with the real
// judge. The fixture retains the inputs to the verdict call.
const { runs: atlasPair } = JSON.parse(readFileSync(
  new URL('../../tests/fixtures/verdict/atlas-lab-pair-2026-11-02.json', import.meta.url), 'utf8',
)) as { runs: Array<{ leaderName: string; artifact: { finalState: { metrics: Record<string, number> } } }> };

/** What one run's snapshots held: the run's population and, for each leader, the names in its roster. */
interface RosterRecord {
  population: number;
  leaders: Record<string, string[]>;
}

const rosters: RosterRecord[] = [];
const rosterServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/roster') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rosters));
    return;
  }
  res.writeHead(404);
  res.end();
});
// A roster port that cannot open is logged, and the page's server starts all the same.
rosterServer.on('error', (err) => { console.error('[first-screen-server] the roster port did not open:', err); });
rosterServer.listen(ROSTER_PORT, '127.0.0.1');

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
  runPairSimulations: async (config, broadcast, signal, scenario) => {
    const { actors, turns, startTime, customEvents } = config;
    broadcast('status', { phase: 'starting', maxTurns: turns, customEvents });
    broadcast('status', {
      phase: 'parallel',
      actors: actors.map(leader => ({ name: leader.name, archetype: leader.archetype, unit: leader.unit, hexaco: leader.hexaco })),
    });
    for (const leader of actors) {
      broadcast('sim', { type: 'turn_start', leader: leader.name, data: { turn: 1, time: startTime, title: 'Director generating...', crisis: '', births: 0, deaths: 0, metrics: {} } }, leader.name);
    }
    if (scenario?.id === 'atlas-lab' && actors.length === 2) {
      const judged = actors.map((leader, index) => {
        const recorded = atlasPair.find(run => run.leaderName === leader.name);
        if (!recorded) throw new Error(`No recorded Atlas Lab run for ${leader.name}`);
        return { leader, index, result: recorded.artifact };
      });
      const [a, b] = judged;
      await delay(1_500, undefined, { signal }).catch(error => {
        if (!signal?.aborted) throw error;
      });
      if (signal?.aborted) return;
      for (let turn = 1; turn <= turns; turn++) {
        for (const { leader, result } of judged) {
          broadcast('sim', {
            type: 'turn_done', leader: leader.name,
            data: { turn, time: startTime + (turn - 1) * (config.timePerTurn ?? 0), metrics: result.finalState.metrics },
          }, leader.name);
        }
      }
      for (const { leader, result } of judged) {
        broadcast('result', { leader: leader.name, summary: result.finalState.metrics }, leader.name);
      }
      const verdict = VerdictSchema.parse({
        winner: 'B',
        winnerName: b.leader.name,
        headline: 'Priya ships a cleaner model',
        summary: 'The release cleared more of the readiness checks.',
        keyDivergence: 'Priya prioritized alignment checks before release.',
        scores: {
          a: { survival: 6, prosperity: 5, morale: 6, innovation: 6 },
          b: { survival: 7, prosperity: 7, morale: 6, innovation: 6 },
        },
      });
      await judgePair({
        credentials: config, verdictModel: 'stub', turns, scenario, broadcast, a, b,
        generateObjectImpl: (async () => ({
          object: verdict, text: JSON.stringify(verdict), usage: {},
        })) as VerdictCallOptions['generateObjectImpl'],
      });
      broadcast('complete', { timestamp: new Date().toISOString() });
      return;
    }
    // Each leader's colony at the end of turn 1, from the run's own kernel.
    // A snapshot that cannot be built is logged and left out: the run stays
    // open all the same, as every other test of this server needs it to.
    const world = scenario ?? marsScenario;
    const record: RosterRecord = { population: config.initialPopulation, leaders: {} };
    try {
      for (const leader of actors) {
        const kernel = new SimulationKernel(config.seed, leader.name, config.keyPersonnel, {
          startTime: config.startTime,
          initialPopulation: config.initialPopulation,
          scenario: world,
        });
        const turn = advanceKernelTurn(kernel, 1, startTime, world);
        record.leaders[leader.name] = turn.agents.map(agent => String(agent.name));
        broadcast('sim', { type: 'systems_snapshot', leader: leader.name, data: snapshotData(turn) }, leader.name);
      }
      rosters.push(record);
    } catch (err) {
      console.error('[first-screen-server] the turn 1 snapshots were not built:', err);
    }
    await new Promise<void>(resolve => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  },
});
// The credential cleanup spec uses the real chat pool against a fixture provider.
await withProviderWire(async () => {
  server.listen(PORT);
  await once(server, 'close');
}, () => 'The engineering team kept the power on.');
