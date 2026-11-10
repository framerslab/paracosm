/**
 * Measurement for #234: do the scenarios other than Mars Genesis run byte
 * for byte as on master?
 *
 * Runs each scenario's kernel with no decisions (`new SimulationKernel`
 * with the scenario, then `advanceTurn` with its progression hook) over a
 * set of seeds and prints one hash of every final state (people, metrics,
 * metadata and the whole event log). The workflow runs this file on this
 * branch and on master, and the two prints are compared. It imports only
 * what master has. Nothing here is merged.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationKernel } from '../src/engine/core/kernel.js';
import { lunarScenario, marsScenario } from '../src/engine/scenarios/index.js';
import { scenarioKeyPersonnel } from '../src/cli/sim-config.js';
import { loadDiskCustomScenarios } from '../src/cli/custom-scenarios.js';
import type { ScenarioPackage } from '../src/engine/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEEDS = [950, ...Array.from({ length: 60 }, (_, i) => i + 1)];

interface Run { label: string; seeds: number[]; state: (seed: number) => unknown }

/** A scenario's kernel run with no decisions: its final state. */
function run(sc: ScenarioPackage | undefined, seed: number, population: number, turns: number, unitsPerTurn: number, people: ReturnType<typeof scenarioKeyPersonnel>, start = sc?.setup?.defaultStartTime ?? 1): unknown {
  const kernel = new SimulationKernel(seed, 'Aria Chen', people, sc ? { startTime: start, initialPopulation: population, scenario: sc } : { startTime: start, initialPopulation: population });
  for (let turn = 1; turn <= turns; turn++) kernel.advanceTurn(turn, start + (turn - 1) * unitsPerTurn, sc?.hooks?.progressionHook);
  return kernel.getState();
}

const disk = loadDiskCustomScenarios(resolve(here, '../scenarios'));
const atlas = disk.get('atlas-lab')!.scenario as ScenarioPackage;
const station = disk.get('deep-ocean-station')!.scenario as ScenarioPackage;
const twin = JSON.parse(readFileSync(resolve(here, '../scenarios/t2d-glp1-protocol.json'), 'utf-8')) as ScenarioPackage;

const RUNS: Run[] = [
  { label: 'Lunar Outpost, 30 people, 8 one-year turns', seeds: SEEDS, state: seed => run(lunarScenario, seed, 30, 8, 1, scenarioKeyPersonnel(lunarScenario)) },
  { label: 'Lunar Outpost, 50 people, 8 one-year turns', seeds: SEEDS, state: seed => run(lunarScenario, seed, 50, 8, 1, scenarioKeyPersonnel(lunarScenario)) },
  { label: 'Lunar Outpost, 30 people, 40 one-year turns', seeds: SEEDS, state: seed => run(lunarScenario, seed, 30, 40, 1, scenarioKeyPersonnel(lunarScenario)) },
  { label: 'deep-ocean station, 30 people, 8 one-year turns', seeds: SEEDS, state: seed => run(station, seed, 30, 8, 1, scenarioKeyPersonnel(station)) },
  { label: 'deep-ocean station, 50 people, 40 one-year turns', seeds: SEEDS, state: seed => run(station, seed, 50, 40, 1, scenarioKeyPersonnel(station)) },
  { label: 'Atlas Lab, 100 people, 12 monthly turns', seeds: SEEDS, state: seed => run(atlas, seed, 100, 12, 1, scenarioKeyPersonnel(atlas)) },
  { label: 'Atlas Lab, 480 people, 12 monthly turns', seeds: SEEDS.slice(0, 11), state: seed => run(atlas, seed, 480, 12, 1, scenarioKeyPersonnel(atlas)) },
  { label: 'Digital Twin, 1 person, 26 two-week turns', seeds: SEEDS, state: seed => run(twin, seed, 1, 26, 2, []) },
  { label: 'a kernel with no scenario, 30 people, six eight-year turns from 2035', seeds: SEEDS, state: seed => run(undefined, seed, 30, 6, 8, [], 2035) },
  { label: 'Mars Genesis, 30 people, six eight-year turns (expected to change)', seeds: SEEDS, state: seed => run(marsScenario, seed, 30, 6, 8, scenarioKeyPersonnel(marsScenario)) },
];

for (const r of RUNS) {
  const all = createHash('sha256');
  let deaths = 0;
  let births = 0;
  for (const seed of r.seeds) {
    const state = r.state(seed) as { eventLog: Array<{ type: string }> };
    all.update(JSON.stringify(state));
    deaths += state.eventLog.filter(e => e.type === 'death').length;
    births += state.eventLog.filter(e => e.type === 'birth').length;
  }
  console.log(`HASH ${r.label} | ${r.seeds.length} seeds | ${deaths} deaths, ${births} births | sha256 ${all.digest('hex')}`);
}
