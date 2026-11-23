/**
 * Two leaders' decisions leave their colonies' morale apart (#226).
 *
 * In the live Mars Genesis pairs of 8 and 10 November 2026 (seed 950, 30
 * people, six turns of eight years; runs `run_b1d843da` of #221 and
 * `run_fd125bcf` of #234) morale ended 11 and 9 of 12 turns at exactly 1,
 * and both pairs ended with both leaders at 1. The yearly settling holds a
 * content colony at 0.9, so an eight-year turn that begins at 1 ends at
 * 0.943. In 22 of the 24 leader turns the decisions then asked for more
 * morale than the 0.057 left, and the ceiling cut the rest, whatever its
 * size. What a leader chose never showed.
 *
 * These tests run each pair the way a hosted run does: the scenario's
 * preset roster, `advanceTurn` with its progression hook at the top of each
 * turn, then for each event of the turn the policy step
 * (`applyCommanderPolicy` with the scenario's outcome tables) and the
 * outcome step (`applyOutcomeEffects`). The effects each decision adopted
 * are what the run logged as asked (`[policy] effects ... asked:`), and
 * each outcome is the one the run rolled, at the strength its reported
 * effects show on keys no ceiling stopped (`bonus`: how far that strength
 * stood from the outcome's own multiplier). No model call. A report's
 * updates on single people and the personality drift are not replayed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../../src/engine/core/kernel.js';
import { lunarScenario, marsScenario } from '../../src/engine/scenarios/index.js';
import { EffectRegistry, type TurnOutcome } from '../../src/engine/registries/effects.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { applyCommanderPolicy } from '../../src/runtime/orchestrator/commander-policy.js';
import { applyOutcomeEffects } from '../../src/runtime/orchestrator/outcome-effects.js';
import { emptyReport } from '../../src/runtime/util/parsers.js';
import { CommanderDecisionSchema } from '../../src/runtime/validators/commander.js';
import { loadDiskCustomScenarios } from '../../src/cli/custom-scenarios.js';
import { scenarioKeyPersonnel } from '../../src/cli/sim-config.js';
import type { CommanderDecision, DepartmentReport } from '../../src/runtime/contracts.js';

const here = dirname(fileURLToPath(import.meta.url));
const hook = marsScenario.hooks.progressionHook;
const registry = EffectRegistry.forScenario(marsScenario);
const tables = {
  registry,
  politicsHook: marsScenario.hooks.politicsHook,
  categories: Object.keys(marsScenario.knowledge?.categoryMapping ?? {}),
};
/** Mars turns: the landing in 2035, then a turn every eight years. */
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
/** The live pairs' seed, then sixty more. */
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const ARIA = 'Aria Chen';
const DIETRICH = 'Dietrich Voss';
/** The least two morale values differ by to count as apart: half a point of the percentage a run shows. */
const APART = 0.005;

/** One event of a live run: what the decision's adopted effects asked, and the outcome the run rolled. */
interface LiveEvent { turn: number; category: string; outcome: TurnOutcome; bonus: number; asked: Record<string, number> }
/** A department head the commander names before the first turn: id, department, role. */
type Promotion = [id: string, department: string, role: string];

