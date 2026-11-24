/**
 * Resolve the active `actors.json` for a paracosm CLI invocation.
 *
 * Search order (first match wins):
 *   1. --actors <path> CLI flag (explicit path)
 *   2. $CWD/actors.json          (user's project root)
 *   3. $CWD/config/actors.json   (user's config dir)
 *   4. <package>/config/actors.json        (paracosm-shipped fallback)
 *   5. <package>/config/actors.example.json (last-resort default)
 *
 * Covers three consumer shapes:
 *   - Repo clone: users edit config/actors.json at the repo root.
 *   - npm install: users drop actors.json (or config/actors.json)
 *     into their project CWD.
 *   - npx one-off: falls back to the bundled example so `npx
 *     paracosm` Just Works even before the user writes any config.
 *
 * @module paracosm/cli/actors-resolver
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ActorInput } from '../engine/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ResolvedActors {
  actors: ActorInput[];
  /** Absolute path of the file the actors were read from. Surfaces
   *  in CLI output so users know which file is actually in use. */
  sourcePath: string;
  /** Marker for whether the source was the shipped example (we
   *  want to print a hint nudging users to create their own). */
  isExample: boolean;
}

/**
 * Walks the candidate paths and loads the first `actors.json` that
 * exists. Throws only when nothing (not even the bundled example)
 * is available — which would indicate a broken install.
 */
export function resolveActors(options: { explicitPath?: string } = {}): ResolvedActors {
  const cwd = process.cwd();
  const packageRoot = resolve(__dirname, '..', '..');
  const candidates: Array<{ path: string; isExample: boolean }> = [];

  if (options.explicitPath) {
    candidates.push({ path: resolve(cwd, options.explicitPath), isExample: false });
  }
  candidates.push({ path: resolve(cwd, 'actors.json'), isExample: false });
  candidates.push({ path: resolve(cwd, 'config', 'actors.json'), isExample: false });
  candidates.push({ path: resolve(packageRoot, 'config', 'actors.json'), isExample: false });
  candidates.push({ path: resolve(packageRoot, 'config', 'actors.example.json'), isExample: true });

  for (const { path, isExample } of candidates) {
    if (!existsSync(path)) continue;
    let raw: { actors?: ActorInput[] };
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8')) as { actors?: ActorInput[] };
    } catch (err) {
      // Surface the offending file path so users don't have to hunt
      // through the candidate list to figure out which JSON broke.
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`paracosm: failed to parse actors JSON at ${path}: ${message}`);
    }
    const actors = Array.isArray(raw.actors) ? raw.actors : [];
    return { actors, sourcePath: path, isExample };
  }

  throw new Error(
    `paracosm: no actors.json found. Create one at ${resolve(cwd, 'config', 'actors.json')} ` +
    `or pass --actors <path>. A starter template lives at ${resolve(packageRoot, 'config', 'actors.example.json')}.`,
  );
}

/**
 * Pulls `--actors <path>` out of argv WITHOUT mutating the array.
 * Returns undefined when the flag isn't present. Kept separate from
 * the main CLI parser so run.ts / serve.ts can resolve actors the
 * same way without duplicating flag logic.
 */
export function parseActorsFlag(args: readonly string[]): string | undefined {
  const idx = args.indexOf('--actors');
  if (idx < 0) return undefined;
  const next = args[idx + 1];
  if (!next || next.startsWith('--')) return undefined;
  return next;
}
