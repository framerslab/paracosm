import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyCustomEventToCrisis, buildPromotionPrompt, buildTimeSchedule } from '../../src/runtime/util/runtime-helpers.js';
import type { ScenarioPackage } from '../../src/engine/types.js';

const readScenario = (file: string) => JSON.parse(
  readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf-8'),
) as ScenarioPackage;
const atlasLab = readScenario('atlas-lab.json');
const mars = readScenario('mars.json');

test('buildPromotionPrompt is written in the scenario\'s own words and departments', () => {
  // The prompt said "promote 5 colonists" with "medical" and "Chief
  // Medical Officer" as its example in every scenario, and an Atlas Lab
  // commander named a "Director of Colonial Communications".
  const lab = buildPromotionPrompt('candidate summary', atlasLab.departments.slice(0, 4), atlasLab.labels);
  assert.match(lab, /promote 4 researchers/);
  for (const d of atlasLab.departments.slice(0, 4)) {
    assert.ok(lab.includes(`"${d.id}"`) || lab.includes(d.id), `lacks ${d.id}`);
    assert.ok(lab.includes(d.label), `lacks ${d.label}`);
  }
  assert.ok(!lab.includes('communications'), 'names a department the run does not keep');
  assert.match(lab, /"department":"alignment_research","role":"Director of Alignment"/);
  assert.doesNotMatch(lab, /colonist|colonial|medical/i);

  const marsPrompt = buildPromotionPrompt('candidate summary', mars.departments, mars.labels);
  assert.match(marsPrompt, /promote 5 colonists/);
  assert.match(marsPrompt, /"department":"medical","role":"Chief Medical Officer"/);
});

test('applyCustomEventToCrisis appends matching user event text to the crisis', () => {
  const crisis = applyCustomEventToCrisis(
    { description: 'Base crisis text.', crisis: 'Base crisis text.', turnSummary: 'Base summary.' },
    [{ turn: 3, title: 'Comms blackout', description: 'Solar flare disrupts Earth comms.' }],
    3,
  );

  assert.match(crisis.crisis ?? '', /Comms blackout/);
  assert.match(crisis.turnSummary, /user event/i);
});

test('buildTimeSchedule offsets the simulation timeline from the configured start time', () => {
  assert.deepEqual(buildTimeSchedule(2042, 3), [2042, 2044, 2047]);
});
