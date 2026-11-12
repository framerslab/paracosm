/**
 * A scenario compiled from a seed draft runs through the real turn loop.
 *
 * The bare orchard draft is compiled by the real `compileFromSeed` on a
 * stub model (tests/engine/compiler/helpers/stub-model-compile.ts), then run
 * by the real `runSimulation` on the same stub, twice, for two turns of 20
 * people on seed 950: once taking `option_b` on both turns and once
 * `option_a`. Both turns are milestones, so the run makes no Event
 * Director call. The stub answers the milestones prompt with `{}`, so the
 * two events are the compiler's own fallback milestones, "Founding" and
 * "Legacy Assessment", each with `option_a` safe and `option_b` risky
 * (src/engine/compiler/generate-milestones.ts). Each decision is Aria Chen's
 * recorded "Legacy Assessment" reply with its `selectedOptionId` set to the
 * option asked for, so it passes the commander's schema. No network is
 * reached and nothing is paid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunArtifact } from '../../src/engine/schema/index.js';
import { compileSeedOnStub, loadCompilerFixture, runCompiledOnStub } from '../engine/compiler/helpers/stub-model-compile.js';

interface Extensions {
  paracosmInternal?: { commanderDecisions?: Array<{ turn: number; decision: { selectedOptionId?: string } }> };
}

/** Each recorded decision's turn and the option it took, as tests/runtime/world-model/replay-turn-loop.test.ts reads them. */
const tookOptions = (artifact: RunArtifact) =>
  ((artifact.scenarioExtensions ?? {}) as Extensions).paracosmInternal?.commanderDecisions?.map(d => [d.turn, d.decision.selectedOptionId]);

test('a scenario compiled from the bare orchard draft runs two turns through the real turn loop, taking the option asked for', async () => {
  const { scenario } = await compileSeedOnStub({ draft: loadCompilerFixture('draft-orchard-bare.json'), hooks: 'working' });
  for (const take of ['option_b', 'option_a']) {
    const { artifact, decisions } = await runCompiledOnStub(scenario, { take, seed: 950, turns: 2, population: 20 });
    assert.ok(artifact, `the run taking ${take} returns an artifact`);
    assert.deepEqual(decisions, ['Founding', 'Legacy Assessment'], `the stub answered the two fallback milestones' decision prompts (taking ${take})`);
    assert.deepEqual(tookOptions(artifact), [[1, take], [2, take]], `the run recorded ${take} on both turns`);
    const population = artifact.finalState?.metrics?.population;
    assert.equal(typeof population, 'number', `the final state holds the head count (taking ${take}, read ${JSON.stringify(artifact.finalState?.metrics)})`);
  }
});
