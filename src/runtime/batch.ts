/**
 * Batch Runner — run multiple scenarios with typed configs and reproducible manifests.
 */

import type { ScenarioPackage, ActorConfig, LlmProvider, SimulationModelConfig } from '../engine/types.js';
import type { KeyPersonnel } from '../engine/core/agent-generator.js';
import type { CostPreset } from '../cli/sim-config.js';

export interface BatchConfig {
  scenarios: ScenarioPackage[];
  actors: ActorConfig[];
  keyPersonnel?: KeyPersonnel[];
  turns: number;
  seed: number;
  startTime?: number;
  provider?: LlmProvider;
  models?: Partial<SimulationModelConfig>;
  /**
   * Cost-vs-quality preset forwarded to each simulation in the batch.
   * See `RunOptions.costPreset` for the full semantic. Defaults to
   * `'quality'`; set `'economy'` to drop the whole batch to the
   * cheaper tier.
   */
  costPreset?: CostPreset;
  maxConcurrency?: number;
}

export interface BatchResult {
  scenarioId: string;
  scenarioVersion: string;
  leader: string;
  seed: number;
  turns: number;
  output: any;
  fingerprint: Record<string, string>;
  duration: number;
}

export interface BatchManifest {
  timestamp: string;
  config: {
    scenarioIds: string[];
    actors: string[];
    turns: number;
    seed: number;
    provider?: string;
    maxConcurrency: number;
  };
  results: BatchResult[];
  totalDuration: number;
}

export async function mapConcurrentInOrder<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(maxConcurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
}

/**
 * Run a batch of simulations across multiple scenarios and leaders.
 * Each scenario x leader combination produces one BatchResult.
 */
export async function runBatch(config: BatchConfig): Promise<BatchManifest> {
  const { runSimulation } = await import('./orchestrator/index.js');
  const startTime = Date.now();
  const jobs = config.scenarios.flatMap(scenario => (
    config.actors.map(leader => ({ scenario, leader }))
  ));
  const results = await mapConcurrentInOrder(
    jobs,
    config.maxConcurrency ?? 1,
    async ({ scenario, leader }) => {
      const runStart = Date.now();
      console.log(`\n  [batch] ${scenario.id} x ${leader.name} (${config.turns} turns, seed ${config.seed})`);

      const output = await runSimulation(leader, config.keyPersonnel ?? [], {
        maxTurns: config.turns,
        seed: config.seed,
        startTime: config.startTime,
        provider: config.provider,
        models: config.models,
        costPreset: config.costPreset,
        scenario,
      });

      return {
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        leader: leader.name,
        seed: config.seed,
        turns: config.turns,
        output,
        fingerprint: (output as any).fingerprint || {},
        duration: Date.now() - runStart,
      };
    },
  );

  return {
    timestamp: new Date().toISOString(),
    config: {
      scenarioIds: config.scenarios.map(s => s.id),
      actors: config.actors.map(l => l.name),
      turns: config.turns,
      seed: config.seed,
      provider: config.provider,
      maxConcurrency: Math.max(1, config.maxConcurrency ?? 1),
    },
    results,
    totalDuration: Date.now() - startTime,
  };
}
