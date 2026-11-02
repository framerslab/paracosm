import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import * as React from 'react';

import { StatsBar, type StatsBarLeader } from './StatsBar.js';
import { ScenarioContext } from '../../App.js';

interface ScenarioFile {
  ui: { headerMetrics: Array<{ id: string; format: string }> };
  world: { metrics: Record<string, { max?: number }> };
}

/** A scenario under scenarios/, with the ceilings GET /scenario adds to its header metrics. */
function scenarioContext(file: string) {
  const scenario = JSON.parse(readFileSync(new URL(`../../../../../scenarios/${file}`, import.meta.url), 'utf-8')) as ScenarioFile;
  return {
    ...scenario,
    ui: {
      ...scenario.ui,
      headerMetrics: scenario.ui.headerMetrics.map(m => ({ ...m, max: scenario.world.metrics[m.id]?.max })),
    },
  } as unknown as React.ContextType<typeof ScenarioContext>;
}

function leader(id: string, metrics: Record<string, number>, prevMetrics?: Record<string, number>): StatsBarLeader {
  return { id, state: { metrics, prevMetrics, deaths: 0, tools: 0, citations: 0 } } as unknown as StatsBarLeader;
}

function render(file: string, actors: StatsBarLeader[]) {
  return renderToString(
    <ScenarioContext.Provider value={scenarioContext(file)}>
      <StatsBar actors={actors} />
    </ScenarioContext.Provider>,
  );
}

test('StatsBar: Submarine Hull Integrity, held on 0 to 100, reads 100%, not 10000%', () => {
  const html = render('submarine.json', [
    leader('Halvorsen', { hullIntegrity: 100, morale: 0.75 }),
    leader('Morimoto', { hullIntegrity: 87.5, morale: 0.75 }),
  ]);
  assert.ok(html.includes('HULL'));
  assert.ok(!html.includes('10000%'), 'hull must not be scaled a second time');
  assert.match(html, />100%/);
  assert.match(html, />88%/);
});

test("StatsBar: Atlas Lab's Release Readiness, held on 0 to 1, reads 65%, and its change reads in the same points", () => {
  const html = render('atlas-lab.json', [
    leader('Marcus', { releaseReadiness: 0.65 }, { releaseReadiness: 0.6 }),
    leader('Priya', { releaseReadiness: 0.5 }, { releaseReadiness: 0.55 }),
  ]);
  assert.match(html, />65%/);
  assert.match(html, />50%/);
  assert.match(html, />\+5</);
  assert.match(html, />-5</);
});
