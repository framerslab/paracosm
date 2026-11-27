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
import { createReadStream, existsSync, mkdtempSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { createMarsServer } from '../../src/server/server-app.js';
import { createNoopRunHistoryStore } from '../../src/server/stores/run-history.js';

import type { CreateMarsServerOptions } from '../../src/server/server-app.js';
import { watchPairFrames, watchPairResult, watchPairVerdict } from './watch-pair-frames.js';

const port = Number(process.env.PORT ?? 3458);
const scripted = process.env.WATCH_PAIR === '1';
const hosted = process.env.WATCH_HOSTED === '1';
const baseDist = process.env.WATCH_BASE_DIST ? resolve(process.env.WATCH_BASE_DIST) : undefined;
type Runner = NonNullable<CreateMarsServerOptions['runPairSimulations']>;
interface ScriptedRun {
  names: string[];
  broadcast: Parameters<Runner>[1];
  finish?: () => void;
}
let live: ScriptedRun | undefined;

const server = createMarsServer({
  env: {
    ...process.env,
    APP_DIR: mkdtempSync(join(tmpdir(), 'paracosm-e2e-pair-run-')),
    PARACOSM_HOSTED_DEMO: hosted ? 'true' : '',
    ...(scripted ? { OPENAI_API_KEY: 'sk-watch-fixture', PARACOSM_CLIENT_IP_HEADER: 'x-real-ip' } : {}),
  },
  maxSimsPerDay: hosted ? 1 : 0,
  ...(scripted ? { siteAnalyticsIds: { ga: '', clarity: '' } } : {}),
  runHistoryStore: createNoopRunHistoryStore(),
  getDigitalTwinWorld: async () => null,
  runPairSimulations: async (config, broadcast, signal) => {
    const { actors, turns, startTime, customEvents } = config;
    broadcast('status', { phase: 'starting', maxTurns: turns, customEvents });
    broadcast('status', {
      phase: 'parallel',
      actors: actors.map(leader => ({ name: leader.name, archetype: leader.archetype, unit: leader.unit, hexaco: leader.hexaco })),
    });
    const run: ScriptedRun = { names: actors.map(leader => leader.name), broadcast };
    if (scripted) live = run;
    for (const leader of scripted ? [] : actors) {
      broadcast('sim', { type: 'turn_start', leader: leader.name, data: { turn: 1, time: startTime, title: 'Director generating...', crisis: '', births: 0, deaths: 0, metrics: {} } }, leader.name);
    }
    await new Promise<void>(resolve => {
      if (signal?.aborted) return resolve();
      const finish = () => {
        signal?.removeEventListener('abort', finish);
        resolve();
      };
      run.finish = finish;
      signal?.addEventListener('abort', finish, { once: true });
    });
    if (live === run) live = undefined;
  },
});

if (scripted) {
  const [dashboard] = server.listeners('request');
  server.removeListener('request', dashboard);
  server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/__watch_frames') {
      try {
        const run = live;
        const owner = await fetch(`http://127.0.0.1:${port}/results`, {
          headers: { 'x-real-ip': String(req.headers['x-real-ip'] ?? ''), cookie: req.headers.cookie ?? '' },
        });
        const { runKey } = await owner.json() as { runKey: string | null };
        const phase = url.searchParams.get('phase');
        const turn = Number(url.searchParams.get('turn'));
        if (!run || live !== run || !runKey || runKey !== url.searchParams.get('runKey') ||
            !Number.isInteger(turn) || turn < 1 || turn > 100) {
          res.writeHead(409).end();
          return;
        }
        if (phase === 'crisis' || phase === 'departments' || phase === 'decisions') {
          for (const event of watchPairFrames(run.names, phase, turn)) {
            run.broadcast('sim', event, event.leader);
          }
        } else if (phase === 'result-first' || phase === 'result-second') {
          const leader = run.names[phase === 'result-first' ? 0 : 1];
          run.broadcast('result', watchPairResult(leader), leader);
        } else if (phase === 'verdict') {
          run.broadcast('verdict', watchPairVerdict(run.names));
          run.broadcast('complete', { timestamp: '2026-11-27T17:00:00.000Z' });
          run.finish?.();
        } else {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(204).end();
      } catch {
        res.writeHead(500).end();
      }
      return;
    }
    if (baseDist && req.method === 'GET') {
      const name = url.pathname === '/sim' ? 'index.html' : url.pathname === '/' ? 'landing.html' : url.pathname.slice(1);
      const path = resolve(baseDist, name);
      const contentType: Record<string, string> = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
      };
      const mime = contentType[extname(name)];
      if (mime && path.startsWith(baseDist + sep) && existsSync(path)) {
        res.writeHead(200, { 'Content-Type': mime });
        createReadStream(path).pipe(res);
        return;
      }
    }
    dashboard.call(server, req, res);
  });
  server.listen(port, '127.0.0.1');
} else {
  server.listen(port);
}
