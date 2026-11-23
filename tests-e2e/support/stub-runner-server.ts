/**
 * The dashboard server with a scripted runner, on a port of its own, so
 * several browsers can each start a real run through the real /setup.
 *
 * The server code is the real one, over HTTP and SSE, with the scenario JSON
 * read from scenarios/. Only the runner, which would call a model on every
 * turn, is scripted: two turns per leader, a few seconds apart, one person's
 * reaction under each leader, then a result per leader and the run's end. It stops as the orchestrator does when its
 * run's signal fires. PARACOSM_MAX_RUNS sets the server's run cap.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';
import type { NormalizedSimulationConfig } from '../../src/cli/sim-config.js';
import type { BroadcastFn } from '../../src/cli/pair-runner.js';

const STEP_MS = Number(process.env.STUB_STEP_MS ?? 1500);
const TURNS = 2;

/** Resolves after `ms`, or as soon as the signal fires; true when it fired. */
function step(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
}

async function scriptedRun(config: NormalizedSimulationConfig, broadcast: BroadcastFn, signal?: AbortSignal): Promise<void> {
  const leaders = config.actors;
  broadcast('status', { phase: 'starting', maxTurns: TURNS });
  broadcast('status', {
    phase: 'parallel',
    maxTurns: TURNS,
    actors: leaders.map(l => ({ name: l.name, archetype: l.archetype, unit: l.unit, hexaco: l.hexaco })),
  });
  for (let turn = 1; turn <= TURNS; turn++) {
    for (const l of leaders) {
      broadcast('sim', { type: 'turn_start', leader: l.name, data: { turn, time: turn, title: `${l.name}: turn ${turn}` } }, l.name);
    }
    if (await step(STEP_MS, signal)) {
      broadcast('sim', { type: 'sim_aborted', leader: '', data: { reason: signal?.reason, turn, completedTurns: turn - 1 } });
      broadcast('complete', { timestamp: new Date().toISOString(), aborted: true });
      return;
    }
    for (const l of leaders) {
      broadcast('sim', { type: 'turn_done', leader: l.name, data: { turn, time: turn, metrics: { population: 100, morale: 0.7 } } }, l.name);
      // One person who lives under each leader, for the Chat tab.
      if (turn === 1) {
        broadcast('sim', {
          type: 'agent_reactions',
          leader: l.name,
          data: { turn, time: turn, reactions: [{ agentId: 'col-lena-ortiz', name: 'Lena Ortiz', role: 'Botanist', department: 'agriculture', age: 34, mood: 'hopeful', quote: 'We kept the greenhouse running.' }] },
        }, l.name);
      }
    }
  }
  for (const l of leaders) {
    broadcast('result', { leader: l.name, summary: { population: 100, morale: 0.7, toolsForged: 0, citations: 0 } }, l.name);
  }
  broadcast('complete', { timestamp: new Date().toISOString() });
}

const server = createMarsServer({
  env: {
    ...process.env,
    APP_DIR: mkdtempSync(join(tmpdir(), 'paracosm-e2e-stub-runner-')),
    PARACOSM_HOSTED_DEMO: '',
    PARACOSM_DISABLE_RUN_HISTORY: '1',
  },
  maxSimsPerDay: 0,
  runHistoryStore: createNoopRunHistoryStore(),
  runPairSimulations: (config, broadcast, signal) => scriptedRun(config, broadcast, signal),
  runForkSimulation: async (config, broadcast, signal) => scriptedRun(config, broadcast, signal),
});
server.listen(Number(process.env.PORT ?? 3459));
