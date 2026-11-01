/**
 * The words a run's prompts use come from the scenario's labels.
 *
 * The live Atlas Lab pair of 1 November 2026 (run_b535e0f2) read as a
 * Mars run: the commander's decisions said "colonists" 33 times, the
 * first event opened "Year 1 / Turn 1" though the lab counts months, and
 * the commander was told it was "the colony commander". The director
 * prompt said "TURN 1, YEAR 1", the department prompt "TURN 1 - YEAR 1",
 * and the reaction prompt "colony members". These tests build each
 * prompt the orchestrator sends, with the real scenario JSON under
 * scenarios/, and read the words in it. Mars keeps its own words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { buildDirectorPrompt, type DirectorContext } from '../../src/runtime/orchestrator/director.js';
import {
  buildCommanderBootstrap,
  buildCommanderTurnPrompt,
  buildPersonalityCue,
} from '../../src/runtime/orchestrator/commander-setup.js';
import { buildDepartmentContext } from '../../src/runtime/orchestrator/departments.js';
import { buildBatchSituationContext, buildBatchSystemPrompt } from '../../src/runtime/agents/agent-reactions.js';

const readScenario = (file: string) => JSON.parse(
  readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf-8'),
) as ScenarioPackage;
const atlasLab = readScenario('atlas-lab.json');
const mars = readScenario('mars.json');

const hexaco = {
  openness: 0.9, conscientiousness: 0.2, extraversion: 0.8,
  agreeableness: 0.8, emotionality: 0.2, honestyHumility: 0.5,
};

function directorContext(sc: ScenarioPackage, time: number): DirectorContext {
  return {
    turn: 1,
    time,
    actorName: 'Marcus Reinhardt',
    actorArchetype: 'The Cautious Methodical Evaluator',
    leaderHexaco: hexaco,
    state: { population: 480, morale: 0.7 },
    politics: {},
    aliveCount: 480,
    nativeBornCount: 0,
    recentDeaths: 0,
    recentBirths: 0,
    previousEvents: [],
    toolsForged: [],
    driftSummary: [],
    recentToolOutputs: [],
    labels: sc.labels,
  };
}

/** Every prompt one turn of a run sends, in the scenario's words. */
function promptsFor(sc: ScenarioPackage, time: number): Record<string, string> {
  const kernel = new SimulationKernel(11, 'marcus-reinhardt', [], { startTime: time, initialPopulation: 12 });
  const dept = sc.departments[0].id;
  const reactionCtx = {
    eventTitle: 'Canary fails',
    eventCategory: sc.departments[0].id,
    outcome: 'risky_failure' as const,
    decision: 'Hold the release',
    time,
    turn: 1,
    colonyMorale: 0.7,
    colonyPopulation: 480,
    timeUnitNoun: sc.labels.timeUnitNoun,
    labels: sc.labels,
  };
  return {
    director: buildDirectorPrompt(directorContext(sc, time)),
    bootstrap: buildCommanderBootstrap(buildPersonalityCue(hexaco), sc.labels),
    commanderTurn: buildCommanderTurnPrompt({
      turn: 1,
      time,
      eventLabel: '',
      title: 'Canary fails',
      description: 'A canary deployment shows a refusal regression.',
      summaries: '## GOVERNANCE (conf: 0.8)\nHold.',
      toolboxBlock: '',
      population: 480,
      morale: 0.7,
      foodMonthsReserve: 12,
      optionText: '',
      effectsText: '',
      labels: sc.labels,
    }),
    department: buildDepartmentContext(
      dept,
      kernel.getState(),
      { turn: 1, time, title: 'Canary fails', crisis: 'A canary deployment shows a refusal regression.', researchKeywords: [], snapshotHints: {}, riskyOption: '', riskSuccessProbability: 0.5 },
      { canonicalFacts: [], counterpoints: [], departmentNotes: {} },
      undefined,
      undefined,
      sc.labels,
    ),
    reactions: `${buildBatchSystemPrompt(sc.labels)}\n${buildBatchSituationContext(reactionCtx)}`,
  };
}

test('an Atlas Lab run\'s prompts speak of researchers, the lab and months', () => {
  const prompts = promptsFor(atlasLab, 1);
  for (const [name, text] of Object.entries(prompts)) {
    assert.doesNotMatch(text, /colonist|colony|colonial/i, `${name} prompt: ${text}`);
    assert.doesNotMatch(text, /\byears?\b/i, `${name} prompt: ${text}`);
    assert.ok(!text.includes('Colony Alpha') && !text.includes('Colony Beta'), `${name} prompt names a colony unit`);
    assert.doesNotMatch(text, /Earth/, `${name} prompt: ${text}`);
  }
  assert.match(prompts.director, /TURN 1, MONTH 1/);
  assert.match(prompts.director, /researchers/);
  assert.match(prompts.bootstrap, /lab release director/);
  assert.match(prompts.bootstrap, /researchers/);
  assert.match(prompts.commanderTurn, /TURN 1, Month 1: Canary fails/);
  assert.match(prompts.department, /TURN 1, MONTH 1: Canary fails/);
  assert.match(prompts.reactions, /researchers/);
  assert.match(prompts.reactions, /Month 1/);
});

test('a Mars Genesis run keeps its colonists, its colony and its years', () => {
  const prompts = promptsFor(mars, 2035);
  assert.match(prompts.director, /TURN 1, YEAR 2035/);
  assert.match(prompts.director, /colonists/);
  assert.match(prompts.bootstrap, /colony commander/);
  assert.match(prompts.bootstrap, /colonists/);
  assert.match(prompts.commanderTurn, /TURN 1, Year 2035: Canary fails/);
  assert.match(prompts.department, /TURN 1, YEAR 2035: Canary fails/);
  assert.match(prompts.reactions, /colonists|colony/);
  assert.match(prompts.reactions, /Year 2035/);
});
