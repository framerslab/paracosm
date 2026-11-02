import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { ScenarioContext } from '../../App.js';
import { EventCard } from './EventCard.js';

// Badge is compiled with the classic JSX transform under the test runner.
(globalThis as { React?: unknown }).React = React;

test('EventCard: an outcome shows the politics it moved beside its metrics', () => {
  const html = renderToString(
    <ScenarioContext.Provider value={{} as never}>
      <EventCard
        actorIndex={0}
        event={{
          id: 'e1',
          type: 'outcome',
          turn: 3,
          data: {
            outcome: 'conservative_success',
            systemDeltas: { releaseReadiness: 0.02 },
            politicsDeltas: { boardConfidence: 5, investorPressure: -2 },
          },
        }}
      />
    </ScenarioContext.Provider>,
  );
  assert.match(html, /releaseReadiness/);
  assert.match(html, /boardConfidence/);
  assert.match(html, /investorPressure/);
});
