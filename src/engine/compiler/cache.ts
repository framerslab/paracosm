/**
 * Disk cache for generated scenario hooks.
 * Stores generated hook source alongside a manifest tracking
 * the scenario hash, model used, and generation timestamp.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface CacheManifest {
  scenarioHash: string;
  model: string;
  timestamp: string;
  hooks: Record<string, string>;
}

const DEFAULT_CACHE_DIR = '.paracosm/cache';

/**
 * Bump this to invalidate all cached hook sources globally after a
 * prompt-format change. The hash folded into {@link hashScenario} so
 * a bump forces every scenario to recompile its hooks on next use.
 *
 * Version history:
 * - v1: initial format
 * - v2 (2026-04-18): milestones prompt switched from [founding, legacy]
 *   array shape to { founding, legacy } object shape for OpenAI
 *   response_format:json_object compatibility.
 * - v3 (2026-04-21): state access path renamed from ctx.state.colony
 *   to ctx.state.metrics as part of the 0.5.0 domain-agnostic schema
 *   rename. Every cached progression / reactions / politics hook from
 *   v2 references the old path and must regenerate.
 * - v4 (2026-04-23): F23 time-units rename. Progression/reactions/
 *   fingerprint hook contexts swap `year`/`yearDelta`/`startYear`/
 *   `currentYear` for `time`/`timeDelta`/`startTime`/`currentTime`;
 *   agent core swaps `birthYear`/`deathYear` for `birthTime`/
 *   `deathTime`. Every cached hook references the old names and must
 *   regenerate (one-time ~$0.10 per previously-compiled scenario).
 * - v5 (2026-04-23): Compiler prompt hardening. Every generator's
 *   system prompt now declares the flat state shape with exact
 *   scenario-declared key lists; smokeTest fixtures derived from the
 *   scenario's own world.* bags instead of hardcoded Mars defaults.
 *   Pre-v5 cached hooks were generated under looser prompts and may
 *   reference nested state paths (e.g. state.metrics.hull.integrity)
 *   that throw at runtime. Regenerate to pick up the tightened
 *   contract (one-time ~$0.10 per previously-compiled scenario).
 * - v6 (2026-05-04): RunArtifactSchema gained an optional `finalSwarm`
 *   field carrying the terminal swarm snapshot (population/turn/time
 *   plus the agent roster). Cached hooks don't depend on the field,
 *   but consumers parsing artifacts under the old schema now reject
 *   any artifact that includes finalSwarm because of strict-mode
 *   parsing. Bump forces clients to regenerate so artifact parsers
 *   pick up the optional-field tolerance.
 * - v7 (2026-11-03): progression hook contexts gained `yearsDelta`,
 *   `yearsSinceStart` and `yearsPerUnit`; `timeDelta` is in the
 *   scenario's unit, not years. A hook generated under the earlier
 *   prompt applied a year's effects each unit of a month or week
 *   scenario, so every cached hook regenerates (one-time ~$0.10 per
 *   previously-compiled scenario).
 * - v8 (2026-11-03): a turn runs the progression hook once for each year
 *   it spans, with `timeDelta` and `yearsDelta` that step's length. A hook
 *   generated under the earlier prompt and leaving an effect unscaled
 *   would apply it once a year of a long turn, so every cached hook
 *   regenerates (one-time ~$0.10 per previously-compiled scenario).
 */
export const COMPILE_SCHEMA_VERSION = 8;

