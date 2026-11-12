/**
 * Auto-persistence layer for compile-from-seed scenarios.
 *
 * Quickstart's compile-from-seed flow used to register every successful
 * compile in `customScenarioCatalog` with `source: 'compiled'` — but
 * memory-only. A server restart wiped the catalog and users who had
 * authored a custom scenario lost it. This module saves the
 * post-compile draft (the scenario shape minus the function-typed
 * `hooks` field) to `${scenarioDir}/compiled/{id}.json` after every
 * successful compile, and exposes loaders so the server can lift those
 * drafts back into the catalog at boot. Hook source strings live in
 * the compiler's separate disk cache (`.paracosm/cache/`), so a boot-
 * time `compileScenario(draft, { cache: true })` re-hydrates the full
 * runnable scenario for free when the cache is warm — and at LLM cost
 * (~$0.10/draft) when it's cold (e.g. fresh deploy with no cache
 * volume mounted).
 *
 * @module paracosm/cli/persisted-compiled-scenarios
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { ScenarioPackage } from '../engine/types.js';

/**
 * Subdirectory under `scenarios/` where compile-from-seed scenarios
 * get auto-persisted. Kept separate from `scenarios/` proper so
 * admin-curated drafts (corporate-quarterly.json, frontier-ai-lab.json,
 * etc.) and runtime-compiled drafts stay distinguishable on disk and
 * the catalog UI can label them differently if it wants.
 */
export const COMPILED_SUBDIR = 'compiled';

/**
 * Cap on the number of persisted compiled scenarios at any time. Oldest
 * (by mtime) evict FIFO when a 51st scenario tries to save. 50 is sized
 * for the public-demo use case: enough room for the entire interesting-
 * scenario tail, small enough that disk + boot-time recompile cost
 * stay bounded.
 */
export const COMPILED_SCENARIOS_CAP = 50;

/**
 * Side-channel metadata attached to each persisted draft. Captures when
 * the scenario was compiled and (truncated) what seed text produced it,
 * so a public catalog can render "compiled 3 days ago from a brief
 * about ... " without re-deriving from the scenario body.
 */
export interface PersistedCompiledMeta {
  /** ISO-8601 wall-clock when compile-from-seed succeeded. */
  compiledAt: string;
  /** First 1KB of the original seed prompt. Null when the compile path
   *  didn't carry seed text (e.g. /scenario/store calls). */
  seedText: string | null;
}

/** One entry returned by {@link loadPersistedCompiledDrafts}. */
export interface PersistedCompiledDraft {
  id: string;
  /** Scenario JSON minus the function-typed `hooks` field — runnable
   *  through `compileScenario(draft, { cache: true })`. */
  draft: Record<string, unknown>;
  meta: PersistedCompiledMeta;
}

/** Resolve the `compiled/` subdir path under a scenario root. */
function compiledDir(scenarioDir: string): string {
  return resolve(scenarioDir, COMPILED_SUBDIR);
}

/**
 * Strip the function-typed `hooks` field so the rest of the scenario
 * round-trips through JSON cleanly. `compileScenario` regenerates hooks
 * from cached source strings (free) or via LLM ($0.10) so the
 * persisted JSON only needs to carry the scenario shape — the hook
 * functions themselves are not directly serializable.
 */
function stripHooks(scenario: ScenarioPackage): Record<string, unknown> {
  const obj = scenario as unknown as Record<string, unknown>;
  const { hooks: _hooks, ...rest } = obj;
  return rest;
}

/**
 * The one pattern a scenario id must match to name a file: a letter or
 * digit, then up to 127 letters, digits, hyphens or underscores. An id
 * with a path separator, a dot, a percent sign, a null byte or anything
 * else outside that set never names a file.
 */
export const SCENARIO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

/** {@link SCENARIO_ID_PATTERN} in words, for refusals. */
export const SCENARIO_ID_RULE =
  'a scenario id that names a file is 1 to 128 letters, digits, hyphens or underscores, starting with a letter or digit';

/**
 * Whether a value is a scenario id that may name a file. The persist and
 * delete paths here, the boot loader and the scenario store's disk write
 * all run this gate before touching the file system.
 */
export function isSafeScenarioId(id: unknown): id is string {
  return typeof id === 'string' && SCENARIO_ID_PATTERN.test(id);
}

/**
 * The path of `<id>.json` directly inside `dir`, or `null` when the id
 * fails {@link isSafeScenarioId} or the resolved path is anything other
 * than that one file name inside `dir`.
 */
export function scenarioJsonPath(dir: string, id: unknown): string | null {
  if (!isSafeScenarioId(id)) return null;
  const root = resolve(dir);
  const filePath = resolve(root, `${id}.json`);
  return relative(root, filePath) === `${id}.json` ? filePath : null;
}

/**
 * Result of a successful persist. The on-disk value of `compiledAt`
 * is the canonical source of truth; in-memory callers reflect it back
 * into their own state via this return value rather than re-deriving
 * from `Date.now()` (which would drift between the disk record and
 * the runtime metadata map by however long the writeFileSync took).
 */
export interface PersistResult {
  filePath: string;
  meta: PersistedCompiledMeta;
}

/**
 * Save a compile-from-seed scenario to disk. Caller passes the fully-
 * compiled scenario; we persist a hook-stripped copy plus metadata.
 * Idempotent on the same id (overwrites the previous file).
 *
 * @returns A {@link PersistResult} carrying the path written + the
 *   exact meta block stored on disk so callers can mirror it into
 *   their own state, or `null` on validation/filesystem failure (we
 *   swallow the error, log via console.warn, and let the in-memory
 *   catalog continue to serve the live run; persistence is a best-
 *   effort enhancement, not a critical path).
 */