const ARIA_8_NOV: LiveEvent[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.2212, asked: { lifeSupportCapacity: 20, pressurizedVolumeM3: 300, infrastructureModules: 1, morale: 0.07, waterLitersPerDay: 200, earthDependencyPct: -2, independencePressure: 0.07 } },
  { turn: 2, category: 'infrastructure', outcome: 'conservative_failure', bonus: 0.1073, asked: { morale: 0.2, independencePressure: 0.03 } },
  { turn: 3, category: 'resource', outcome: 'conservative_success', bonus: 0.0889, asked: { lifeSupportCapacity: 8, morale: 0.22, infrastructureModules: 1, independencePressure: 0.04 } },
  { turn: 4, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.1026, asked: { infrastructureModules: 1, scienceOutput: 1, morale: 0.24, independencePressure: 0.04 } },
  { turn: 5, category: 'environmental', outcome: 'conservative_success', bonus: 0.1914, asked: { pressurizedVolumeM3: 50, infrastructureModules: 3, morale: 0.38, independencePressure: 0.07 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.1598, asked: { lifeSupportCapacity: 10, pressurizedVolumeM3: 200, morale: 0.12, infrastructureModules: 1, scienceOutput: 0.05, earthDependencyPct: -6, independencePressure: 0.1 } },
];
const DIETRICH_8_NOV: LiveEvent[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.2176, asked: { powerKw: -10, waterLitersPerDay: 400, pressurizedVolumeM3: 500, lifeSupportCapacity: 30, infrastructureModules: 3, scienceOutput: 1, morale: 0.05, earthDependencyPct: -5, independencePressure: 0.07 } },
  { turn: 2, category: 'resource', outcome: 'conservative_failure', bonus: 0.0949, asked: { powerKw: -5, foodMonthsReserve: 0.3, infrastructureModules: 1, morale: 0.01, independencePressure: 0.05 } },
  { turn: 2, category: 'medical', outcome: 'conservative_success', bonus: 0.13, asked: { powerKw: -12, pressurizedVolumeM3: 120, infrastructureModules: 1, scienceOutput: 1, morale: 0.16, earthDependencyPct: -3, independencePressure: 0.05 } },
  { turn: 3, category: 'environmental', outcome: 'conservative_success', bonus: 0.1286, asked: { powerKw: -8, morale: 0.25, scienceOutput: 1, infrastructureModules: 1, earthDependencyPct: -3, independencePressure: 0.03 } },
  { turn: 4, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.1118, asked: { powerKw: -5.5, lifeSupportCapacity: 2, infrastructureModules: 1, scienceOutput: 1, morale: 0.28, earthDependencyPct: -4, independencePressure: 0.03 } },
  { turn: 5, category: 'resource', outcome: 'conservative_success', bonus: 0.1228, asked: { powerKw: -8, morale: 0.12, scienceOutput: 2, foodMonthsReserve: 0.2, earthDependencyPct: -4, independencePressure: 0.01 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.0558, asked: { scienceOutput: 1, morale: 0.04, earthDependencyPct: -2, independencePressure: 0.03 } },
];
const ARIA_10_NOV: LiveEvent[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.2212, asked: { pressurizedVolumeM3: 500, lifeSupportCapacity: 20, powerKw: 40, waterLitersPerDay: 200, infrastructureModules: 1, morale: 0.02, earthDependencyPct: -5, independencePressure: 0.02 } },
  { turn: 2, category: 'resource', outcome: 'conservative_failure', bonus: 0.154, asked: { waterLitersPerDay: -300, lifeSupportCapacity: -5, foodMonthsReserve: 1.5, earthDependencyPct: 2, independencePressure: 0.03 } },
  { turn: 3, category: 'medical', outcome: 'conservative_success', bonus: 0.142, asked: { waterLitersPerDay: -90, lifeSupportCapacity: -3, powerKw: -17, morale: 0.08, scienceOutput: 2, foodMonthsReserve: 0.8, independencePressure: 0.03 } },
  { turn: 4, category: 'resource', outcome: 'conservative_success', bonus: 0.1594, asked: { powerKw: -45, waterLitersPerDay: -105, lifeSupportCapacity: -4, scienceOutput: 4, morale: 0.05, earthDependencyPct: -1, independencePressure: 0.02 } },
  { turn: 5, category: 'environmental', outcome: 'conservative_success', bonus: 0.2056, asked: { powerKw: -24, lifeSupportCapacity: -2, waterLitersPerDay: -70, foodMonthsReserve: 1.2, morale: 0.1, scienceOutput: 3, earthDependencyPct: -2, independencePressure: 0.05 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.1738, asked: { waterLitersPerDay: 120, powerKw: -35, lifeSupportCapacity: 8, morale: 0.03, infrastructureModules: 1, earthDependencyPct: -3, independencePressure: 0.02 } },
];
const DIETRICH_10_NOV: LiveEvent[] = [
  { turn: 1, category: 'environmental', outcome: 'conservative_success', bonus: 0.1854, asked: { powerKw: 80, waterLitersPerDay: 450, morale: 0.06, infrastructureModules: 1, lifeSupportCapacity: 20, pressurizedVolumeM3: 500, earthDependencyPct: -7 } },
  { turn: 2, category: 'medical', outcome: 'conservative_failure', bonus: 0.134, asked: { powerKw: -15, morale: 0.02, lifeSupportCapacity: 15, pressurizedVolumeM3: 120, earthDependencyPct: -3, independencePressure: 0.03 } },
  { turn: 3, category: 'resource', outcome: 'conservative_success', bonus: 0.2006, asked: { waterLitersPerDay: -60, powerKw: -92, scienceOutput: 1, morale: 0.07, foodMonthsReserve: 0.3, earthDependencyPct: -5, independencePressure: 0.03 } },
  { turn: 4, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.1878, asked: { lifeSupportCapacity: 8, powerKw: -38, morale: 0.13, infrastructureModules: 1, earthDependencyPct: -5, independencePressure: 0.02 } },
  { turn: 4, category: 'medical', outcome: 'conservative_success', bonus: 0.096, asked: { morale: 0.07, powerKw: -10, lifeSupportCapacity: 3, earthDependencyPct: -2, independencePressure: 0.03 } },
  { turn: 5, category: 'infrastructure', outcome: 'conservative_success', bonus: 0.2043, asked: { powerKw: -69, lifeSupportCapacity: 12, scienceOutput: -1, morale: 0.13, earthDependencyPct: -4, independencePressure: 0.01 } },
  { turn: 6, category: 'technological', outcome: 'conservative_success', bonus: 0.0974, asked: { morale: 0.09, lifeSupportCapacity: 20, pressurizedVolumeM3: 400, scienceOutput: 5, infrastructureModules: 1, powerKw: -12, earthDependencyPct: -7, independencePressure: 0.08 } },
];

