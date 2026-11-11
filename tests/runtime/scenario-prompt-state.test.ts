/**
 * What a run's prompts say about the world comes from what the scenario
 * declares, read from a real kernel built with the real scenario JSON.
 *
 * The kernel holds Mars-heritage values in every run (power, food, water,
 * modules, life support, "earth-governed" politics), because its yearly
 * progression reads them. The live Atlas Lab pair of 1 November 2026
 * (run_b535e0f2) passed them to the director, the departments and the
 * commander, and its stream says "Earth-governed" 88 times in free text:
 * "under Earth-governed amplification", "Earth-governed dependency at 95%".
 * The same pair's director was never told the department ids, so
 * governance, with a head promoted, received none of its 13 events.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { buildDirectorPrompt, FALLBACK_EVENTS } from '../../src/runtime/orchestrator/director.js';
import { buildDepartmentContext } from '../../src/runtime/orchestrator/departments.js';
import { buildCommanderTurnPrompt, resolveEventDepartments } from '../../src/runtime/orchestrator/commander-setup.js';
import { buildForgeGuidance } from '../../src/runtime/orchestrator/forge-guidance.js';
import { buildEventSummary } from '../../src/runtime/orchestrator/index.js';
import { buildInstructions, extractColonistMemories } from '../../src/runtime/agents/chat-agents.js';
import { declaredMetrics, declaredPolitics, formatStateLine } from '../../src/runtime/util/scenario-state.js';
import { artifactTimeUnit } from '../../src/runtime/util/scenario-words.js';

const readScenario = (file: string) => JSON.parse(
  readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf-8'),
) as ScenarioPackage;
const atlasLab = readScenario('atlas-lab.json');
const mars = readScenario('mars.json');
const lunar = readScenario('lunar.json');
const submarine = readScenario('submarine.json');

const hexaco = {
  openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
  agreeableness: 0.5, emotionality: 0.5, honestyHumility: 0.5,
};

const kernelFor = (sc: ScenarioPackage, startTime: number) =>
  new SimulationKernel(11, 'lead', [], { startTime, initialPopulation: 24, scenario: sc });

/** The director prompt from a kernel's state, as the turn loop builds it. */
function directorPromptFor(sc: ScenarioPackage, startTime: number): string {
  const state = kernelFor(sc, startTime).getState();
  return buildDirectorPrompt({
    turn: 1,
    time: startTime,
    actorName: 'Marcus Reinhardt',
    actorArchetype: 'The Cautious Methodical Evaluator',
    leaderHexaco: hexaco,
    state: declaredMetrics(state.metrics, sc.world),
    politics: declaredPolitics(state.politics, sc.world),
    aliveCount: state.agents.length,
    nativeBornCount: 0,
    recentDeaths: 0,
    recentBirths: 0,
    previousEvents: [],
    toolsForged: [],
    driftSummary: [],
    recentToolOutputs: [],
    labels: sc.labels,
    world: sc.world,
  });
}

function departmentPromptFor(sc: ScenarioPackage, startTime: number): string {
  return buildDepartmentContext(
    sc.departments[0].id,
    kernelFor(sc, startTime).getState(),
    { turn: 1, time: startTime, title: 'Canary fails', crisis: 'A canary deployment regressed.', researchKeywords: [], snapshotHints: {}, riskyOption: '', riskSuccessProbability: 0.5 },
    { canonicalFacts: [], counterpoints: [], departmentNotes: {} },
    undefined,
    undefined,
    sc.labels,
    sc.world,
  );
}

const MARS_METRICS = /foodMonthsReserve|waterLitersPerDay|powerKw|pressurizedVolumeM3|lifeSupportCapacity|infrastructureModules|scienceOutput/;
const MARS_POLITICS = /earthDependencyPct|governanceStatus|independencePressure|earth-governed/i;

