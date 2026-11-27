import type { KeyPersonnel } from '../../engine/core/agent-generator.js';
import { SimulationKernel, type SimulationInitOverrides } from '../../engine/core/kernel.js';
import type { ActorConfig, ScenarioPackage } from '../../engine/types.js';

/** The resolved inputs to a fresh run's kernel. */
export interface RunKernelConfig extends Omit<SimulationInitOverrides, 'scenario'> {
  seed: number;
  keyPersonnel: KeyPersonnel[];
}

/** Construct the same starting world for a fresh run and its prompt sample. */
export function createRunKernel(
  config: RunKernelConfig,
  leader: Pick<ActorConfig, 'name'>,
  scenario: ScenarioPackage,
): SimulationKernel {
  return new SimulationKernel(config.seed, leader.name, config.keyPersonnel, {
    scenario,
    startTime: config.startTime,
    initialPopulation: config.initialPopulation,
    yearsPerUnit: config.yearsPerUnit,
    startingResources: config.startingResources,
    startingPolitics: config.startingPolitics,
    startingStatuses: config.startingStatuses,
    startingEnvironment: config.startingEnvironment,
  });
}
