/**
 * Measurement for #234: the supply reading through the policy step.
 *
 * Runs pairs the way tests/runtime/leaders-change-who-lives.test.ts does:
 * `advanceTurn` with the Mars progression hook at the top of each turn, then
 * `applyCommanderPolicy` with the scenario's outcome tables and a fixed
 * report and decision in place of the model calls. Each leader adopts the
 * same effect every turn; the bound on one decision applies. Compares who
 * died by 2075 under master's rates and under the supply reading, on the
 * generator's roster (as that test runs) and on the preset roster (as a
 * hosted run does). Nothing here is merged.
 */
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { supplyReading } from '../src/engine/core/progression.js';
import { marsScenario } from '../src/engine/scenarios/index.js';
import { EffectRegistry } from '../src/engine/registries/effects.js';
import { applyCommanderPolicy } from '../src/runtime/orchestrator/commander-policy.js';
import { emptyReport } from '../src/runtime/util/parsers.js';
import { CommanderDecisionSchema } from '../src/runtime/validators/commander.js';
import { scenarioKeyPersonnel } from '../src/cli/sim-config.js';
import type { CommanderDecision, DepartmentReport } from '../src/runtime/contracts.js';

const hook = marsScenario.hooks.progressionHook;
const TURNS: Array<[number, number]> = [[1, 2035], [2, 2043], [3, 2051], [4, 2059], [5, 2067], [6, 2075]];
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];
const tables = {
  registry: EffectRegistry.forScenario(marsScenario),
  politicsHook: marsScenario.hooks.politicsHook,
  categories: Object.keys(marsScenario.knowledge?.categoryMapping ?? {}),
};

/** A department report recommending one effect, and the decision that adopts it. */
function adopt(department: string, description: string, systemDelta: Record<string, number>) {
  const reports = [{
    ...emptyReport(department),
    recommendedEffects: [{ id: 'effect_1', type: 'capacity_expansion', description, systemDelta }],
  } as unknown as DepartmentReport];
  const decision = CommanderDecisionSchema.parse({
    selectedOptionId: 'option_a',
    decision: description,
    rationale: '',
    reasoning: '1) ...',
    selectedPolicies: [`${department}/effect_1`],
    rejectedPolicies: [],
    expectedTradeoffs: [],
    watchMetricsNextTurn: [],
  }) as unknown as CommanderDecision;
  return { reports, decision };
}

type Roster = 'generator' | 'preset';

/** Six Mars turns with one leader adopting the same effect each turn. */
function run(seed: number, roster: Roster, choice: ReturnType<typeof adopt>) {
  const kernel = new SimulationKernel(seed, 'Leader', roster === 'preset' ? scenarioKeyPersonnel(marsScenario) : [], {
    startTime: 2035, initialPopulation: 30, scenario: marsScenario,
  });
  const founders = new Set(kernel.getState().agents.map(a => a.core.id));
  const lines: string[] = [];
  for (const [turn, time] of TURNS) {
    kernel.advanceTurn(turn, time, hook);
    applyCommanderPolicy(kernel, choice.decision, choice.reports, turn, time, l => lines.push(l), tables);
  }
  const state = kernel.getState();
  return {
    state, lines, founders,
    dead: new Set(state.agents.filter(a => !a.health.alive).map(a => a.core.id)),
    names: new Map(state.agents.map(a => [a.core.id, a.core.name])),
  };
}

const PAIRS: Array<{ name: string; a: ReturnType<typeof adopt>; b: ReturnType<typeof adopt> }> = [
  { name: 'water -100 a turn against +100', a: adopt('engineering', 'Ration the water.', { waterLitersPerDay: -100 }), b: adopt('engineering', 'Drill a new well.', { waterLitersPerDay: 100 }) },
  { name: 'life support -5 a turn against +5', a: adopt('engineering', 'Run the scrubbers down.', { lifeSupportCapacity: -5 }), b: adopt('engineering', 'Add a scrubber bank.', { lifeSupportCapacity: 5 }) },
  { name: 'power -60 a turn against +60', a: adopt('engineering', 'Mothball an array.', { powerKw: -60 }), b: adopt('engineering', 'Raise a solar array.', { powerKw: 60 }) },
  { name: 'volume -200 a turn against +200', a: adopt('engineering', 'Seal off a wing.', { pressurizedVolumeM3: -200 }), b: adopt('engineering', 'Pressurize a new wing.', { pressurizedVolumeM3: 200 }) },
  {
    name: 'water, life support, power and volume down a turn against up',
    a: adopt('engineering', 'Run the systems down.', { waterLitersPerDay: -100, lifeSupportCapacity: -5, powerKw: -60, pressurizedVolumeM3: -200 }),
    b: adopt('engineering', 'Build the systems up.', { waterLitersPerDay: 100, lifeSupportCapacity: 5, powerKw: 60, pressurizedVolumeM3: 200 }),
  },
  { name: 'nothing but morale +0.05 a turn against water +100', a: adopt('psychology', 'Rest rotation for the crew.', { morale: 0.05 }), b: adopt('engineering', 'Drill a new well.', { waterLitersPerDay: 100 }) },
  { name: 'morale +0.05 a turn against two modules (the existing test)', a: adopt('psychology', 'Rest rotation for the crew.', { morale: 0.05 }), b: adopt('engineering', 'Build two shielded habitat modules.', { infrastructureModules: 2 }) },
];

for (const on of [false, true]) {
  supplyReading.on = on;
  const mode = on ? 'supply reading' : 'master rates';
  console.log(`\n===== ${mode} =====`);
  for (const roster of ['generator', 'preset'] as Roster[]) {
    for (const pair of PAIRS) {
      let differ = 0, onlyBSeeds = 0, deathsA = 0, deathsB = 0;
      let at950 = '';
      for (const seed of SEEDS) {
        const a = run(seed, roster, pair.a);
        const b = run(seed, roster, pair.b);
        const onlyA = [...a.dead].filter(id => !b.dead.has(id));
        const onlyB = [...b.dead].filter(id => !a.dead.has(id));
        if (onlyA.length + onlyB.length > 0) differ++;
        if (onlyB.some(id => b.founders.has(id))) onlyBSeeds++;
        deathsA += a.dead.size; deathsB += b.dead.size;
        if (seed === 950) {
          const m = (s: typeof a) => s.state.metrics as Record<string, number>;
          at950 = `seed 950: A lost ${a.dead.size}, B lost ${b.dead.size}; only under A ${JSON.stringify(onlyA.map(id => a.names.get(id)).sort())}; only under B ${JSON.stringify(onlyB.map(id => b.names.get(id)).sort())}; end state A water ${m(a).waterLitersPerDay} life support ${m(a).lifeSupportCapacity} power ${m(a).powerKw} volume ${m(a).pressurizedVolumeM3} modules ${m(a).infrastructureModules}; B water ${m(b).waterLitersPerDay} life support ${m(b).lifeSupportCapacity} power ${m(b).powerKw} volume ${m(b).pressurizedVolumeM3} modules ${m(b).infrastructureModules}; first policy lines A ${JSON.stringify(a.lines.slice(0, 1))} B ${JSON.stringify(b.lines.slice(0, 1))}`;
        }
      }
      const n = SEEDS.length;
      console.log(`POLICY ${mode} | ${roster} roster | ${pair.name} | ${differ} of ${n} differ | deaths a run ${(deathsA / n).toFixed(2)} against ${(deathsB / n).toFixed(2)} | seeds where a founder died only under B: ${onlyBSeeds} | ${at950}`);
    }
  }
}