test('the director of a lab run reads the lab\'s state, and no Mars values', () => {
  const prompt = directorPromptFor(atlasLab, 1);
  assert.doesNotMatch(prompt, MARS_METRICS);
  assert.doesNotMatch(prompt, MARS_POLITICS);
  // In the unit the lab declares, as the commander's state line reads it.
  assert.match(prompt, /- alignmentBench: 0\.84 score/);
  assert.match(prompt, /- boardConfidence: 75/);
  assert.match(prompt, /- morale: /);
});

test('no scenario but Mars and Lunar hears of Earth from the kernel', () => {
  for (const file of ['corporate-quarterly.json', 'dual-superintelligence-council.json', 'submarine.json', 't2d-glp1-protocol.json']) {
    assert.doesNotMatch(directorPromptFor(readScenario(file), 1), MARS_POLITICS, file);
  }
});

test('Mars and Lunar keep the values they declare', () => {
  const marsPrompt = directorPromptFor(mars, 2035);
  assert.match(marsPrompt, /- foodMonthsReserve: 18/);
  assert.match(marsPrompt, /- earthDependencyPct: 95/);
  assert.match(marsPrompt, /- governanceStatus: earth-governed/);
  const lunarPrompt = directorPromptFor(lunar, 2035);
  assert.match(lunarPrompt, /- foodMonthsReserve: /);
  assert.match(lunarPrompt, /- earthDependencyPct: 95/);
  assert.match(lunarPrompt, /- independencePressure: /);
});

test('a department\'s state line is the scenario\'s metrics, labelled, with their units', () => {
  const lab = departmentPromptFor(atlasLab, 1);
  assert.doesNotMatch(lab, /\b(Food|Water|Power|Modules|Life support|Pop)\b/);
  assert.match(lab, /AlignmentBench 0\.84 score/);
  assert.match(lab, /Release Readiness 65%/);
  assert.match(lab, /Monthly Burn 12000000 USD\/mo/);
  assert.match(lab, /Morale 85%/);

  const colony = departmentPromptFor(mars, 2035);
  assert.match(colony, /Food Reserve 18 months/);
  assert.match(colony, /Water [\d.]+ L\/day/);
  assert.match(colony, /Power [\d.]+ kW/);
  assert.match(colony, /Morale \d+%/);

  // A percent the scenario counts from 0 to 100 stays as it is.
  assert.match(departmentPromptFor(submarine, 1), /Hull Integrity 100%/);
});

test('a scenario that declares no world shows its people and their morale, not Mars values', () => {
  const state = new SimulationKernel(11, 'lead', [], { startTime: 1, initialPopulation: 12 }).getState();
  const empty = { metrics: {}, capacities: {}, statuses: {}, politics: {}, environment: {} };
  const line = formatStateLine(state.metrics, empty);
  assert.match(line, /^Population \d+ \| Morale 85%$/);
  assert.deepEqual(Object.keys(declaredPolitics(state.politics, empty)), []);
});

test('the commander\'s state line is the scenario\'s', () => {
  const line = (sc: ScenarioPackage, startTime: number) => buildCommanderTurnPrompt({
    turn: 1,
    time: startTime,
    eventLabel: '',
    title: 'Canary fails',
    description: 'A canary deployment regressed.',
    summaries: '## GOVERNANCE (conf: 0.8)\nHold.',
    toolboxBlock: '',
    stateLine: formatStateLine(kernelFor(sc, startTime).getState().metrics, sc.world),
    optionText: '',
    effectsText: '',
    labels: sc.labels,
  });
  const lab = line(atlasLab, 1);
  assert.doesNotMatch(lab, /Food|Water/);
  assert.match(lab, /State: .*AlignmentBench 0\.84 score/);
  assert.match(line(mars, 2035), /State: .*Food Reserve 18 months/);
});

