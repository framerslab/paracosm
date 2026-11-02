/**
 * The block each person gets in a reaction prompt. It showed every
 * researcher in a lab as "Health: bone 100% rad 0mSv": two exposures only
 * the Mars and Lunar physics move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { buildBatchAgentBlock } from '../../src/runtime/agents/agent-reactions.js';

const atlasLab = JSON.parse(
  readFileSync(new URL('../../scenarios/atlas-lab.json', import.meta.url), 'utf-8'),
) as ScenarioPackage;

const ctx = {
  eventTitle: 'Canary fails',
  eventCategory: 'safety_breach',
  outcome: 'risky_failure' as const,
  decision: 'Hold the release',
  time: 1,
  turn: 1,
  colonyMorale: 0.7,
  colonyPopulation: 24,
  timeUnitNoun: 'month',
  labels: atlasLab.labels,
};

test('a person\'s health line names only what has moved', () => {
  const kernel = new SimulationKernel(11, 'lead', [], { startTime: 1, initialPopulation: 24, scenario: atlasLab });
  const researcher = kernel.getState().agents[0];

  const untouched = buildBatchAgentBlock(researcher, ctx);
  assert.doesNotMatch(untouched, /\bbone\b|\brad\b|mSv/);
  assert.match(untouched, /Health: psych \d/);

  const exposed = structuredClone(researcher);
  exposed.health.boneDensityPct = 82;
  exposed.health.cumulativeRadiationMsv = 310;
  assert.match(buildBatchAgentBlock(exposed, ctx), /Health: bone 82% rad 310mSv psych \d/);
});
