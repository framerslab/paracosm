/**
 * Centralized reader/writer for the dashboard's two launch-related
 * localStorage contracts. Keeping the key strings + payload shape in
 * one file prevents the kind of drift audit F22 flagged (multiple
 * call sites hand-rolling the same parse with subtly different
 * error handling).
 *
 * Used by: SettingsPanel.launch (writes after successful /setup),
 * RerunPanel (reads on click), ChatPanel (reads keyOverrides for
 * chat requests).
 *
 * @module paracosm/cli/dashboard/hooks/useLastLaunchConfig
 */

/** localStorage key holding the last config that succeeded on /setup. */
export const LAST_LAUNCH_KEY = 'paracosm:lastLaunchConfig';

/** localStorage key holding per-provider API key overrides. */
export const KEY_OVERRIDES_KEY = 'paracosm:keyOverrides';

/** localStorage key holding the actors of the run that the most recent
 *  /setup call kicked off. Read by SimView/ActorBar as a fallback for
 *  the live header when the SSE `status` event with `phase: 'parallel'`
 *  has not landed yet (or arrived in an order that left state.actorIds
 *  populated only with sim-event-keyed entries that don't carry the
 *  full actor metadata). Written by every /setup caller. */
export const ACTIVE_RUN_ACTORS_KEY = 'paracosm:activeRunActors';

/** Minimal storage interface for tests. */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Provider-keyed API key overrides. All fields optional; presence of
 * a key means the user pasted one for that provider in Settings.
 */
export interface KeyOverrides {
  openai?: string;
  anthropic?: string;
  serper?: string;
  firecrawl?: string;
  tavily?: string;
  cohere?: string;
}

/** Default seed used when the stored config lacks a numeric `seed`. */
const DEFAULT_SEED = 950;

/**
 * Read the last-launch config. Returns `null` for missing / malformed
 * payloads so callers can branch without a try/catch.
 */
export function readLastLaunchConfig(
  storage: StorageLike,
): Record<string, unknown> | null {
  try {
    const raw = storage.getItem(LAST_LAUNCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Write the last-launch config. Silently swallows storage errors
 * (quota exceeded etc.) — the UI flow shouldn't break on storage
 * failure.
 */
export function writeLastLaunchConfig(
  storage: StorageLike,
  config: Record<string, unknown>,
): void {
  try {
    storage.setItem(LAST_LAUNCH_KEY, JSON.stringify(config));
  } catch {
    // Best-effort.
  }
}

/**
 * Minimal per-actor shape persisted at /setup time so the live SIM
 * header can render the right names during the SSE connect-and-replay
 * window. Trimmed deliberately: name, archetype, unit, and hexaco are
 * the four fields ActorBar reads — instructions and per-tier model
 * picks belong on RerunPanel's heavier `lastLaunchConfig` payload, not
 * this transient header-fallback contract.
 *
 * `hexaco` is typed as a record of numeric keys rather than the
 * engine's `HexacoProfile` so callers (Quickstart's actor-generation
 * path, Settings' form, RerunPanel's rerun-config) can write whatever
 * shape they have without a structural cast — the consumer (SimView)
 * just spreads it into ActorBar's display, and ActorBar's renderer
 * already gates on `Object.values(h).some(v => v > 0)`.
 */
export interface PersistedActor {
  name?: string;
  archetype?: string;
  unit?: string;
  hexaco?: Record<string, number> | unknown;
}

/**
 * Write the actors of the just-launched run to localStorage.
 *
 * Accepts a structurally-loose `unknown[]` rather than `PersistedActor[]`
 * because callers pass the engine's `ActorConfig[]` directly (with the
 * full `HexacoProfile`-typed hexaco) and a structural intersection
 * would force every call site through an explicit cast. The reader
 * (`readActiveRunActors`) re-validates so unsafe shapes fail closed.
 */
export function writeActiveRunActors(
  storage: StorageLike,
  actors: ReadonlyArray<unknown>,
): void {
  try {
    storage.setItem(ACTIVE_RUN_ACTORS_KEY, JSON.stringify(actors));
  } catch {
    // Best-effort.
  }
}

/**
 * Read the actors of the most recently launched run, or `null` when
 * the slot is empty / malformed. SimView uses this so the live header
 * carries names during the SSE-connect window for compiled scenarios
 * (which ship no preset leaders).
 */
export function readActiveRunActors(
  storage: StorageLike,
): PersistedActor[] | null {
  try {
    const raw = storage.getItem(ACTIVE_RUN_ACTORS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (a): a is PersistedActor => !!a && typeof a === 'object' && !Array.isArray(a),
    );
  } catch {
    return null;
  }
}

/**
 * Read provider-key overrides. Returns `{}` for missing / malformed
 * payloads so consumers can spread directly into request bodies.
 */
export function readKeyOverrides(storage: StorageLike): KeyOverrides {
  try {
    const raw = storage.getItem(KEY_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as KeyOverrides;
  } catch {
    return {};
  }
}

/**
 * Build the next-run config by bumping the seed + threading key
 * overrides through to their API field names. Pure function — does
 * not touch storage.
 *
 * Each override key maps to a specific request field name:
 * - `openai` → `apiKey` (historical naming — OpenAI is the default
 *   provider so the generic name stuck)
 * - `anthropic` → `anthropicKey`
 * - `serper` → `serperKey`
 * - `firecrawl` → `firecrawlKey`
 * - `tavily` → `tavilyKey`
 * - `cohere` → `cohereKey`
 *
 * Missing override keys are NOT added to the output (vs always
 * present with `undefined`), so the fetch body stays clean.
 */
export function buildNextRunConfig(
  prev: Record<string, unknown>,
  overrides: KeyOverrides,
): Record<string, unknown> {
  const nextSeed =
    (typeof prev.seed === 'number' ? prev.seed : DEFAULT_SEED) + 1;
  const next: Record<string, unknown> = { ...prev, seed: nextSeed };
  if (overrides.openai) next.apiKey = overrides.openai;
  if (overrides.anthropic) next.anthropicKey = overrides.anthropic;
  if (overrides.serper) next.serperKey = overrides.serper;
  if (overrides.firecrawl) next.firecrawlKey = overrides.firecrawl;
  if (overrides.tavily) next.tavilyKey = overrides.tavily;
  if (overrides.cohere) next.cohereKey = overrides.cohere;
  return next;
}
