import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { runFingerprint } from '../../src/runtime/util/generic-fingerprint.js';

const here = dirname(fileURLToPath(import.meta.url));
const atlasLab = loadDiskCustomScenarios(resolve(here, '../../scenarios')).get('atlas-lab')?.scenario as ScenarioPackage;
const livePair = JSON.parse(
  readFileSync(resolve(here, '../fixtures/verdict/atlas-lab-pair-2026-11-02.json'), 'utf-8'),
) as { runs: Array<{ leaderName: string; artifact: any }> };

// The live run counted every use of a tool: Marcus's 11 tools read
// totalTools 25 and Priya's 12 read 28, so both landed in the band for
// twelve or more tools.
test('a run\'s fingerprint counts each forged tool once, however often it was used', () => {
  const expected = [
    { totalTools: '11', innovation: 'productive' },
    { totalTools: '12', innovation: 'prolific' },
  ];
  livePair.runs.forEach(({ leaderName, artifact }, i) => {
    const leader = (atlasLab.presets[0] as any).leaders.find((l: any) => l.name === leaderName);
    const fingerprint = runFingerprint(
      atlasLab.hooks.fingerprintHook,
      { ...artifact.finalState, agents: [] },
      artifact.scenarioExtensions.paracosmInternal.outcomeClassifications,
      leader,
      artifact.forgedTools,
      6,
    );
    assert.equal(fingerprint.totalTools, String(artifact.forgedTools.length));
    assert.equal(fingerprint.totalTools, expected[i].totalTools);
    assert.equal(fingerprint.innovation, expected[i].innovation);
    // The scenario's own axes still lay over the generic fingerprint.
    assert.equal(fingerprint.summary, artifact.fingerprint.summary);
  });
});
