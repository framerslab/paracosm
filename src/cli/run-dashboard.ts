/**
 * Implementation of `paracosm dashboard`. Extracted from serve.ts so
 * the subcommand router can dispatch to it without process-level side
 * effects firing on import.
 *
 * @module paracosm/cli/run-dashboard
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMarsServer } from '../server/server-app.js';
import { normalizeSimulationConfig } from './sim-config.js';
import { parseCliRunOptions } from './cli-run-options.js';
import { resolveActors, parseActorsFlag } from './actors-resolver.js';
import type { ActorConfig } from './types.js';

function loadEnvFromCwd(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  let loaded = 0;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
      loaded += 1;
    }
  }
  if (loaded > 0) {
    process.stdout.write(`  [env] loaded ${loaded} var${loaded === 1 ? '' : 's'} from ${envPath}\n`);
  }
}

/**
 * Boot the SSE dashboard. Resolves to 0 once the server is listening
 * (or once the auto-launched simulation completes when the maxTurns
 * CLI option was supplied). Resolves to 1 if leader resolution fails
 * during the auto-launch path. The TCP listener holds the Node event
 * loop alive after a 0 resolution, so the process keeps serving
 * requests until killed.
 *
 * Callers MUST treat exit code 0 as "server is up, do not call
 * process.exit". The umbrella binary at run.ts and the back-compat
 * shim at serve.ts both honor that contract.
 */
export async function runDashboard(argv: readonly string[]): Promise<number> {
  loadEnvFromCwd();

  const PORT = parseInt(process.env.PORT || '3456', 10);
  const server = createMarsServer({ env: process.env });
  const cliOptions = parseCliRunOptions(argv);

  await new Promise<void>((resolveServer) => {
    server.listen(PORT, () => {
      process.stdout.write(`\n  Paracosm dashboard: http://localhost:${PORT}\n`);
      process.stdout.write(`  Settings route:     http://localhost:${PORT}/sim?tab=settings\n`);
      process.stdout.write(`  SSE endpoint:       http://localhost:${PORT}/events\n\n`);
      resolveServer();
    });
  });

  if (!cliOptions.maxTurns) {
    process.stdout.write('  Waiting for setup at /sim?tab=settings or /setup. No simulation started yet.\n');
    return 0;
  }

  const explicitPath = parseActorsFlag(argv);
  let actors: ActorConfig[];
  try {
    const resolved = resolveActors({ explicitPath });
    actors = resolved.actors;
    if (resolved.isExample) {
      process.stdout.write(`  Using bundled example actors at ${resolved.sourcePath}\n`);
      process.stdout.write('  Create config/actors.json in your project to customize.\n');
    } else {
      process.stdout.write(`  Loaded ${actors.length} actors from ${resolved.sourcePath}\n`);
    }
  } catch (err) {
    process.stderr.write(`  ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const simConfig = normalizeSimulationConfig({
    actors,
    turns: cliOptions.maxTurns,
    seed: cliOptions.seed,
    startTime: cliOptions.startTime,
    liveSearch: cliOptions.liveSearch,
    provider: cliOptions.provider,
    models: cliOptions.models,
  });

  await server.startWithConfig(simConfig);
  process.stdout.write(`\n  Simulations complete. Dashboard at http://localhost:${PORT}\n`);
  process.stdout.write(`  Run again at http://localhost:${PORT}/sim?tab=settings\n\n`);
  return 0;
}