export function persistCompiledScenario(
  scenarioDir: string,
  scenario: ScenarioPackage,
  seedText: string | null,
): PersistResult | null {
  if (!isSafeScenarioId(scenario.id)) {
    console.warn(`[scenarios] refusing to persist scenario with unsafe id: ${JSON.stringify(scenario.id)}`);
    return null;
  }
  try {
    const dir = compiledDir(scenarioDir);
    mkdirSync(dir, { recursive: true });
    const meta: PersistedCompiledMeta = {
      compiledAt: new Date().toISOString(),
      seedText: seedText && seedText.length > 0 ? seedText.slice(0, 1000) : null,
    };
    const payload = {
      ...stripHooks(scenario),
      _persistMeta: meta,
    };
    const filePath = resolve(dir, `${scenario.id}.json`);
    writeFileSync(filePath, JSON.stringify(payload, null, 2));
    enforceCompiledCap(dir, COMPILED_SCENARIOS_CAP);
    return { filePath, meta };
  } catch (err) {
    console.warn(`[scenarios] persistCompiledScenario failed for ${scenario.id}:`, err);
    return null;
  }
}

/**
 * Read the compiled-draft JSON files in the persistence dir, newest
 * first by mtime, and return at most `cap` of them
 * ({@link COMPILED_SCENARIOS_CAP} by default, the number
 * {@link persistCompiledScenario} keeps), since the server compiles
 * every draft returned. Once `cap` drafts are read the rest are left
 * unread, in one log line. Malformed files and files whose id fails
 * {@link isSafeScenarioId} are skipped with a line naming the file;
 * one bad entry never blocks the rest of the catalog from loading.
 */
export function loadPersistedCompiledDrafts(
  scenarioDir: string,
  cap: number = COMPILED_SCENARIOS_CAP,
): PersistedCompiledDraft[] {
  const dir = compiledDir(scenarioDir);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const filePath = resolve(dir, entry.name);
      let mtimeMs = 0;
      try { mtimeMs = statSync(filePath).mtimeMs; } catch { /* sorts last; the read below reports it */ }
      return { name: entry.name, filePath, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const out: PersistedCompiledDraft[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const { name, filePath, mtimeMs } = files[index];
    if (out.length >= cap) {
      console.warn(
        `[scenarios] stopped loading persisted compiled drafts at the cap of ${cap}; ` +
        `${files.length - index} older draft file(s) left unread`,
      );
      break;
    }
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      const id: unknown = raw.id;
      if (id === undefined || id === null || id === '') continue;
      if (!isSafeScenarioId(id)) {
        console.warn(`[scenarios] skipping persisted draft ${JSON.stringify(name)}: its id is not a plain scenario id`);
        continue;
      }
      const persistMeta = (raw._persistMeta ?? {}) as Partial<PersistedCompiledMeta>;
      // Fall back to file mtime when the on-disk metadata predates the
      // _persistMeta field (e.g. user manually dropped a JSON in this
      // dir without going through persistCompiledScenario).
      const fallbackCompiledAt = new Date(mtimeMs).toISOString();
      const meta: PersistedCompiledMeta = {
        compiledAt: typeof persistMeta.compiledAt === 'string' ? persistMeta.compiledAt : fallbackCompiledAt,
        seedText: typeof persistMeta.seedText === 'string' ? persistMeta.seedText : null,
      };
      // Strip the side-channel field so the draft passed to
      // compileScenario matches the schema it expects.
      const { _persistMeta: _meta, ...draft } = raw;
      out.push({ id, draft, meta });
    } catch (err) {
      console.warn(`[scenarios] skipping unreadable draft ${name}:`, err);
    }
  }
  return out;
}

/**
 * FIFO eviction once the cap is exceeded. Oldest by mtime drops first.
 * Idempotent and safe to call after every persist — at-cap state is the
 * common case so the function returns quickly when nothing needs
 * eviction.
 */
function enforceCompiledCap(dir: string, cap: number): void {
  if (!existsSync(dir)) return;
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => {
      const filePath = resolve(dir, e.name);
      return { filePath, mtime: statSync(filePath).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
  while (files.length > cap) {
    const drop = files.shift();
    if (!drop) break;
    try {
      unlinkSync(drop.filePath);
    } catch (err) {
      console.warn(`[scenarios] eviction failed for ${drop.filePath}:`, err);
    }
  }
}

/**
 * Remove a persisted draft by id. Returns true when a file was actually
 * deleted, false when no matching file existed or the id failed
 * validation (idempotent for callers that don't pre-check). Used by
 * the future `/scenario/delete` admin surface and by tests; production
 * server-app does not call this on the active path.
 *
 * Path-traversal guard: rejects any id that doesn't match the strict
 * kebab-slug shape AND verifies the resolved file path stays inside
 * the compiled subdir before unlinking. Belt-and-suspenders against
 * future callers that might wire user input through this surface.
 */
export function deletePersistedCompiledScenario(scenarioDir: string, id: string): boolean {
  if (!isSafeScenarioId(id)) return false;
  const dir = compiledDir(scenarioDir);
  const filePath = resolve(dir, `${id}.json`);
  // Resolve-then-prefix-check defends against any future relaxation
  // of isSafeScenarioId. If the resolved file isn't inside dir, the
  // id was crafted to escape — refuse to delete.
  if (filePath !== resolve(dir, `${id}.json`) || !filePath.startsWith(`${dir}${sep}`)) {
    return false;
  }
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch (err) {
    console.warn(`[scenarios] deletePersistedCompiledScenario failed for ${id}:`, err);
    return false;
  }
}
