import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { EventCard } from './EventCard.js';

test('EventCard: an outcome shows the politics it moved beside its metrics', () => {
  const html = renderToString(
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
    />,
  );
  assert.match(html, /releaseReadiness/);
  assert.match(html, /boardConfidence/);
  assert.match(html, /investorPressure/);
});

void React;