/** SHA-256 hash of the scenario JSON, used for cache invalidation. */
export function hashScenario(scenarioJson: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(scenarioJson, null, 0))
    .update(`|v${COMPILE_SCHEMA_VERSION}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * A cache folder name that is one plain file name: a letter or digit, then
 * up to 159 letters, digits, dots, hyphens, underscores or plus signs.
 */
const PLAIN_CACHE_FOLDER = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/;

/**
 * The cache folder of a scenario + version: one folder directly inside
 * `baseDir`. The scenario JSON's id and version come from whoever asked
 * for the compile, so they name the folder only when `<id>-v<version>` is
 * a plain file name, as every built-in and compiled scenario's is (so a
 * warm cache stays warm). Any other id or version, one with a path
 * separator, a `..` segment or a null byte, names it by its letters,
 * digits, hyphens and underscores and a hash of the whole name, still one
 * folder inside `baseDir`.
 */
function cacheDir(scenarioId: unknown, version: unknown, baseDir: string): string {
  const name = `${String(scenarioId)}-v${String(version)}`;
  if (PLAIN_CACHE_FOLDER.test(name)) return join(baseDir, name);
  const readable = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 16);
  return join(baseDir, `${readable}-${digest}`);
}

/** Read a cached hook result. Returns null on cache miss. */
export function readCache(
  scenarioJson: Record<string, unknown>,
  hookName: string,
  model: string,
  baseDir = DEFAULT_CACHE_DIR,
): string | null {
  const id = (scenarioJson as any).id ?? 'unknown';
  const ver = (scenarioJson as any).version ?? '0.0.0';
  const dir = cacheDir(id, ver, baseDir);
  const manifestPath = join(dir, 'manifest.json');

  if (!existsSync(manifestPath)) return null;

  try {
    const manifest: CacheManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const currentHash = hashScenario(scenarioJson);
    if (manifest.scenarioHash !== currentHash) return null;
    if (manifest.model !== model) return null;
    const hookFile = manifest.hooks[hookName];
    if (!hookFile) return null;
    const hookPath = join(dir, hookFile);
    if (!existsSync(hookPath)) return null;
    return readFileSync(hookPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read a cached seed-ingestion bundle. Cache key includes the seed source
 * (text or URL) and the maxSearches cap so different seeds don't collide.
 * Returns null on miss or if the seed signature differs.
 */
export function readSeedBundleCache(
  scenarioJson: Record<string, unknown>,
  seedSignature: string,
  baseDir = DEFAULT_CACHE_DIR,
): unknown | null {
  const id = (scenarioJson as any).id ?? 'unknown';
  const ver = (scenarioJson as any).version ?? '0.0.0';
  const dir = cacheDir(id, ver, baseDir);
  const path = join(dir, `seed-bundle-${seedSignature}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Write a seed-ingestion bundle to disk cache, keyed by seed signature. */
export function writeSeedBundleCache(
  scenarioJson: Record<string, unknown>,
  seedSignature: string,
  bundle: unknown,
  baseDir = DEFAULT_CACHE_DIR,
): void {
  const id = (scenarioJson as any).id ?? 'unknown';
  const ver = (scenarioJson as any).version ?? '0.0.0';
  const dir = cacheDir(id, ver, baseDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `seed-bundle-${seedSignature}.json`),
    JSON.stringify(bundle, null, 2),
    'utf-8',
  );
}

/**
 * Compute a stable signature for a seed config. Same seed text/URL +
 * search settings → same signature. Used as the cache key so we never
 * re-ingest a previously-fetched bundle.
 */
export function seedSignature(opts: { seedText?: string; seedUrl?: string; webSearch?: boolean; maxSearches?: number }): string {
  const payload = JSON.stringify({
    text: opts.seedText ?? '',
    url: opts.seedUrl ?? '',
    web: opts.webSearch ?? true,
    n: opts.maxSearches ?? 5,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/** Write a hook result to disk cache. */
export function writeCache(
  scenarioJson: Record<string, unknown>,
  hookName: string,
  content: string,
  model: string,
  baseDir = DEFAULT_CACHE_DIR,
): void {
  const id = (scenarioJson as any).id ?? 'unknown';
  const ver = (scenarioJson as any).version ?? '0.0.0';
  const dir = cacheDir(id, ver, baseDir);
  mkdirSync(dir, { recursive: true });

  const manifestPath = join(dir, 'manifest.json');
  let manifest: CacheManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    manifest = {
      scenarioHash: hashScenario(scenarioJson),
      model,
      timestamp: new Date().toISOString(),
      hooks: {},
    };
  }

  const fileName = `${hookName}.ts`;
  writeFileSync(join(dir, fileName), content, 'utf-8');
  manifest.hooks[hookName] = fileName;
  manifest.scenarioHash = hashScenario(scenarioJson);
  manifest.model = model;
  manifest.timestamp = new Date().toISOString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