test('an event\'s departments reach the scenario\'s, by id, label or short form', () => {
  const kept = new Set(['alignment_research', 'capability_research', 'governance']);
  assert.deepEqual(
    resolveEventDepartments(['Governance', 'alignment', 'governance', 'Marketing'], atlasLab.departments, kept),
    ['governance', 'alignment_research'],
  );
  // A department the run does not keep, or none the scenario has: the
  // first two it keeps answer, since only those have heads.
  assert.deepEqual(
    resolveEventDepartments(['communications'], atlasLab.departments, kept),
    ['alignment_research', 'capability_research'],
  );
  assert.deepEqual(
    resolveEventDepartments(['medical', 'agriculture'], atlasLab.departments, kept),
    ['alignment_research', 'capability_research'],
  );
  assert.deepEqual(resolveEventDepartments(undefined, atlasLab.departments, kept), ['alignment_research', 'capability_research']);
  // A milestone's own departments, which the turn loop used to replace
  // with a list written for Mars ("medical", "engineering" on the Moon).
  const arrival = (lunar as unknown as { dataDrivenHooks: { milestones: Array<{ event: { title: string; relevantDepartments: string[] } }> } })
    .dataDrivenHooks.milestones.find(m => m.event.title === 'Lunar Arrival')!;
  assert.deepEqual(
    resolveEventDepartments(arrival.event.relevantDepartments, lunar.departments, new Set(lunar.departments.map(d => d.id))),
    ['engineering', 'mining'],
  );
});

test('the canned events a failed director falls back on name nothing of Mars', () => {
  assert.ok(FALLBACK_EVENTS.length > 0);
  for (const event of FALLBACK_EVENTS) {
    assert.doesNotMatch(
      JSON.stringify({ ...event, relevantDepartments: [] }),
      /colon(y|ist)|\bmars\b|crop|caloric|grow light|hydroponic|life support|ECLSS/i,
      event.title,
    );
  }
});

test('the forge guidance every department reads names no Mars', () => {
  const guidance = buildForgeGuidance('governance');
  assert.doesNotMatch(guidance, /\bMars\b/);
  assert.match(guidance, /"department": "governance"/);
  assert.match(guidance, /GOOD FORGE EXAMPLE/);
});

test('a department\'s report format lists the keys its run holds, with their units, and the example uses them', () => {
  // The format showed only {"morale": 0.05}, so the Mars departments of
  // 6 November 2026 wrote "power", "water" and "science", which the run
  // does not hold (#209).
  const marsGuidance = buildForgeGuidance('engineering', mars.world, kernelFor(mars, 2035).getState());
  const format = marsGuidance.slice(marsGuidance.indexOf('REPORT FORMAT'));
  for (const key of ['infrastructureModules', 'foodMonthsReserve', 'powerKw', 'lifeSupportCapacity', 'earthDependencyPct']) {
    assert.match(format, new RegExp(`"${key}"`), `the Mars report format names ${key}`);
  }
  assert.match(format, /"powerKw"[^\n]*kW/, 'with its unit');
  assert.match(format, /"foodMonthsReserve"[^\n]*months/);
  assert.doesNotMatch(format, /"(power|water|science|health)"/, 'no bare key the run does not hold');
  assert.match(format, /not listed[^\n]*refused/i, 'a key not listed is refused');
  assert.match(format, /"systemDelta": \{"[A-Za-z]+": -?[0-9.]+/, 'the example delta names a key the run holds');
  const example = format.match(/"systemDelta": (\{[^}]*\})/)![1];
  for (const key of Object.keys(JSON.parse(example))) {
    assert.match(format, new RegExp(`^- "${key}"`, 'm'), `the example's ${key} is a listed key`);
  }
  assert.match(format, /"politicsDelta": \{"earthDependencyPct": -?[0-9.]+\}/);

  // Atlas Lab's departments are shown Atlas Lab's keys, and none of Mars.
  const atlasGuidance = buildForgeGuidance('governance', atlasLab.world, kernelFor(atlasLab, 1).getState());
  const atlasFormat = atlasGuidance.slice(atlasGuidance.indexOf('REPORT FORMAT'));
  for (const key of ['alignmentBench', 'releaseReadiness', 'runwayMonths', 'trainingRunsPerMonth', 'boardConfidence']) {
    assert.match(atlasFormat, new RegExp(`"${key}"`), `the Atlas Lab report format names ${key}`);
  }
  assert.doesNotMatch(atlasFormat, /infrastructureModules|foodMonthsReserve|earthDependencyPct|rspTier/);

  // One system block per department per run: the same inputs give the same text.
  assert.equal(buildForgeGuidance('engineering', mars.world, kernelFor(mars, 2035).getState()), marsGuidance);
});

