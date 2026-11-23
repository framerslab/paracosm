/**
 * Centralized reader/writer for the dashboard's two launch-related
 * storage contracts. Keeping the key strings + payload shape in
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

/** localStorage key holding the last config that succeeded on /setup, without its keys. */
export const LAST_LAUNCH_KEY = 'paracosm:lastLaunchConfig';

/** The /setup fields that carry a visitor's model and search keys. */
const KEY_FIELDS = ['apiKey', 'anthropicKey', 'serperKey', 'firecrawlKey', 'tavilyKey', 'cohereKey'] as const;

/** A launch config without its key fields: keys stay in this tab's storage alone. */
function withoutKeys(config: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...config };
  for (const field of KEY_FIELDS) delete rest[field];
  return rest;
}

/** sessionStorage key holding per-provider API key overrides. */
export const KEY_OVERRIDES_KEY = 'paracosm:keyOverrides';

/** localStorage key holding the actors of the run that the most recent
 *  /setup call kicked off. Read by SimView/ActorBar as a fallback for
 *  the live header when the SSE `status` event with `phase: 'parallel'`
 *  has not landed yet (or arrived in an order that left state.actorIds
 *  populated only with sim-event-keyed entries that don't carry the
 *  full actor metadata). Written by every /setup caller. */
export const ACTIVE_RUN_ACTORS_KEY = 'paracosm:activeRunActors';

/** localStorage key holding the id of the scenario those actors were
 *  launched on, so a form that starts from them can tell its own
 *  scenario's run from another one's. */
export const ACTIVE_RUN_SCENARIO_KEY = 'paracosm:activeRunScenarioId';

/** Minimal storage interface for tests. */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
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
      ? withoutKeys(parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a stored launch config was launched on this scenario. It stays
 * in storage when the person moves to another scenario, and it holds the
 * old one's leaders, start time and population. A config stored before
 * configs named their scenario does not match.
 */
export function isLastLaunchFor(
  config: Record<string, unknown>,
  scenarioId: string,
): boolean {
  return config.scenarioId === scenarioId;
}

/**
 * Write the last-launch config, its key fields left out. Silently
 * swallows storage errors (quota exceeded etc.) — the UI flow
 * shouldn't break on storage failure.
 */
export function writeLastLaunchConfig(
  storage: StorageLike,
  config: Record<string, unknown>,
): void {
  try {
    storage.setItem(LAST_LAUNCH_KEY, JSON.stringify(withoutKeys(config)));
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
  scenarioId?: string,
): void {
  try {
    storage.setItem(ACTIVE_RUN_ACTORS_KEY, JSON.stringify(actors));
    // The id is written or cleared with every roster, so it never names
    // the scenario of an earlier one.
    if (scenarioId) storage.setItem(ACTIVE_RUN_SCENARIO_KEY, scenarioId);
    else storage.removeItem?.(ACTIVE_RUN_SCENARIO_KEY);
  } catch {
    // Best-effort.
  }
}

/** The scenario the stored actors were launched on, or `null` when it
 *  was not recorded. */
/**
 * Keeps the stored leaders and scenario of the run on screen as they are
 * now, and returns a function that puts them back. A launch writes its
 * leaders before it posts the run, so a launch the server refuses calls
 * this function and the stored leaders stay those of a run that exists.
 */
export function keepActiveRunActors(storage: StorageLike): () => void {
  let actors: string | null = null;
  let scenarioId: string | null = null;
  try {
    actors = storage.getItem(ACTIVE_RUN_ACTORS_KEY);
    scenarioId = storage.getItem(ACTIVE_RUN_SCENARIO_KEY);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      if (actors === null) storage.removeItem?.(ACTIVE_RUN_ACTORS_KEY);
      else storage.setItem(ACTIVE_RUN_ACTORS_KEY, actors);
      if (scenarioId === null) storage.removeItem?.(ACTIVE_RUN_SCENARIO_KEY);
      else storage.setItem(ACTIVE_RUN_SCENARIO_KEY, scenarioId);
    } catch {
      // Storage that cannot be written keeps what it holds.
    }
  };
}

export function readActiveRunScenarioId(storage: StorageLike): string | null {
  try {
    return storage.getItem(ACTIVE_RUN_SCENARIO_KEY) || null;
  } catch {
    return null;
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
    const overrides: KeyOverrides = {};
    for (const provider of ['openai', 'anthropic', 'serper', 'firecrawl', 'tavily', 'cohere'] as const) {
      if (typeof parsed[provider] === 'string') overrides[provider] = parsed[provider];
    }
    return overrides;
  } catch {
    return {};
  }
}

/** Rewrites a saved last launch that still holds keys, as earlier releases' Run again saved it. */
function dropKeysFromLastLaunch(storage: StorageLike): void {
  const raw = storage.getItem(LAST_LAUNCH_KEY);
  const saved = readLastLaunchConfig(storage);
  if (raw !== null && saved !== null && raw !== JSON.stringify(saved)) writeLastLaunchConfig(storage, saved);
}

/** Moves the previous persistent overrides into the current tab on dashboard startup. */
export function migrateLegacyKeyOverrides(): void {
  try {
    const legacy = window.localStorage;
    dropKeysFromLastLaunch(legacy);
    if (legacy.getItem(KEY_OVERRIDES_KEY) === null) return;
    try {
      writeTabKeyOverrides({ ...readKeyOverrides(legacy), ...readTabKeyOverrides() });
    } finally {
      legacy.removeItem(KEY_OVERRIDES_KEY);
    }
  } catch {
    // Storage can be disabled by the browser.
  }
}

/** Reads the key overrides available to this tab. */
export function readTabKeyOverrides(): KeyOverrides {
  try {
    return readKeyOverrides(window.sessionStorage);
  } catch {
    return {};
  }
}

/** Saves key fields to this tab, removing the entry when the fields are empty. */
export function writeTabKeyOverrides(overrides: KeyOverrides): void {
  try {
    const storage = window.sessionStorage;
    const filled = Object.fromEntries(Object.entries(overrides).filter(([, key]) => typeof key === 'string' && key !== ''));
    if (Object.keys(filled).length) storage.setItem(KEY_OVERRIDES_KEY, JSON.stringify(filled));
    else storage.removeItem(KEY_OVERRIDES_KEY);
  } catch {
    // The current form still works when the browser disables storage.
  }
}

/** Removes keys from the tab and discards any legacy copy still present. */
export function forgetTabKeyOverrides(): void {
  writeTabKeyOverrides({});
  try {
    window.localStorage.removeItem(KEY_OVERRIDES_KEY);
    dropKeysFromLastLaunch(window.localStorage);
  } catch {
    // The browser may disallow access to legacy storage.
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
