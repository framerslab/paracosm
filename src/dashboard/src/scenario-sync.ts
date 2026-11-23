const SCENARIO_UPDATED_EVENT = 'paracosm:scenario-updated';

export function emitScenarioUpdated(target: EventTarget): void {
  target.dispatchEvent(new Event(SCENARIO_UPDATED_EVENT));
}

export function subscribeScenarioUpdates(target: EventTarget, callback: () => void): () => void {
  const handler = () => callback();
  target.addEventListener(SCENARIO_UPDATED_EVENT, handler);
  return () => target.removeEventListener(SCENARIO_UPDATED_EVENT, handler);
}

const LAUNCHED_EVENT = 'paracosm:launched';

/**
 * Tells the page's event stream that a run started for `visitorId`, the
 * visitor the server answered the launch with (`/setup` and
 * simulate-intervention answer it). Two tabs opened at once are each given a
 * visitor id by their own load of the dashboard and the browser keeps the
 * second, so the first tab's stream can belong to an id its launches no
 * longer carry; the stream reopens when the ids differ. Anything but a
 * non-empty string is ignored.
 */
export function emitLaunched(target: EventTarget, visitorId: unknown): void {
  if (typeof visitorId !== 'string' || visitorId.length === 0) return;
  target.dispatchEvent(new CustomEvent(LAUNCHED_EVENT, { detail: { visitorId } }));
}

/**
 * Calls `callback` with the visitor id of each launch {@link emitLaunched}
 * reports on `target` (the page's `window`); a launch event that names no
 * string id is skipped. Returns the function that removes the listener,
 * which the page's event stream calls when it closes.
 */
export function subscribeLaunched(target: EventTarget, callback: (visitorId: string) => void): () => void {
  const handler = (event: Event) => {
    const visitorId = (event as CustomEvent<{ visitorId?: unknown }>).detail?.visitorId;
    if (typeof visitorId === 'string') callback(visitorId);
  };
  target.addEventListener(LAUNCHED_EVENT, handler);
  return () => target.removeEventListener(LAUNCHED_EVENT, handler);
}

const SCENARIO_SWITCHED_KEY = 'paracosm:scenarioSwitched';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The tab's sessionStorage, read inside the callers' try: the read throws where storage is blocked. */
const tabStorage = (): FlagStorage => window.sessionStorage;

/**
 * Marks this tab as having just switched its scenario, right before the
 * reload that brings the new one up. The server still holds the visitor's
 * last run, in the scenario it ran in, since a switch is a pick and clears
 * no run; the page that loads next skips that run instead of drawing it
 * under the new scenario's nouns.
 */
export function markScenarioSwitched(storage: () => FlagStorage = tabStorage): void {
  try {
    storage().setItem(SCENARIO_SWITCHED_KEY, '1');
  } catch {
    // Private mode or a full quota: the reload shows the buffered run.
  }
}

// The answer for this page load, so every reader in it agrees: React's
// development StrictMode renders a component twice and keeps the second.
let switchedBeforeThisLoad: boolean | null = null;

/**
 * Whether this page load follows a switch in this tab. The first call
 * reads and clears the mark that markScenarioSwitched left, so the next
 * load does not inherit it; later calls in the same load answer the same.
 */
export function consumeScenarioSwitched(storage: () => FlagStorage = tabStorage): boolean {
  if (switchedBeforeThisLoad !== null) return switchedBeforeThisLoad;
  let switched = false;
  try {
    const flags = storage();
    switched = flags.getItem(SCENARIO_SWITCHED_KEY) === '1';
    if (switched) flags.removeItem(SCENARIO_SWITCHED_KEY);
  } catch {
    switched = false;
  }
  switchedBeforeThisLoad = switched;
  return switched;
}
