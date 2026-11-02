const SCENARIO_UPDATED_EVENT = 'paracosm:scenario-updated';

export function emitScenarioUpdated(target: EventTarget): void {
  target.dispatchEvent(new Event(SCENARIO_UPDATED_EVENT));
}

export function subscribeScenarioUpdates(target: EventTarget, callback: () => void): () => void {
  const handler = () => callback();
  target.addEventListener(SCENARIO_UPDATED_EVENT, handler);
  return () => target.removeEventListener(SCENARIO_UPDATED_EVENT, handler);
}

const SCENARIO_SWITCHED_KEY = 'paracosm:scenarioSwitched';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The tab's sessionStorage, read inside the callers' try: the read throws where storage is blocked. */
const tabStorage = (): FlagStorage => window.sessionStorage;

/**
 * Marks this tab as having just switched its scenario, right before the
 * reload that brings the new one up. The server's event buffer still holds
 * the last run, any visitor's and in any scenario, since a switch is one
 * visitor's pick and clears nothing shared; the page that loads next skips
 * that run instead of drawing it under the new scenario's nouns.
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