test('a custom scenario\'s key with a quote or a backslash still gives a report example that parses', () => {
  // A custom scenario's world maps are string-keyed records, so a key may
  // hold a quote or a backslash; written between bare quotes it broke the
  // worked JSON example the department copies.
  const world = {
    metrics: { 'reserve"days': { label: 'Reserve days', unit: 'days', min: 0 }, 'a\\b': { label: 'Ratio', unit: '', min: 0, max: 1 } },
    politics: { 'trust"index': { label: 'Trust', unit: '', min: 0, max: 100 } },
  };
  const state = { metrics: { population: 10, morale: 0.8, 'reserve"days': 30, 'a\\b': 0.5 }, politics: { 'trust"index': 50 } };
  const guidance = buildForgeGuidance('operations', world as never, state);
  const format = guidance.slice(guidance.indexOf('REPORT FORMAT'));
  const effects = format.match(/"recommendedEffects": \[(\{.*\})\],\n/)![1];
  const parsed = JSON.parse(effects) as { systemDelta: Record<string, number>; politicsDelta: Record<string, number> };
  assert.deepEqual(Object.keys(parsed.systemDelta), ['reserve"days', 'a\\b']);
  assert.deepEqual(Object.keys(parsed.politicsDelta), ['trust"index']);
  for (const key of ['reserve"days', 'a\\b', 'trust"index']) {
    assert.ok(format.includes(`- ${JSON.stringify(key)} (`), `the key list names ${key} as JSON`);
  }
});

test('the event summaries a viewer reads name the scenario\'s leader', () => {
  assert.equal(buildEventSummary('decision_pending', {}, atlasLab.labels), 'release director deciding');
  assert.match(buildEventSummary('decision_made', { decision: 'Hold the release' }, atlasLab.labels), /^release director decided: Hold the release/);
  assert.equal(buildEventSummary('decision_pending', {}, mars.labels), 'commander deciding');
});

test('a character\'s chat speaks of the scenario\'s leader and time', () => {
  const profile = { agentId: 'col-ada-brandt', name: 'Ada Brandt' };
  const lab = buildInstructions(profile, 'lab', 'researchers', [], atlasLab.labels);
  assert.doesNotMatch(lab, /commander|\byears?\b|2043/i);
  assert.match(lab, /the decisions your release director made/);
  assert.match(lab, /Cite turn numbers and months/);
  const colony = buildInstructions(profile, 'colony', 'colonists', [], mars.labels);
  assert.match(colony, /the decisions your commander made/);
  assert.match(colony, /Cite turn numbers and years/);

  const memories = extractColonistMemories('col-ada-brandt', [
    { type: 'decision_made', leader: 'Marcus Reinhardt', data: { turn: 1, time: 1, decision: 'Hold the release' } },
    { type: 'outcome', leader: 'Marcus Reinhardt', data: { turn: 1, time: 1, outcome: 'risky_failure' } },
  ], atlasLab.labels.timeUnitNoun, atlasLab.labels).map(m => m.text).join('\n');
  assert.doesNotMatch(memories, /commander|colony/i);
  assert.match(memories, /The release director decided: Hold the release/);
});

test('a saved run\'s time unit is the scenario\'s, plural included', () => {
  assert.deepEqual(artifactTimeUnit(mars.labels), { singular: 'year', plural: 'years' });
  // A compiled scenario names the unit and no plural.
  assert.deepEqual(artifactTimeUnit({ timeUnitNoun: 'quarter' }), { singular: 'quarter', plural: 'quarters' });
  assert.deepEqual(artifactTimeUnit({}), { singular: 'time', plural: 'times' });
});

