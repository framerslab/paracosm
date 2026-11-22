/**
 * One colony's turn, advanced and read as the orchestrator's turn loop
 * advances and reads it (src/runtime/orchestrator/index.ts): the engine's
 * kernel takes the turn, and the turn's births, deaths, metrics and roster
 * are what the loop puts in its `turn_start`, `turn_done` and
 * `systems_snapshot` frames. Importing this file starts nothing.
 *
 * No model has spoken in a turn built here, so every person's mood is
 * `neutral`, as it is in a run before anyone reacts.
 */
import type { SimulationKernel } from '../../src/engine/core/kernel.js';
import { ageInYears } from '../../src/engine/core/time-unit.js';
import type { ScenarioPackage } from '../../src/engine/types.js';
import { systemsSnapshotTotals } from '../../src/runtime/orchestrator/outcome-effects.js';
import { sim } from './run-frames.js';

/** The world's metrics as the kernel holds them. */
type Metrics = Parameters<typeof systemsSnapshotTotals>[0];

/** One turn of one colony, as the stream's frames carry it. */
export interface KernelTurn {
  turn: number;
  time: number;
  births: number;
  deaths: number;
  metrics: Metrics;
  /** The roster as `systems_snapshot` lists it. */
  agents: Array<Record<string, unknown>>;
}

/** Advances `kernel` through `turn` at `time` and reads the turn back. */
export function advanceKernelTurn(kernel: SimulationKernel, turn: number, time: number, scenario: ScenarioPackage): KernelTurn {
  kernel.advanceTurn(turn, time, scenario.hooks?.progressionHook);
  const after = kernel.getState();
  const thisTurn = after.eventLog.filter(e => e.turn === turn);
  // Generation as the orchestrator computes it: 0 for the people who arrived,
  // one more than the deepest parent for the people born here.
  const byId = new Map(after.agents.map(a => [a.core.id, a]));
  const generations = new Map<string, number>();
  const generation = (id: string, depth = 0): number => {
    if (depth > 10) return depth;
    const known = generations.get(id);
    if (known !== undefined) return known;
    const agent = byId.get(id);
    if (!agent) return 0;
    if (!agent.core.marsborn) {
      generations.set(id, 0);
      return 0;
    }
    const parents = after.agents.filter(p => p.social.childrenIds.includes(id));
    const gen = parents.length === 0 ? 1 : Math.max(...parents.map(p => generation(p.core.id, depth + 1))) + 1;
    generations.set(id, gen);
    return gen;
  };
  return {
    turn,
    time,
    births: thisTurn.filter(e => e.type === 'birth').length,
    deaths: thisTurn.filter(e => e.type === 'death').length,
    metrics: { ...after.metrics },
    agents: after.agents.map(a => ({
      agentId: a.core.id,
      name: a.core.name,
      department: a.core.department,
      role: a.core.role,
      rank: a.career.rank,
      alive: a.health.alive,
      marsborn: a.core.marsborn,
      psychScore: a.health.psychScore,
      age: Math.max(0, Math.floor(ageInYears(a, time, kernel.yearsPerUnit))),
      generation: generation(a.core.id),
      partnerId: a.social.partnerId,
      childrenIds: a.social.childrenIds,
      featured: a.narrative.featured,
      mood: 'neutral',
      shortTermMemory: (a.memory?.shortTerm ?? []).slice(-2).map(m => m.content),
    })),
  };
}

/** The data of the `systems_snapshot` frame that ends a turn: the roster and the world's totals. */
export function snapshotData(t: KernelTurn): Record<string, unknown> {
  return { turn: t.turn, time: t.time, agents: t.agents, ...systemsSnapshotTotals(t.metrics), births: t.births, deaths: t.deaths };
}

/**
 * One leader's turn with no event in it, as stored frames: the turn's
 * start, its end, and the roster that ends it.
 */
export function quietTurnFrames(leader: string, t: KernelTurn): string[] {
  const at = { turn: t.turn, time: t.time };
  return [
    sim(leader, 'turn_start', { ...at, title: '', crisis: '', category: '', births: t.births, deaths: t.deaths, metrics: t.metrics, emergent: false, turnSummary: '', totalEvents: 0, pacing: 'normal' }),
    sim(leader, 'turn_done', { ...at, metrics: t.metrics, toolsForged: 0, totalEvents: 0 }),
    sim(leader, 'systems_snapshot', snapshotData(t)),
  ];
}