const HEADS_WITH_CARLOS_FERNANDEZ: Promotion[] = [
  ['col-carlos-fernandez', 'medical', 'Chief Medical Officer'],
  ['col-bruno-morales', 'engineering', 'Chief Engineer'],
  ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'],
];
const HEADS_WITH_SVEN_KIM: Promotion[] = [
  ['col-sven-kim', 'medical', 'Chief Medical Officer'],
  ['col-bruno-morales', 'engineering', 'Chief Engineer'],
  ['col-bruno-eriksson', 'agriculture', 'Head of Agriculture'],
];

interface Pair { name: string; aria: LiveEvent[]; dietrich: LiveEvent[]; ariaHeads: Promotion[]; dietrichHeads: Promotion[] }
const PAIRS: Pair[] = [
  { name: 'the live pair of 8 November 2026', aria: ARIA_8_NOV, dietrich: DIETRICH_8_NOV, ariaHeads: HEADS_WITH_CARLOS_FERNANDEZ, dietrichHeads: HEADS_WITH_SVEN_KIM },
  { name: 'the live pair of 10 November 2026', aria: ARIA_10_NOV, dietrich: DIETRICH_10_NOV, ariaHeads: HEADS_WITH_SVEN_KIM, dietrichHeads: HEADS_WITH_SVEN_KIM },
];

/** One report recommending the effects a decision adopted, and the decision that adopts them. */
function adopt(systemDelta: Record<string, number>) {
  const reports = [{
    ...emptyReport('engineering'),
    recommendedEffects: [{ id: 'effect_1', type: 'capacity_expansion', description: 'The effects the decision adopted.', systemDelta }],
  } as unknown as DepartmentReport];
  const decision = CommanderDecisionSchema.parse({
    selectedOptionId: 'option_a',
    decision: 'The live decision.',
    rationale: '',
    reasoning: '1) ...',
    selectedPolicies: ['engineering/effect_1'],
    rejectedPolicies: [],
    expectedTradeoffs: [],
    watchMetricsNextTurn: [],
  }) as unknown as CommanderDecision;
  return { reports, decision };
}