test('the director reads full morale as full: 100%, not 1', () => {
  // The director's state lines printed a number as a percent only strictly
  // between 0 and 1, so a colony at full morale read "morale: 1". In the
  // live Mars pairs of 8 and 10 November 2026, 14 of the 18 director events
  // of the first two then described morale as 1, "1/10" or "1/100", for
  // example "morale is extremely low (morale: 1)" (#248).
  const state = kernelFor(mars, 2035).getState();
  const prompt = buildDirectorPrompt({
    turn: 2,
    time: 2043,
    actorName: 'Aria Chen',
    actorArchetype: 'The Visionary',
    leaderHexaco: hexaco,
    state: { ...declaredMetrics(state.metrics, mars.world), morale: 1 },
    politics: declaredPolitics(state.politics, mars.world),
    aliveCount: state.agents.length,
    nativeBornCount: 0,
    recentDeaths: 0,
    recentBirths: 0,
    previousEvents: [],
    toolsForged: [],
    driftSummary: [],
    recentToolOutputs: [],
    labels: mars.labels,
    world: mars.world,
  } as Parameters<typeof buildDirectorPrompt>[0]);
  assert.match(prompt, /^- morale: 100%$/m);
  assert.doesNotMatch(prompt, /^- morale: 1$/m);
});

test('the director reads every 0-to-1 fraction a scenario declares as a percent, at 0 and 1 too, and no other number as one', () => {
  // The politics lines printed a number as a percent only strictly between
  // 0 and 1, so Mars independence pressure at its ceiling read
  // "independencePressure: 1", and a politics value held on a 0 to 100
  // scale (Atlas Lab's board confidence) read 0.5 as "50%".
  const files = ['atlas-lab.json', 'corporate-quarterly.json', 'dual-superintelligence-council.json', 'lunar.json', 'mars.json', 'submarine.json', 't2d-glp1-protocol.json'];
  let fractions = 0;
  let others = 0;
  for (const file of files) {
    const sc = readScenario(file);
    for (const bag of ['metrics', 'capacities', 'politics'] as const) {
      for (const [key, decl] of Object.entries(sc.world?.[bag] ?? {})) {
        if (decl.type !== 'number') continue;
        const fraction = decl.unit === '%' && typeof decl.max === 'number' && decl.max <= 1;
        const lineAt = (value: number) => {
          const prompt = buildDirectorPrompt({
            turn: 2,
            time: 2,
            actorName: 'Lead',
            actorArchetype: 'Lead',
            leaderHexaco: hexaco,
            state: bag === 'politics' ? {} : { [key]: value },
            politics: bag === 'politics' ? { [key]: value } : {},
            aliveCount: 10,
            nativeBornCount: 0,
            recentDeaths: 0,
            recentBirths: 0,
            previousEvents: [],
            toolsForged: [],
            driftSummary: [],
            recentToolOutputs: [],
            labels: sc.labels,
            world: sc.world,
          } as Parameters<typeof buildDirectorPrompt>[0]);
          const line = new RegExp(`^- ${key}: (.*)$`, 'm').exec(prompt);
          assert.ok(line, `${file} ${bag}.${key} has a line`);
          return line![1];
        };
        if (fraction) {
          fractions++;
          assert.equal(lineAt(1), '100%', `${file} ${bag}.${key} at 1`);
          assert.equal(lineAt(0), '0%', `${file} ${bag}.${key} at 0`);
          assert.equal(lineAt(0.37), '37%', `${file} ${bag}.${key} at 0.37`);
        } else {
          others++;
          assert.notEqual(lineAt(0.5), '50%', `${file} ${bag}.${key} at 0.5 is not a fraction`);
          assert.notEqual(lineAt(1), '100%', `${file} ${bag}.${key} at 1 is not a fraction`);
        }
      }
    }
  }
  assert.ok(fractions >= 10 && others >= 10, `${fractions} fractions and ${others} other numbers read`);
  assert.match(directorPromptFor(mars, 2035), /^- independencePressure: 5%$/m);
});
