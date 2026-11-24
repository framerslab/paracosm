import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';
import { useLocalHistory } from './useLocalHistory.js';

void React;

test('useLocalHistory: a browser that refuses localStorage starts with no saved runs', () => {
  // A private window that blocks site storage throws on the property read itself.
  const refusing = {};
  Object.defineProperty(refusing, 'localStorage', {
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: refusing });
  try {
    let count = -1;
    function Probe() {
      count = useLocalHistory({ scenarioShortName: 'mars-genesis' }).entries.length;
      return null;
    }
    assert.doesNotThrow(() => renderToString(<Probe />));
    assert.equal(count, 0);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
