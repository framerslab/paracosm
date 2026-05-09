import test from 'node:test';
import assert from 'node:assert/strict';
import { emitScenarioUpdated, subscribeScenarioUpdates } from './scenario-sync.js';

test('scenario sync subscribers are notified when a scenario update is emitted', () => {
  const target = new EventTarget();
  let count = 0;

  const unsubscribe = subscribeScenarioUpdates(target, () => {
    count++;
  });

  emitScenarioUpdated(target);
  assert.equal(count, 1);

  unsubscribe();
  emitScenarioUpdated(target);
  assert.equal(count, 1);
});
