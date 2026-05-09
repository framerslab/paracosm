const SCENARIO_UPDATED_EVENT = 'paracosm:scenario-updated';

export function emitScenarioUpdated(target: EventTarget): void {
  target.dispatchEvent(new Event(SCENARIO_UPDATED_EVENT));
}

export function subscribeScenarioUpdates(target: EventTarget, callback: () => void): () => void {
  const handler = () => callback();
  target.addEventListener(SCENARIO_UPDATED_EVENT, handler);
  return () => target.removeEventListener(SCENARIO_UPDATED_EVENT, handler);
}
