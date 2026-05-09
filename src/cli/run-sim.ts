/**
 * Implementation of `paracosm run`. Extracted from run.ts so the
 * subcommand router can dispatch to it without process-level side
 * effects firing on import.
 *
 * @module paracosm/cli/run-sim
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSimulation } from '../runtime/orchestrator/index.js';
import { parseCliRunOptions } from './cli-run-options.js';
import { DEFAULT_KEY_PERSONNEL } from './sim-config.js';
import { marsScenario } from '../engine/scenarios/index.js';
import { resolveActors, parseActorsFlag } from './actors-resolver.js';
import type { ActorConfig } from './types.js';

/**
 * Load `.env` from the current working directory (CWD-scoped, not
 * package-relative). Existing process.env values always win.
 */
function loadEnv(): void {
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

function loadActors(argv: readonly string[]): ActorConfig[] {
  const explicitPath = parseActorsFlag(argv);
  try {
    const resolved = resolveActors({ explicitPath });
    if (resolved.isExample) {
      process.stdout.write(`  Using bundled example actors at ${resolved.sourcePath}\n`);
      process.stdout.write('  Create config/actors.json in your project to customize.\n\n');
    } else {
      process.stdout.write(`  Loaded ${resolved.actors.length} actors from ${resolved.sourcePath}\n`);
    }
    return resolved.actors;
  } catch (err) {
    process.stderr.write(`  ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

function parseActorFromArgs(args: readonly string[]): Partial<ActorConfig> {
  const actor: Partial<ActorConfig> & { hexaco?: Partial<ActorConfig['hexaco']> } = {};
  const hexaco: Partial<ActorConfig['hexaco']> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--name' && next) { actor.name = next; i += 1; }
    else if (arg === '--archetype' && next) { actor.archetype = next; i += 1; }
    else if (arg === '--unit' && next) { actor.unit = next; i += 1; }
    else if (arg === '--instructions' && next) { actor.instructions = next; i += 1; }
    else if (arg === '--openness' && next) { hexaco.openness = parseFloat(next); i += 1; }
    else if (arg === '--conscientiousness' && next) { hexaco.conscientiousness = parseFloat(next); i += 1; }
    else if (arg === '--extraversion' && next) { hexaco.extraversion = parseFloat(next); i += 1; }
    else if (arg === '--agreeableness' && next) { hexaco.agreeableness = parseFloat(next); i += 1; }
    else if (arg === '--emotionality' && next) { hexaco.emotionality = parseFloat(next); i += 1; }
    else if (arg === '--honesty' && next) { hexaco.honestyHumility = parseFloat(next); i += 1; }
  }
  if (Object.keys(hexaco).length) actor.hexaco = hexaco as ActorConfig['hexaco'];
  return actor as Partial<ActorConfig>;
}

function getActorIndex(args: readonly string[]): number {
  const idx = args.indexOf('--actor');
  if (idx >= 0 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return 0;
}

/**
 * Run a simulation. Reads actors, applies CLI overrides, calls
 * runSimulation against marsScenario by default. Returns the process
 * exit code so the caller can choose whether to call process.exit().
 */
export async function runSim(argv: readonly string[]): Promise<number> {
  loadEnv();

  const cliOptions = parseCliRunOptions(argv);
  const actorIdx = getActorIndex(argv);
  const cliActor = parseActorFromArgs(argv);

  const actors = loadActors(argv);
  if (!actors.length) {
    process.stderr.write('  No actors defined in actors.json\n');
    return 1;
  }

  const baseActor = actors[actorIdx] || actors[0];
  // Spread + merge hexaco only when both sides supply it; otherwise
  // pass through whichever is defined (or undefined if neither — then
  // traitProfile must be set on baseActor for the runtime to accept).
  const mergedHexaco =
    baseActor.hexaco || cliActor.hexaco
      ? { ...(baseActor.hexaco ?? {}), ...(cliActor.hexaco ?? {}) } as ActorConfig['hexaco']
      : undefined;
  const actor: ActorConfig = {
    ...baseActor,
    ...cliActor,
    ...(mergedHexaco ? { hexaco: mergedHexaco } : {}),
  };

  if (cliActor.name && !cliActor.instructions) {
    actor.instructions = `You are ${actor.name}. ${actor.archetype}. Respond with JSON.`;
  }

  process.stdout.write(`\n  Actor: ${actor.name} (${actor.archetype}): ${actor.unit}\n`);
  if (actor.hexaco) {
    process.stdout.write(`  HEXACO: O=${actor.hexaco.openness} C=${actor.hexaco.conscientiousness} E=${actor.hexaco.extraversion}\n`);
  } else if (actor.traitProfile) {
    process.stdout.write(`  Trait model: ${actor.traitProfile.modelId}\n`);
  }

  try {
    await runSimulation(actor, DEFAULT_KEY_PERSONNEL, {
      seed: 950,
      ...cliOptions,
      scenario: marsScenario,
    });
    return 0;
  } catch (err) {
    process.stderr.write(`Simulation failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    return 1;
  }
}