/** Morale at the end of each of six Mars turns under one leader's live decisions. */
function moraleAtTurnEnds(seed: number, leader: string, events: LiveEvent[], heads: Promotion[] = []): number[] {
  const kernel = new SimulationKernel(seed, leader, scenarioKeyPersonnel(marsScenario), {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  for (const [id, department, role] of heads) kernel.promoteAgent(id, department, role, leader);
  return TURNS.map(([turn, time]) => {
    kernel.advanceTurn(turn, time, hook);
    for (const event of events.filter(e => e.turn === turn)) {
      const { reports, decision } = adopt(event.asked);
      applyCommanderPolicy(kernel, decision, reports, turn, time, () => {}, tables);
      applyOutcomeEffects(kernel, registry, {
        category: event.category, outcome: event.outcome, modifiers: { personalityBonus: event.bonus, noise: 0 }, turn, time,
        politicsHook: marsScenario.hooks.politicsHook,
      });
    }
    return kernel.getState().metrics.morale;
  });
}

const shown = (ends: number[]) => ends.map(m => Math.round(m * 10000) / 10000).join(', ');
const atCeiling = (m: number) => m >= 1 - 1e-9;

for (const pair of PAIRS) {
  test(`${pair.name} ends with the two leaders' morale apart`, (t) => {
    const aria = moraleAtTurnEnds(950, ARIA, pair.aria, pair.ariaHeads);
    const dietrich = moraleAtTurnEnds(950, DIETRICH, pair.dietrich, pair.dietrichHeads);
    const seen = `morale at the six turn ends: ${ARIA} ${shown(aria)}; ${DIETRICH} ${shown(dietrich)}`;
    t.diagnostic(seen);
    assert.ok(Math.abs(aria[5] - dietrich[5]) > APART, `both leaders end at the same morale. ${seen}`);
    assert.equal([...aria, ...dietrich].filter(atCeiling).length, 0, `a turn ends with morale at its ceiling. ${seen}`);
  });

  test(`${pair.name}, on 61 seeds: the decisions leave morale apart on at least 50, and no turn ends at the ceiling`, (t) => {
    // No promotions: the people the live leaders promoted are on seed
    // 950's roster alone.
    let apart = 0;
    let turnEnds = 0;
    let pinned = 0;
    for (const seed of SEEDS) {
      const aria = moraleAtTurnEnds(seed, ARIA, pair.aria);
      const dietrich = moraleAtTurnEnds(seed, DIETRICH, pair.dietrich);
      if (Math.abs(aria[5] - dietrich[5]) > APART) apart++;
      turnEnds += aria.length + dietrich.length;
      pinned += [...aria, ...dietrich].filter(atCeiling).length;
    }
    const seen = `final morale apart on ${apart} of ${SEEDS.length} seeds; ${pinned} of ${turnEnds} turn ends at 1`;
    t.diagnostic(seen);
    assert.ok(apart >= 50, seen);
    assert.equal(pinned, 0, seen);
  });
}

test('a morale gain moves as asked up to 0.9 and closes a share of the gap to 1 above it', () => {
  const colony = () => new SimulationKernel(950, ARIA, [], { startTime: 2035, initialPopulation: 30, scenario: marsScenario });
  const after = (...gains: number[]) => {
    const kernel = colony();
    for (const gain of gains) kernel.applySystemDeltas({ morale: gain });
    return kernel.getState().metrics.morale;
  };
  const near = (actual: number, expected: number, label: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: expected ${expected}, got ${actual}`);
  /** From `from` (at or over 0.9), a gain of `above`: what is left of the gap to 1 shrinks by e^(-above / 0.1). */
  const eased = (from: number, above: number) => 1 - (1 - from) * Math.exp(-above / 0.1);

  // Mars begins at 0.85. A gain that ends at or under 0.9 is the sum.
  assert.equal(after(0.03), 0.85 + 0.03);
  assert.equal(after(0.05), 0.85 + 0.05);
  // Past 0.9, the part of the gain above it closes a share of the gap.
  near(after(0.08), eased(0.9, 0.03), '0.85 + 0.08');
  near(after(0.15), eased(0.9, 0.1), '0.85 + 0.15');
  // The change the kernel reports is the change it made.
  const kernel = colony();
  assert.deepEqual(kernel.applySystemDeltas({ morale: 0.15 }), { morale: 0.113212 });

  // Two gains land where one gain of their sum lands, in either order.
  near(after(0.04, 0.11), after(0.15), '0.04 then 0.11');
  near(after(0.11, 0.04), after(0.15), '0.11 then 0.04');
  // A larger gain always ends higher, and none reaches 1.
  const ladder = [0.06, 0.07, 0.1, 0.15, 0.3, 0.5, 2].map(gain => after(gain));
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i] > ladder[i - 1], `gains in order: ${ladder.join(', ')}`);
  assert.ok(ladder.at(-1)! < 1, `a gain of 2 from 0.85 ends at ${ladder.at(-1)}`);
  // A loss moves in full, from above 0.9 as from under it.
  near(after(0.15, -0.1), eased(0.9, 0.1) - 0.1, 'a loss after a gain');
  assert.equal(after(-0.2), 0.85 - 0.2);
});

/** A scenario's category tables: the built-in scenarios hold them in a list, the JSON on disk as the table itself. */
function categoryTables(sc: ScenarioPackage): Record<string, Record<string, number>> {
  const effects = sc.effects as unknown;
  return (Array.isArray(effects) ? effects[0].categoryDefaults : effects) as Record<string, Record<string, number>>;
}

test('the Moon and the deep-ocean station no longer end turns at 1 under an ordinary response each turn', (t) => {
  // Both scenarios take one-year turns, and their category tables add
  // morale at an ordinary response in every category but one or two, as
  // Mars Genesis's do. Eight turns, each event answered with a
  // conservative success at no modifier, each category in turn.
  const station = JSON.parse(readFileSync(resolve(here, '../../scenarios/submarine.json'), 'utf-8')) as ScenarioPackage;
  for (const [sc, start] of [[lunarScenario, 2030], [station, 2038]] as Array<[ScenarioPackage, number]>) {
    const table = categoryTables(sc);
    const categories = Object.keys(table);
    const ordinary = new EffectRegistry(table);
    const kernel = new SimulationKernel(sc.setup.defaultSeed ?? 1, ARIA, [], { startTime: start, initialPopulation: 30, scenario: sc });
    const ends: number[] = [];
    for (let turn = 1; turn <= 8; turn++) {
      kernel.advanceTurn(turn, start + turn - 1, sc.hooks?.progressionHook);
      applyOutcomeEffects(kernel, ordinary, {
        category: categories[(turn - 1) % categories.length], outcome: 'conservative_success',
        modifiers: { personalityBonus: 0, noise: 0 }, turn, time: start + turn - 1,
      });
      ends.push(kernel.getState().metrics.morale);
    }
    t.diagnostic(`${sc.id}: morale at the eight turn ends ${shown(ends)}`);
    assert.equal(ends.filter(atCeiling).length, 0, `${sc.id}: ${shown(ends)}`);
  }
});

test('in every scenario a morale gain that ends at or under 0.9 moves morale exactly as asked', () => {
  // The easing begins above 0.9, so a run whose decisions never lift
  // morale past it is the run it was: Atlas Lab and the Digital Twin begin
  // at 0.85, the Moon at 0.8, the deep-ocean station at 0.75.
  const onDisk = (file: string) => JSON.parse(readFileSync(resolve(here, '../../scenarios', file), 'utf-8')) as ScenarioPackage;
  const atlasLab = loadDiskCustomScenarios(resolve(here, '../../scenarios')).get('atlas-lab')?.scenario as ScenarioPackage;
  assert.ok(atlasLab, 'scenarios/ holds atlas-lab');
  for (const sc of [atlasLab, onDisk('t2d-glp1-protocol.json'), lunarScenario, onDisk('submarine.json'), marsScenario]) {
    const kernel = new SimulationKernel(11, ARIA, [], {
      startTime: sc.setup.defaultStartTime ?? 1, initialPopulation: Math.min(30, sc.setup.defaultPopulation ?? 30), scenario: sc,
    });
    const before = kernel.getState().metrics.morale;
    assert.ok(before + 0.04 <= 0.9, `${sc.id} begins at ${before}`);
    assert.deepEqual(kernel.applySystemDeltas({ morale: 0.04 }), { morale: 0.04 }, sc.id);
    assert.equal(kernel.getState().metrics.morale, before + 0.04, sc.id);
  }
});
